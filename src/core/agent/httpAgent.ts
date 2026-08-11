import type { AgentClient, AgentEvent } from './types'

/**
 * Cliente do servidor, falando Server-Sent Events.
 *
 * Implementa a mesma interface do agente mockado, então trocar um pelo outro é
 * uma linha — nenhum componente sabe qual está em uso.
 *
 * Não usa `EventSource` de propósito: aquela API só faz GET, e o turno precisa
 * enviar o texto no corpo. `fetch` com leitura incremental do body dá o mesmo
 * streaming com o método certo.
 */

interface SseFrame {
  event: string
  data: string
}

/**
 * Divide o fluxo bruto em quadros SSE.
 *
 * O buffer é essencial: um chunk da rede não respeita a fronteira das
 * mensagens — pode trazer meio evento, ou dois e meio.
 */
async function* parseSse(response: Response, signal: AbortSignal): AsyncIterable<SseFrame> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')

        let event = 'message'
        const dataLines: string[] = []
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length) yield { event, data: dataLines.join('\n') }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export class HttpAgent implements AgentClient {
  /** Mantida entre turnos: é ela que dá memória à conversa. */
  private conversationId: string | null = null

  constructor(private endpoint = '/api/chat') {}

  /** Descarta o contexto e começa uma conversa nova. */
  reset() {
    this.conversationId = null
  }

  /**
   * Retoma uma conversa anterior.
   *
   * Sem isto, reabrir uma sessão salva mostraria o histórico na tela mas
   * começaria do zero para o servidor — o ALAN releria as próprias mensagens
   * como se nunca as tivesse dito.
   */
  resume(conversationId: string | null) {
    this.conversationId = conversationId
  }

  /** Id atual, para a sessão guardar junto com as mensagens. */
  get currentConversationId(): string | null {
    return this.conversationId
  }

  async *send(prompt: string, signal: AbortSignal): AsyncIterable<AgentEvent> {
    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt, conversationId: this.conversationId }),
        signal,
      })
    } catch (error) {
      if (signal.aborted) return
      yield {
        type: 'error',
        message: 'Não consegui falar com o servidor. Ele está rodando na porta 3001?',
      }
      void error
      return
    }

    if (!response.ok) {
      yield { type: 'error', message: `O servidor respondeu ${response.status}.` }
      return
    }

    for await (const frame of parseSse(response, signal)) {
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(frame.data) as Record<string, unknown>
      } catch {
        continue
      }

      switch (frame.event) {
        case 'meta':
          // Primeiro turno: guarda o id para os próximos carregarem o histórico.
          if (typeof payload.conversationId === 'string') {
            this.conversationId = payload.conversationId
          }
          break
        case 'status':
          yield { type: 'status', label: String(payload.label ?? '') }
          break
        case 'token':
          yield { type: 'token', text: String(payload.text ?? '') }
          break
        case 'done':
          yield { type: 'done' }
          return
        case 'error':
          yield { type: 'error', message: String(payload.message ?? 'Falha no servidor.') }
          return
      }
    }
  }
}

export const httpAgent = new HttpAgent()
