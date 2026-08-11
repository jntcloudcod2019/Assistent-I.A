import { audioSignal, damp } from '@/core/state/audioSignal'

/**
 * Captura do microfone em PCM pronto para o Whisper.
 *
 * Uma abertura de microfone serve a dois consumidores: os frames que sobem
 * para o servidor e a amplitude que faz o rosto reagir. Abrir duas vezes
 * funcionaria, mas acenderia dois indicadores de gravação no navegador e
 * gastaria o dobro — então a mesma captura alimenta os dois.
 *
 * O `AudioContext` é criado pedindo 16 kHz direto. O navegador reamostra com
 * filtro anti-aliasing de verdade; decimar 48 kHz na mão seria mais código e
 * pior resultado. Se o navegador ignorar o pedido, a reamostragem linear
 * entra como plano B.
 */

/** O Whisper consome 16 kHz mono. */
const TARGET_RATE = 16_000

/** ~100 ms por quadro de rede: o VAD reagrupa em 20 ms do lado de lá. */
const CHUNK_SAMPLES = 1_600

const NOISE_FLOOR = 0.012
const GAIN = 6
const LAMBDA = 18

/**
 * O worklet só empacota e devolve — nada de decisão aqui dentro.
 *
 * Vai como blob em vez de arquivo separado porque é o único jeito de manter o
 * processador ao lado de quem o usa; um `.js` solto em `public/` se perderia
 * do contexto na primeira refatoração.
 */
const WORKLET_SOURCE = `
class PcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    // Sem entrada significa faixa encerrando; devolver false mataria o nó
    // antes do último quadro sair.
    if (channel) this.port.postMessage(channel.slice())
    return true
  }
}
registerProcessor('pcm-worklet', PcmWorklet)
`

export interface PcmCapture {
  stop(): void
}

/** Reamostragem linear, só para o caso de o navegador negar os 16 kHz. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const output = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < output.length; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const frac = position - index
    const a = input[index] ?? 0
    const b = input[index + 1] ?? a
    output[i] = a + (b - a) * frac
  }
  return output
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    // O clamp não é decorativo: acima de 1.0 o inteiro estoura e o estalo
    // resultante viraria consoante fantasma na transcrição.
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

export async function startPcmCapture(onChunk: (pcm: Int16Array) => void): Promise<PcmCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // O cancelamento de eco é o que impede o Whisper de transcrever a própria
    // voz do ALAN saindo dos alto-falantes e devolvê-la como pergunta.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })

  const context = new AudioContext({ sampleRate: TARGET_RATE })
  if (context.state === 'suspended') await context.resume()

  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await context.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'pcm-worklet')
  source.connect(node)
  // De propósito sem `connect(destination)`: ligar o microfone na saída
  // devolveria a voz da pessoa pelos alto-falantes, em microfonia.

  let carry: number[] = []
  let last = performance.now()

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const frame = resample(event.data, context.sampleRate, TARGET_RATE)

    // Amplitude para o avatar, medida do mesmo áudio que sobe.
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)
    const gated = Math.max(0, rms - NOISE_FLOOR) / (1 - NOISE_FLOOR)
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    audioSignal.level = damp(audioSignal.level, Math.min(1, gated * GAIN), LAMBDA, dt)

    // Reagrupa os blocos de 128 amostras em quadros de rede maiores.
    for (let i = 0; i < frame.length; i++) carry.push(frame[i])
    while (carry.length >= CHUNK_SAMPLES) {
      onChunk(toInt16(new Float32Array(carry.slice(0, CHUNK_SAMPLES))))
      carry = carry.slice(CHUNK_SAMPLES)
    }
  }

  return {
    stop() {
      node.port.onmessage = null
      node.disconnect()
      source.disconnect()
      // Parar as faixas é o que apaga o indicador de gravação do navegador.
      stream.getTracks().forEach((track) => track.stop())
      void context.close()
      audioSignal.level = 0
    },
  }
}
