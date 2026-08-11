/**
 * Contrato do reconhecimento de fala.
 *
 * Existe para isolar o motor: a UI e o orquestrador falam com esta interface,
 * nunca com a Web Speech API. Trocar por Whisper no servidor depois é escrever
 * uma implementação nova e mais nada — do mesmo jeito que `LlmProvider` isola
 * o modelo no servidor.
 *
 * O formato é de callbacks, e não de `AsyncIterable`, porque o reconhecimento
 * é dirigido por eventos do navegador e pode terminar sozinho (silêncio) sem
 * ninguém ter pedido. Um iterador precisaria de uma fila para não perder
 * evento entre um `await` e o próximo.
 */

export interface SttEvents {
  /** Hipótese parcial: ainda muda enquanto a pessoa fala. */
  onInterim(text: string): void
  /** Trecho estabilizado — o motor não vai mais reescrevê-lo. */
  onFinal(text: string): void
  /** Falha digna de aparecer para a pessoa. Silêncio e cancelamento não entram aqui. */
  onError(message: string): void
  /** Parou, seja por silêncio, por `stop()`, por `abort()` ou por erro. */
  onEnd(): void
}

export interface SttEngine {
  /** Motivo legível da indisponibilidade, ou `null` quando dá para usar. */
  readonly unavailableReason: string | null
  /** Começa a ouvir. Chamar com o motor já ouvindo é ignorado, não é erro. */
  start(events: SttEvents): void
  /** Encerra entregando o que já foi reconhecido. */
  stop(): void
  /** Encerra descartando o que foi reconhecido. */
  abort(): void
}
