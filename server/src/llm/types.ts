/**
 * O ponto de troca de cérebro.
 *
 * Espelha `AgentClient` do lado do navegador: a rota SSE só conhece esta
 * interface, então trocar OpenAI por Claude ou Gemini é escrever outra classe.
 * Nem a voz nem o rosto sabem qual modelo respondeu.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamResult {
  /** Tokens conforme chegam. */
  chunks: AsyncIterable<string>
}

export interface LlmUsage {
  model: string
  promptTokens?: number
  completionTokens?: number
  latencyMs: number
}

export interface LlmProvider {
  readonly model: string
  /**
   * Emite pedaços de texto conforme o modelo responde. Deve parar quando
   * `signal` for abortado — o usuário desistir do turno não pode continuar
   * consumindo tokens.
   */
  stream(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string>
  /** Uso do último `stream`, disponível depois que ele termina. */
  lastUsage(): LlmUsage | null
}
