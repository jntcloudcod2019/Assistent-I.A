import { SAMPLE_RATE } from '../stt/types.js'

/**
 * Detecção de atividade de voz por energia.
 *
 * É o que dá a fronteira do turno: a pessoa fala, para, e o silêncio é o sinal
 * de que terminou. Sem isso seria preciso apertar um botão para encerrar cada
 * frase, e a conversa deixaria de parecer conversa.
 *
 * Energia crua, e não um modelo: o Silero que acompanha o whisper.cpp seria
 * mais preciso, mas rodar uma rede a cada 20 ms para responder "tem voz?"
 * custa mais do que o problema pede — a captura já vem com supressão de ruído
 * e cancelamento de eco do navegador, então o que chega é bem comportado.
 */

/** Janela de análise. 20 ms é a escala do fonema — menor vira ruído. */
const FRAME_MS = 20
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000
const FRAME_BYTES = FRAME_SAMPLES * 2

/** RMS normalizado acima do qual a janela conta como fala. */
const SPEECH_RMS = 0.015

/** Fala precisa durar isto para valer; abaixo disso é tosse, clique, porta. */
const MIN_SPEECH_MS = 200

/**
 * Silêncio que encerra o enunciado.
 *
 * O número é um compromisso: curto demais corta quem pensa no meio da frase,
 * longo demais faz o ALAN parecer lento. 700 ms cobre a pausa natural entre
 * orações sem esperar a pessoa desistir.
 */
const SILENCE_MS = 700

/**
 * Áudio guardado antes do disparo.
 *
 * Sem isto o enunciado começa cortado: quando a energia cruza o limiar, o
 * ataque da primeira sílaba já passou, e o Whisper recebe "ual é a capital".
 * Meio segundo de memória devolve o começo da palavra.
 */
const PREROLL_MS = 500
const PREROLL_BYTES = (SAMPLE_RATE * PREROLL_MS * 2) / 1000

/** Teto de segurança: ninguém fala 30 s sem pausa, mas um ar-condicionado sim. */
const MAX_UTTERANCE_MS = 30_000
const MAX_UTTERANCE_BYTES = (SAMPLE_RATE * MAX_UTTERANCE_MS * 2) / 1000

export type VadEvent =
  /** A pessoa começou a falar — serve para a UI reagir na hora. */
  | { type: 'speech-start' }
  /** Enunciado completo, com pre-roll incluído, pronto para transcrever. */
  | { type: 'utterance'; pcm: Buffer }

function frameRms(frame: Buffer): number {
  let sum = 0
  for (let i = 0; i < frame.length; i += 2) {
    const sample = frame.readInt16LE(i) / 32768
    sum += sample * sample
  }
  return Math.sqrt(sum / (frame.length / 2))
}

export class Vad {
  // As anotações são explícitas de propósito: `Buffer.alloc` infere
  // `Buffer<ArrayBuffer>`, mas o que chega da rede é `Buffer<ArrayBufferLike>`,
  // e sem isto os dois não se misturam.

  /** Sobra da última chamada: os chunks da rede não caem em múltiplos de 20 ms. */
  private pending: Buffer = Buffer.alloc(0)
  /** Janela circular do que veio antes da fala começar. */
  private preroll: Buffer = Buffer.alloc(0)
  /** Enunciado em construção; vazio quando não há fala em curso. */
  private utterance: Buffer[] = []
  private utteranceBytes = 0

  private speaking = false
  private speechMs = 0
  private silenceMs = 0

  push(chunk: Buffer): VadEvent[] {
    const events: VadEvent[] = []
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk

    let offset = 0
    while (this.pending.length - offset >= FRAME_BYTES) {
      const frame = this.pending.subarray(offset, offset + FRAME_BYTES)
      offset += FRAME_BYTES

      const loud = frameRms(frame) >= SPEECH_RMS

      if (this.speaking) {
        this.utterance.push(frame)
        this.utteranceBytes += frame.length

        this.silenceMs = loud ? 0 : this.silenceMs + FRAME_MS

        if (this.silenceMs >= SILENCE_MS || this.utteranceBytes >= MAX_UTTERANCE_BYTES) {
          const pcm = this.finishUtterance()
          if (pcm) events.push({ type: 'utterance', pcm })
        }
        continue
      }

      // Ainda em silêncio: alimenta o pre-roll e conta quanto tempo de fala já
      // se acumulou, para não disparar num estalo.
      this.preroll = Buffer.concat([this.preroll, frame])
      if (this.preroll.length > PREROLL_BYTES) {
        this.preroll = this.preroll.subarray(this.preroll.length - PREROLL_BYTES)
      }

      this.speechMs = loud ? this.speechMs + FRAME_MS : 0

      if (this.speechMs >= MIN_SPEECH_MS) {
        this.speaking = true
        this.silenceMs = 0
        this.speechMs = 0
        // O pre-roll é o primeiro pedaço do enunciado, não um extra.
        this.utterance = [this.preroll]
        this.utteranceBytes = this.preroll.length
        this.preroll = Buffer.alloc(0)
        events.push({ type: 'speech-start' })
      }
    }

    this.pending = offset ? this.pending.subarray(offset) : this.pending
    return events
  }

  /** Encerra o que estiver em curso — usado quando a pessoa fecha o microfone. */
  flush(): Buffer | null {
    if (!this.speaking) return null
    if (this.pending.length) {
      this.utterance.push(this.pending)
      this.utteranceBytes += this.pending.length
      this.pending = Buffer.alloc(0)
    }
    return this.finishUtterance()
  }

  private finishUtterance(): Buffer | null {
    const pcm = Buffer.concat(this.utterance)
    this.utterance = []
    this.utteranceBytes = 0
    this.speaking = false
    this.silenceMs = 0
    this.speechMs = 0
    // Enunciados curtos demais são ruído que passou pelo limiar.
    return pcm.length > FRAME_BYTES * 5 ? pcm : null
  }
}
