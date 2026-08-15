import { audioSignal, damp } from '@/core/state/audioSignal'
import { useAlanStore, type AlanPhase } from '@/core/state/alanStore'
import { REST, textToVisemes, type Viseme } from './visemes'

/**
 * Fala humanizada.
 *
 * O problema central: `speechSynthesis` não expõe um `MediaStream`, então é
 * impossível medir a amplitude da voz sintetizada e dirigir a boca por ela.
 * A saída é inverter o fluxo — derivar a animação do TEXTO e ancorá-la no
 * tempo real através dos eventos `onboundary`, que disparam a cada palavra.
 *
 * Sobre isso vem a camada que separa fala de mímica: um falante real não move
 * só a mandíbula. Ele levanta a sobrancelha na pergunta, aperta os olhos na
 * afirmação, inclina a cabeça na dúvida e respira nas vírgulas. Esses gestos
 * são extraídos da pontuação e da ênfase do próprio texto.
 */

export interface SpeakOptions {
  /** BCP-47. Padrão pt-BR. */
  lang?: string
  /** 0.1 a 10; padrão levemente abaixo de 1, que soa menos robótico. */
  rate?: number
  pitch?: number
  volume?: number
  /** Chamado quando a fala termina ou é cancelada. */
  onEnd?: () => void
  /**
   * Fase para onde voltar ao terminar. Padrão `idle`.
   *
   * Existe para a fala de espera ("um momento"), dita no meio do raciocínio:
   * ela precisa de `speaking` enquanto dura, senão o shader zera a mandíbula e
   * a boca fica parada — mas voltar para `idle` faria o rosto parecer que já
   * respondeu, enquanto o turno ainda está em curso.
   */
  restorePhase?: AlanPhase
}

/** Gesto agendado num instante da fala. */
interface Beat {
  /** Posição no texto, em caracteres. */
  at: number
  brow: number
  squint: number
  tilt: number
  smile: number
  /** Duração do gesto, em segundos. */
  hold: number
}

interface Anchor {
  charIndex: number
  time: number
}

/**
 * Extrai os gestos do texto.
 *
 * A pontuação é a partitura: interrogação levanta a sobrancelha, exclamação
 * abre o rosto inteiro, vírgula é uma pausa curta com relaxamento, reticências
 * inclinam a cabeça. Palavras em maiúscula recebem ênfase.
 */
function extractBeats(text: string): Beat[] {
  const beats: Beat[] = []

  // Alternância determinística do lado da inclinação, para não pender sempre
  // para o mesmo lado.
  let tiltSide = 1

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (c === '?') {
      beats.push({ at: Math.max(0, i - 14), brow: 0.85, squint: 0, tilt: 0.35 * tiltSide, smile: 0.15, hold: 1.1 })
      tiltSide *= -1
    } else if (c === '!') {
      beats.push({ at: Math.max(0, i - 10), brow: 0.7, squint: 0, tilt: 0, smile: 0.4, hold: 0.9 })
    } else if (c === ',' || c === ';') {
      beats.push({ at: i, brow: 0.12, squint: 0.2, tilt: 0.12 * tiltSide, smile: 0, hold: 0.35 })
      tiltSide *= -1
    } else if (c === '.') {
      // Fim de asserção: o rosto assenta, olhar levemente firme.
      beats.push({ at: i, brow: -0.1, squint: 0.42, tilt: 0, smile: 0.08, hold: 0.6 })
    }
  }

  // Ênfase em palavras totalmente maiúsculas.
  const emphasis = /\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,}\b/g
  let match: RegExpExecArray | null
  while ((match = emphasis.exec(text)) !== null) {
    beats.push({ at: match.index, brow: 0.6, squint: 0, tilt: 0, smile: 0.2, hold: 0.5 })
  }

  return beats.sort((a, b) => a.at - b.at)
}

let activeUtterance: SpeechSynthesisUtterance | null = null
let rafId = 0

/**
 * Selo de quem está falando agora.
 *
 * `speechSynthesis.cancel()` dispara o `onend` da fala interrompida de forma
 * assíncrona — ele pode chegar DEPOIS de a próxima fala já ter começado. Sem
 * este selo, o `finish()` da fala velha reverteria a fase por cima da nova: a
 * fala de espera, ao ser cortada, jogaria o rosto de volta para "pensando"
 * enquanto ALAN já estava respondendo, e a mandíbula travaria.
 */
let generation = 0

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Interrompe a fala em curso e devolve o rosto ao repouso. */
export function stopSpeaking() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  activeUtterance = null
  // Invalida quem estava falando: o `onend` atrasado não manda mais em nada.
  generation++
  if (isSpeechSupported()) window.speechSynthesis.cancel()
  relax()
}

function relax() {
  audioSignal.jaw = 0
  audioSignal.brow = 0
  audioSignal.squint = 0
  audioSignal.tilt = 0
  audioSignal.smile = 0
  audioSignal.mouthWide = 0.3
}

/**
 * Fala o texto animando rosto e expressão.
 *
 * Resolve quando a fala termina. Se o navegador não suportar síntese, a
 * animação roda mesmo assim, num ritmo estimado — a interface não pode ficar
 * muda de corpo só porque está muda de voz.
 */
export function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  stopSpeaking()

  const trimmed = text.trim()
  if (!trimmed) return Promise.resolve()

  const visemes = textToVisemes(trimmed)
  const beats = extractBeats(trimmed)
  const store = useAlanStore.getState()

  return new Promise<void>((resolve) => {
    const anchors: Anchor[] = [{ charIndex: 0, time: 0 }]
    let startedAt = performance.now()
    let finished = false

    // Estimativa de duração usada até o primeiro `onboundary` chegar, e como
    // única referência quando não há síntese disponível.
    const estimatedRate = options.rate ?? 0.98
    const estimatedTotal = (trimmed.length / (14.5 * estimatedRate)) * 1000

    /** Converte tempo decorrido em posição no texto, usando as âncoras reais. */
    const charAt = (elapsed: number): number => {
      const last = anchors[anchors.length - 1]
      if (elapsed <= last.time) {
        // Interpola entre as duas âncoras que cercam este instante.
        for (let i = anchors.length - 1; i > 0; i--) {
          const b = anchors[i]
          const a = anchors[i - 1]
          if (elapsed >= a.time) {
            const span = b.time - a.time || 1
            const t = (elapsed - a.time) / span
            return a.charIndex + (b.charIndex - a.charIndex) * t
          }
        }
        return 0
      }
      // Além da última âncora, extrapola pelo ritmo médio observado.
      const rate = last.time > 0 ? last.charIndex / last.time : trimmed.length / estimatedTotal
      return last.charIndex + (elapsed - last.time) * rate
    }

    const sampleViseme = (pos: number): Viseme => {
      const i = Math.floor(pos)
      if (i < 0 || i >= visemes.length) return REST
      const a = visemes[i]
      const b = visemes[Math.min(visemes.length - 1, i + 1)]
      const t = pos - i
      return { jaw: a.jaw + (b.jaw - a.jaw) * t, wide: a.wide + (b.wide - a.wide) * t }
    }

    let lastFrame = performance.now()

    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - lastFrame) / 1000)
      lastFrame = now
      const elapsed = now - startedAt

      const pos = charAt(elapsed)
      const target = sampleViseme(pos)

      // Coarticulação: a boca não salta de um visema ao outro, ela persegue.
      // Fechar é mais rápido que abrir, como na musculatura real.
      const closing = target.jaw < audioSignal.jaw
      audioSignal.jaw = damp(audioSignal.jaw, target.jaw, closing ? 26 : 17, dt)
      audioSignal.mouthWide = damp(audioSignal.mouthWide, target.wide, 14, dt)

      // Gestos ativos no instante atual.
      let brow = 0
      let squint = 0
      let tilt = 0
      let smile = 0
      for (const beat of beats) {
        const beatTime = (beat.at / Math.max(1, trimmed.length)) * Math.max(estimatedTotal, anchors[anchors.length - 1].time || estimatedTotal)
        const age = (elapsed - beatTime) / 1000
        if (age < 0 || age > beat.hold) continue
        // Envelope suave: sobe rápido, sustenta, cai.
        const phase = age / beat.hold
        const env = Math.sin(Math.PI * Math.min(1, phase)) ** 0.7
        brow += beat.brow * env
        squint += beat.squint * env
        tilt += beat.tilt * env
        smile += beat.smile * env
      }

      // Micro-ruído: o rosto humano nunca fica exatamente parado.
      const t = now / 1000
      brow += Math.sin(t * 0.7) * 0.04
      tilt += Math.sin(t * 0.43) * 0.05

      audioSignal.brow = damp(audioSignal.brow, Math.max(-0.4, Math.min(1, brow)), 7, dt)
      audioSignal.squint = damp(audioSignal.squint, Math.max(0, Math.min(1, squint)), 6, dt)
      audioSignal.tilt = damp(audioSignal.tilt, Math.max(-1, Math.min(1, tilt)), 4, dt)
      audioSignal.smile = damp(audioSignal.smile, Math.max(0, Math.min(1, smile)), 6, dt)

      if (finished && audioSignal.jaw < 0.02) {
        relax()
        rafId = 0
        resolve()
        return
      }

      rafId = requestAnimationFrame(tick)
    }

    const finish = () => {
      if (finished) return
      finished = true
      // Só o falante atual mexe na fase. Um `onend` que chega tarde, de uma
      // fala já cancelada, não pode desfazer o estado de quem veio depois.
      if (mine === generation) store.setPhase(options.restorePhase ?? 'idle')
      options.onEnd?.()
      // O laço continua alguns quadros para a boca fechar em vez de travar.
    }

    const mine = ++generation
    store.setPhase('speaking')

    if (!isSpeechSupported()) {
      startedAt = performance.now()
      rafId = requestAnimationFrame(tick)
      setTimeout(finish, estimatedTotal)
      return
    }

    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.lang = options.lang ?? 'pt-BR'
    utterance.rate = options.rate ?? 0.98
    utterance.pitch = options.pitch ?? 1
    utterance.volume = options.volume ?? 1

    utterance.onstart = () => {
      startedAt = performance.now()
      lastFrame = startedAt
    }

    // Cada limite de palavra é uma âncora de tempo real: é isso que mantém a
    // boca em sincronia mesmo quando a voz acelera ou desacelera.
    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return
      anchors.push({ charIndex: event.charIndex, time: performance.now() - startedAt })
    }

    utterance.onend = finish
    utterance.onerror = finish

    activeUtterance = utterance
    window.speechSynthesis.speak(utterance)
    rafId = requestAnimationFrame(tick)
  })
}

/** Exposto para depuração: a fala em curso, se houver. */
export function currentUtterance(): SpeechSynthesisUtterance | null {
  return activeUtterance
}
