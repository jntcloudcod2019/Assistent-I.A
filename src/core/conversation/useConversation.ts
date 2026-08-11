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
export function useConversation() {
  const abortRef = useRef<AbortController | null>(null)

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

    try {
      for await (const event of httpAgent.send(text, controller.signal)) {
        switch (event.type) {
          case 'status':
            store.pushStep(event.label)
            break
          case 'token':
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
      abortRef.current = null
    }

    if (controller.signal.aborted) {
      store.setPhase('idle')
      return
    }

    if (failed || !answer.trim()) {
      store.setPhase('idle')
      return
    }

    // Daqui em diante quem manda na fase é o `speak`.
    await speak(answer)
  }, [])

  return { send, cancel }
}
