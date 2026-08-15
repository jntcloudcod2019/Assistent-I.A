import { useCallback, useEffect, useRef } from 'react'

import { httpAgent } from '@/core/agent/httpAgent'
import { useAlanStore } from '@/core/state/alanStore'
import { isSpeechSupported, speak, stopSpeaking } from '@/core/speech/speak'

/**
 * Orquestra um turno de conversa.
 *
 * Único lugar do aplicativo que conhece o ciclo inteiro. Dois detalhes que
 * parecem menores e não são:
 *
 * 1. `speak()` já move a fase para `speaking` e devolve para `idle` sozinho.
 *    Duplicar isso aqui criaria uma disputa entre os dois — a fase piscaria.
 *    Este hook cobre apenas `thinking`.
 *
 * 2. A fala começa quando o stream TERMINA, não a cada token. Falar token a
 *    token produz gagueira, porque a síntese reinicia a cada fragmento.
 */
/**
 * Espera antes de avisar que está processando.
 *
 * Medido: o turno típico leva 1,8–1,9 s, com picos ocasionais de 18 s. Avisar
 * de imediato atropelaria a maioria das respostas — ALAN estaria pedindo para
 * esperar quando a resposta já chegou. 1,2 s deixa passar em silêncio tudo que
 * é rápido e cobre justamente os casos em que a espera incomoda.
 */
const FILLER_DELAY_MS = 1_200

/**
 * Falas de espera, curtas de propósito.
 *
 * "Aguarde enquanto processo a solicitação" leva ~2,5 s falada — mais que o
 * turno inteiro no caso típico, e ALAN ainda estaria dizendo isso por cima da
 * própria resposta. Estas ficam abaixo de 1 s. São várias porque ouvir sempre
 * a mesma frase, várias vezes seguidas, soa mais robótico que o silêncio que
 * ela veio resolver.
 */
const FILLERS = ['Um momento.', 'Deixa eu ver.', 'Só um instante.', 'Já respondo.']

export function useConversation() {
  const abortRef = useRef<AbortController | null>(null)
  /** Última frase usada, para não repetir duas vezes seguidas. */
  const lastFillerRef = useRef(-1)

  useEffect(() => {
    useAlanStore.getState().setTtsSupported(isSpeechSupported())
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    stopSpeaking()
    useAlanStore.getState().completeSteps()
    useAlanStore.getState().setPhase('idle')
  }, [])

  const send = useCallback(async (rawText: string) => {
    const text = rawText.trim()
    if (!text) return

    const store = useAlanStore.getState()
    if (store.phase === 'thinking') return

    // Um turno novo interrompe a fala anterior; ninguém quer ouvir a resposta
    // velha depois de já ter perguntado outra coisa.
    stopSpeaking()

    store.addUserMessage(text)
    store.clearSteps()
    store.setPhase('thinking')

    const messageId = store.startAlanMessage()
    const controller = new AbortController()
    abortRef.current = controller

    let answer = ''
    let failed = false

    // Fala de espera: agendada, não imediata. Se a resposta chegar antes do
    // prazo, o timer é cancelado e ninguém ouve nada — que é o desejado na
    // maioria dos turnos.
    let fillerTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      fillerTimer = null
      const index = (lastFillerRef.current + 1 + Math.floor(Math.random() * (FILLERS.length - 1))) % FILLERS.length
      lastFillerRef.current = index
      // `restorePhase: 'thinking'` porque o turno continua: sem isso o rosto
      // voltaria a `idle` e pareceria ter terminado no meio do raciocínio.
      void speak(FILLERS[index], { restorePhase: 'thinking' })
    }, FILLER_DELAY_MS)

    const cancelFiller = () => {
      if (fillerTimer !== null) {
        clearTimeout(fillerTimer)
        fillerTimer = null
      }
    }

    try {
      for await (const event of httpAgent.send(text, controller.signal)) {
        switch (event.type) {
          case 'status':
            store.pushStep(event.label)
            break
          case 'token':
            // O primeiro token é o sinal de que a espera acabou.
            cancelFiller()
            answer += event.text
            store.appendToMessage(messageId, event.text)
            break
          case 'done':
            store.finishMessage(messageId)
            store.completeSteps()
            break
          case 'error':
            store.failMessage(messageId, event.message)
            store.completeSteps()
            failed = true
            break
        }
        if (failed) break
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        store.failMessage(messageId, 'O turno foi interrompido por um erro inesperado.')
        store.completeSteps()
      }
      failed = true
      void error
    } finally {
      cancelFiller()
      abortRef.current = null
    }

    // A fala de espera pode ainda estar no ar quando a resposta fica pronta.
    // Cortá-la é melhor que enfileirar: esperar ela terminar adiaria a
    // resposta de verdade, que é justamente o que este recurso queria evitar.
    stopSpeaking()

    if (controller.signal.aborted) {
      store.setPhase('idle')
      return
    }

    if (failed) {
      // Calar depois de uma falha faz o ALAN parecer travado: quem perguntou
      // por voz fica esperando uma resposta que nunca vem. Ele avisa que
      // falhou — curto e em português. O detalhe técnico costuma vir em
      // inglês e cheio de termo de API; isso fica no chat, para ler com
      // calma, e não lido em voz alta.
      await speak('Não consegui responder agora. O detalhe está no chat.')
      return
    }

    if (!answer.trim()) {
      store.setPhase('idle')
      return
    }

    // Daqui em diante quem manda na fase é o `speak`.
    await speak(answer)
  }, [])

  return { send, cancel }
}
