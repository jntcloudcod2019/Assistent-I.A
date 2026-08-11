import { env } from '../env.js'
import type { StoredMessage } from '../conversation/store.js'
import { toTier, type ConversationTier } from '../conversation/tiers.js'

/**
 * Canal de conversa com o n8n.
 *
 * O n8n é o cérebro quando `N8N_CHAT_WEBHOOK_URL` está setada — e a
 * classificação de memória quando `N8N_CLASSIFY_WEBHOOK_URL` também:
 *
 *   1. nível desconhecido → `alan/classify` (síncrono, devolve `{ tier }`)
 *   2. turno → `alan/chat` (streaming SSE dos tokens do ChatGPT)
 *
 * Este módulo é o relé e o **adaptador de vocabulário**: POST com corpo JSON,
 * leitura incremental do body, e tradução do formato nativo do n8n
 * (`begin`/`item`/`end`/`error` em NDJSON) para o nosso `token`/`done`/`error`
 * — é aqui que a conversão vive, para o `index.ts` não conhecer o n8n.
 *
 * Retry de rede com teto: uma falha antes de qualquer evento
 * (workflow desligado, rede caiu) tenta de novo; a partir do primeiro evento
 * emitido o stream é irreversível e só resta propagar o erro.
 */

const TIMEOUT_MS = 60_000
const MAX_ATTEMPTS = 2

/** Chamada de classificação curta — não precisa do teto do turno inteiro. */
const CLASSIFY_TIMEOUT_MS = 10_000

export interface N8nTurnPayload {
  conversationId: string | null
  tier: number | null
  userText: string
  history: StoredMessage[]
}

export interface N8nFrame {
  event: string
  data: string
}

/**
 * Quadro nativo do n8n em `responseMode: streaming`.
 *
 * Não é SSE: o n8n escreve `JSON.stringify(chunk) + '\n'` direto na resposta
 * (NDJSON). O `content` só vem nos quadros `item`.
 */
interface N8nStructuredChunk {
  type: 'begin' | 'item' | 'end' | 'error'
  content?: string
  metadata?: { nodeId?: string; nodeName?: string; runIndex?: number; itemIndex?: number }
}

/**
 * Converte o vocabulário nativo do n8n para o nosso.
 *
 * `begin` é ruído de controle — o Agent e o Respond to Webhook emitem um cada,
 * então tratá-lo como conteúdo duplicaria marcadores. Vira `null` e some.
 */
function translateChunk(chunk: N8nStructuredChunk): N8nFrame | null {
  switch (chunk.type) {
    case 'item':
      return chunk.content ? { event: 'token', data: JSON.stringify({ text: chunk.content }) } : null
    case 'end':
      return { event: 'done', data: '{}' }
    case 'error':
      return {
        event: 'error',
        data: JSON.stringify({ message: chunk.content ?? 'Falha no workflow n8n.' }),
      }
    default:
      return null
  }
}

/**
 * Divide o fluxo bruto em quadros, aceitando os dois formatos possíveis.
 *
 * O n8n tem dois jeitos de responder em streaming e eles não falam a mesma
 * língua: `responseMode: streaming` emite **NDJSON** (um `StructuredChunk` por
 * linha), enquanto um workflow que monta a resposta à mão pode emitir SSE.
 * Suportar só SSE era um bug silencioso do pior tipo — sem fronteira `\n\n` o
 * parser não rendia quadro nenhum, o turno terminava com resposta vazia e
 * nada era lançado, então nem o fallback para o canal direto entrava.
 *
 * Por isso o parser é orientado a linha e decide por linha, sem modo global:
 * prefixo `event:`/`data:` é SSE, JSON solto é chunk nativo. Um workflow que
 * misture os dois continua legível.
 *
 * O buffer é essencial: um chunk da rede não respeita a fronteira das
 * mensagens — pode trazer meia linha, ou duas e meia.
 */
async function* parseFrames(response: Response, signal: AbortSignal): AsyncIterable<N8nFrame> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  // Bloco SSE em construção; só existe entre um `event:`/`data:` e a linha em
  // branco que o fecha.
  let sseEvent = 'message'
  let sseData: string[] = []

  const flushSse = (): N8nFrame | null => {
    if (!sseData.length) return null
    const frame = { event: sseEvent, data: sseData.join('\n') }
    sseEvent = 'message'
    sseData = []
    return frame
  }

  const handleLine = (line: string): N8nFrame | null => {
    if (line === '') return flushSse()
    if (line.startsWith(':')) return null // comentário/keep-alive SSE
    if (line.startsWith('event:')) {
      sseEvent = line.slice(6).trim()
      return null
    }
    if (line.startsWith('data:')) {
      sseData.push(line.slice(5).trim())
      return null
    }
    try {
      return translateChunk(JSON.parse(line) as N8nStructuredChunk)
    } catch {
      return null
    }
  }

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        // `\r\n` é legal em SSE; sem o trim o `data:` levaria um \r junto.
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')

        const frame = handleLine(line)
        if (frame) yield frame
      }
    }

    // Última linha sem \n final: NDJSON não exige terminador.
    const tail = buffer.trim()
    if (tail) {
      const frame = handleLine(tail)
      if (frame) yield frame
    }
    const pending = flushSse()
    if (pending) yield pending
  } finally {
    reader.cancel().catch(() => {})
  }
}

export async function* chatWithN8n(
  payload: N8nTurnPayload,
  signal: AbortSignal,
): AsyncIterable<N8nFrame> {
  let emitted = false

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const onAbort = () => controller.abort()
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      const response = await fetch(env.n8nChatWebhookUrl!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(env.n8nWebhookSecret
            ? { authorization: `Bearer ${env.n8nWebhookSecret}` }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`n8n respondeu ${response.status}`)
      }

      for await (const frame of parseFrames(response, controller.signal)) {
        emitted = true
        yield frame
      }
      return
    } catch (error) {
      if (signal.aborted) return
      // Só repete se nada ainda foi entregue; meio-stream não tem volta.
      if (emitted || attempt === MAX_ATTEMPTS) {
        throw error instanceof Error ? error : new Error('falha desconhecida no canal n8n')
      }
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
    }
  }
}

/**
 * Classifica o nível de memória da conversa no n8n.
 *
 * Síncrono e barato por design: roda só quando o nível é desconhecido.
 * Qualquer falha vira `null` — o turno segue stateless em vez de quebrar.
 * O workflow `alan/classify` responde `{ "tier": 1 | 2 | 3 }`.
 */
export async function classifyTier(text: string): Promise<ConversationTier | null> {
  if (!env.n8nClassifyWebhookUrl) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS)

  try {
    const response = await fetch(env.n8nClassifyWebhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.n8nWebhookSecret
          ? { authorization: `Bearer ${env.n8nWebhookSecret}` }
          : {}),
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    if (!response.ok) return null

    const body = (await response.json().catch(() => null)) as { tier?: unknown } | null
    return toTier(body?.tier)
  } catch (error) {
    console.warn(
      `[alan] classificação n8n falhou — turno segue stateless.\n       Motivo: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
    )
    return null
  } finally {
    clearTimeout(timeout)
  }
}