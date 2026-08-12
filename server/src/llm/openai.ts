import OpenAI from 'openai'

import type { ChatMessage, LlmProvider, LlmUsage } from './types.js'

/**
 * Provedor para qualquer API compatível com a da OpenAI.
 *
 * O protocolo `/chat/completions` virou o denominador comum: Gemini, Groq,
 * OpenRouter, DeepSeek, Mistral e o Ollama local expõem todos o mesmo formato.
 * Por isso o que troca o modelo aqui é uma URL, não uma classe nova —
 * `baseUrl` vazio fala com a OpenAI, preenchido fala com o resto.
 *
 * Presets estão em `.env.example`.
 */
export class OpenAiProvider implements LlmProvider {
  readonly model: string
  private client: OpenAI
  private usage: LlmUsage | null = null

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) })
    this.model = model
  }

  lastUsage(): LlmUsage | null {
    return this.usage
  }

  async *stream(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string> {
    const startedAt = Date.now()
    this.usage = null

    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        stream: true,
        // Pede o uso junto do stream; sem isso a última mensagem não traz
        // contagem de tokens e o metadata fica cego.
        stream_options: { include_usage: true },
      },
      { signal },
    )

    let promptTokens: number | undefined
    let completionTokens: number | undefined

    for await (const part of stream) {
      if (signal.aborted) break

      if (part.usage) {
        promptTokens = part.usage.prompt_tokens
        completionTokens = part.usage.completion_tokens
      }

      const delta = part.choices[0]?.delta?.content
      if (delta) yield delta
    }

    this.usage = {
      model: this.model,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - startedAt,
    }
  }
}

/**
 * Provedor de reserva, usado quando não há chave configurada.
 *
 * Existe para que a interface continue navegável e demonstrável sem
 * credenciais — e para que o erro apareça na tela, em vez de o servidor
 * recusar-se a subir.
 */
export class EchoProvider implements LlmProvider {
  readonly model = 'echo'
  private usage: LlmUsage | null = null

  lastUsage(): LlmUsage | null {
    return this.usage
  }

  async *stream(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string> {
    const startedAt = Date.now()
    const last = messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''
    const reply = `Nenhum modelo está configurado no servidor, então não consigo pensar sobre "${last}". Defina LLM_API_KEY no arquivo .env — o Gemini e o Groq dão chave grátis, sem cartão.`

    for (const word of reply.split(' ')) {
      if (signal.aborted) break
      yield `${word} `
      await new Promise((r) => setTimeout(r, 28))
    }

    this.usage = { model: this.model, latencyMs: Date.now() - startedAt }
  }
}
