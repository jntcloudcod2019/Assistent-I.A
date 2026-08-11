import { useCallback, useEffect, useRef, useState } from 'react'

import { useMicAnalyser } from '@/core/audio/useMicAnalyser'
import { useAlanStore } from '@/core/state/alanStore'
import { stopSpeaking } from '@/core/speech/speak'
import { createWebSpeechEngine } from './webSpeech'
import type { SttEngine } from './types'

/**
 * Liga o microfone ao turno de conversa.
 *
 * Junta as duas metades que chegam ao microfone por caminhos separados: o
 * motor de STT, que devolve texto, e o analisador, que devolve amplitude para
 * o rosto reagir. Uma não sabe da outra, e é aqui que viram um gesto só.
 *
 * O texto reconhecido sai por `onResult` — na prática, o `send` do
 * `useConversation`. Este hook não conhece o servidor nem o modelo.
 */
export function useVoiceInput({ onResult }: { onResult: (text: string) => void }) {
  const engineRef = useRef<SttEngine | null>(null)
  const analyser = useMicAnalyser()
  const [listening, setListening] = useState(false)

  // Refs, e não state: os callbacks do motor são registrados uma vez, no
  // `start`, e capturariam o valor daquele instante para sempre.
  const finalRef = useRef('')
  const listeningRef = useRef(false)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  useEffect(() => {
    const engine = createWebSpeechEngine()
    engineRef.current = engine

    const store = useAlanStore.getState()
    store.setMicSupported(engine.unavailableReason === null)
    store.setMicError(engine.unavailableReason)

    return () => engine.abort()
  }, [])

  const stop = useCallback(() => {
    // `stop()` e não `abort()`: o que já foi falado deve valer. Quem clica no
    // botão no meio da frase quer enviar o que disse, não jogar fora.
    engineRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    const engine = engineRef.current
    if (!engine || engine.unavailableReason || listeningRef.current) return

    const store = useAlanStore.getState()
    if (store.phase === 'thinking') return

    // Falar por cima do ALAN o interrompe. Isso resolve duas coisas de uma
    // vez: é o comportamento natural de quem toma a palavra, e evita que o
    // reconhecimento transcreva a própria voz dele saindo dos alto-falantes.
    stopSpeaking()

    finalRef.current = ''
    listeningRef.current = true
    setListening(true)
    store.setMicError(null)
    store.setInterim('')
    store.setPhase('listening')

    void analyser.start()

    engine.start({
      onInterim: (text) => useAlanStore.getState().setInterim(text),

      onFinal: (text) => {
        finalRef.current = `${finalRef.current} ${text}`.trim()
      },

      onError: (message) => {
        useAlanStore.getState().setMicError(message)
      },

      onEnd: () => {
        listeningRef.current = false
        setListening(false)
        analyser.stop()

        const store = useAlanStore.getState()
        store.setInterim('')

        const text = finalRef.current.trim()
        finalRef.current = ''

        // A fase volta para `idle` em qualquer caso: o texto reconhecido vira
        // rascunho, e o turno só começa quando a pessoa enviar. Deixar em
        // `thinking` aqui acenderia o "pensando" antes de haver pergunta.
        store.setPhase('idle')
        if (text) onResultRef.current(text)
      },
    })
  }, [analyser])

  const toggle = useCallback(() => {
    if (listeningRef.current) stop()
    else start()
  }, [start, stop])

  return { listening, start, stop, toggle }
}
