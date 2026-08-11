import type { SttEngine, SttEvents } from './types'

/**
 * Reconhecimento de fala pela Web Speech API.
 *
 * O navegador faz a transcrição e o servidor recebe texto — nenhum frame de
 * áudio sai daqui pela nossa rede. No Chrome a transcrição acontece nos
 * servidores do Google, e é bom saber disso: é a troca que compra pt-BR
 * gratuito, com resultado parcial ao vivo, sem instalar modelo nenhum.
 *
 * A API não é padronizada — só existe sob prefixo na maioria dos navegadores,
 * e o Firefox não a implementa. Por isso a indisponibilidade é um estado de
 * primeira classe (`unavailableReason`) e não uma exceção.
 */

// A tipagem não vem no lib.dom, então declaramos o mínimo que usamos. Tipar
// só isto é melhor que `any`: o compilador ainda pega erro de nome de campo.
interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionResultListLike {
  readonly length: number
  readonly [index: number]: SpeechRecognitionResultLike
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Traduz o código de erro para algo acionável.
 *
 * `null` significa "não é para mostrar": silêncio e cancelamento são fluxo
 * normal — o motor para sozinho depois de uma pausa, e `abort()` é coisa
 * nossa. Tratá-los como erro encheria a tela de alarme falso.
 */
function describeError(code: string): string | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permissão de microfone negada — autorize no cadeado da barra de endereço.'
    case 'audio-capture':
      return 'Nenhum microfone encontrado.'
    case 'network':
      return 'A transcrição precisa de internet, e a rede falhou.'
    case 'language-not-supported':
      return 'Este navegador não reconhece português do Brasil.'
    default:
      return `Falha no reconhecimento de voz (${code}).`
  }
}

export function createWebSpeechEngine(): SttEngine {
  const Ctor = getConstructor()

  if (!Ctor) {
    return {
      unavailableReason:
        'Este navegador não tem reconhecimento de voz — use Chrome, Edge ou Safari.',
      start: () => {},
      stop: () => {},
      abort: () => {},
    }
  }

  let recognition: SpeechRecognitionLike | null = null

  const detach = () => {
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition = null
  }

  return {
    unavailableReason: null,

    start(events: SttEvents) {
      // Chamar `start()` num reconhecimento já ativo lança InvalidStateError.
      if (recognition) return

      const rec = new Ctor()
      rec.lang = 'pt-BR'
      rec.interimResults = true
      rec.maxAlternatives = 1
      // `continuous: true` porque quem encerra é a pessoa, não a pausa. Com
      // `false` o motor corta na primeira respiração — e como o texto agora
      // vira rascunho para revisar antes de enviar, ditar duas frases é o
      // caso normal, não a exceção.
      rec.continuous = true

      rec.onresult = (event) => {
        let interim = ''
        // A partir de `resultIndex`, e não de 0: os anteriores já foram
        // entregues, e reprocessá-los duplicaria o texto final.
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const transcript = result[0]?.transcript ?? ''
          if (result.isFinal) events.onFinal(transcript)
          else interim += transcript
        }
        if (interim) events.onInterim(interim)
      }

      rec.onerror = (event) => {
        const message = describeError(event.error)
        if (message) events.onError(message)
      }

      // `onend` sempre dispara — inclusive depois de `onerror` e de `abort()`.
      // É o único ponto de saída, então é aqui que a limpeza acontece.
      rec.onend = () => {
        detach()
        events.onEnd()
      }

      recognition = rec

      try {
        rec.start()
      } catch (error) {
        detach()
        events.onError(
          error instanceof Error
            ? `Não foi possível abrir o microfone: ${error.message}`
            : 'Não foi possível abrir o microfone.',
        )
        events.onEnd()
      }
    },

    stop() {
      recognition?.stop()
    },

    abort() {
      recognition?.abort()
    },
  }
}
