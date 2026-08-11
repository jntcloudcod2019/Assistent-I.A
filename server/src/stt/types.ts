/**
 * Contrato da transcrição no servidor.
 *
 * Espelha o `LlmProvider`: a rota de voz fala com esta interface, nunca com o
 * whisper.cpp diretamente. Trocar por Deepgram, OpenAI ou um modelo maior é
 * uma classe nova e mais nada.
 *
 * O formato do áudio é fixo e cru de propósito — **PCM mono, 16 kHz, int16
 * little-endian**. É o que o Whisper consome nativamente, então o navegador
 * reamostra uma vez na captura e ninguém mais precisa converter. Sem isso o
 * servidor dependeria de ffmpeg só para desempacotar WebM/Opus.
 */

export interface SttProvider {
  readonly name: string
  /** Transcreve um enunciado completo. Devolve `''` quando não houve fala. */
  transcribe(pcm: Buffer, signal: AbortSignal): Promise<string>
  close(): Promise<void>
}

/** Taxa de amostragem que o Whisper espera. Não é negociável do lado dele. */
export const SAMPLE_RATE = 16_000
