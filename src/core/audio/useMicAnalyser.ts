import { useCallback, useEffect, useRef } from 'react'

import { audioSignal, damp } from '@/core/state/audioSignal'

/**
 * Amplitude do microfone em `audioSignal.level`, a 60 fps.
 *
 * A Web Speech API devolve texto e nada mais — não dá acesso ao áudio. Para o
 * rosto reagir enquanto a pessoa fala é preciso um segundo caminho até o
 * microfone, e é isto: `getUserMedia` cru, medido no domínio do tempo.
 *
 * (É o espelho do problema da fala: `speechSynthesis` também não expõe
 * `MediaStream`, e por isso a mandíbula do ALAN é derivada do texto. Aqui há
 * áudio de verdade, então a amplitude é medida, não estimada.)
 *
 * O valor não passa por state do React — seriam ~60 re-renders por segundo.
 * Vai direto para o objeto mutável que o shader lê dentro de `useFrame`.
 */

/** Abaixo disto é ruído de sala; sem a porta o rosto treme parado. */
const NOISE_FLOOR = 0.012

/** Fala normal fica na casa de 0,05–0,2 de RMS; o ganho leva isso perto de 1. */
const GAIN = 6

/** Suavização: rápido o bastante para acompanhar sílaba, lento para não tremer. */
const LAMBDA = 18

export function useMicAnalyser() {
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    // Parar as faixas é o que apaga o indicador de gravação do navegador.
    // Sem isto o ponto vermelho fica aceso para sempre, e com razão: o
    // microfone continuaria de fato aberto.
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    audioSignal.level = 0
  }, [])

  const start = useCallback(async () => {
    if (streamRef.current) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // O cancelamento de eco importa de verdade aqui: sem ele o analisador
        // mede a própria voz do ALAN saindo dos alto-falantes.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      // Permissão negada ou sem dispositivo. O motor de STT reporta o motivo
      // para a pessoa; aqui basta não deixar o rosto reagindo a nada.
      return
    }

    streamRef.current = stream

    // O AudioContext é reaproveitado entre turnos: criar um por turno esbarra
    // no limite do navegador depois de algumas dezenas de conversas.
    let context = contextRef.current
    if (!context || context.state === 'closed') {
      context = new AudioContext()
      contextRef.current = context
    }
    // Um contexto criado antes do primeiro gesto nasce suspenso.
    if (context.state === 'suspended') await context.resume()

    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    // Janela curta: 1024 amostras a 48 kHz são ~21 ms, na escala da sílaba.
    analyser.fftSize = 1024
    source.connect(analyser)
    // Sem `connect(context.destination)` de propósito — ligar o microfone na
    // saída devolveria a voz da pessoa pelos alto-falantes, em microfonia.

    const data = new Uint8Array(analyser.fftSize)
    let last = performance.now()

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)

      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      analyser.getByteTimeDomainData(data)

      // RMS no domínio do tempo. O byte 128 é o silêncio (zero centrado).
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)

      const gated = Math.max(0, rms - NOISE_FLOOR) / (1 - NOISE_FLOOR)
      const target = Math.min(1, gated * GAIN)

      audioSignal.level = damp(audioSignal.level, target, LAMBDA, dt)
    }

    tick()
  }, [])

  // Sair da página com o microfone aberto deixaria o indicador aceso.
  useEffect(() => stop, [stop])

  return { start, stop }
}
