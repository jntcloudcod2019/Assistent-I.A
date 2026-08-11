import Fastify from 'fastify'

import { env, hasDatabase, hasModel } from './env.js'
import { EchoProvider, OpenAiProvider } from './llm/openai.js'
import type { LlmProvider } from './llm/types.js'
import { buildMessages, titleFrom } from './conversation/prompt.js'
import { createStore, type ConversationStore } from './conversation/store.js'

/**
 * Servidor do ALAN.
 *
 * Fino de propósito: existe porque a chave da API não pode viver no navegador
 * e porque o MongoDB precisa de servidor. Faz três coisas — proxy do modelo,
 * stream de tokens e persistência.
 */

interface ChatBody {
  text?: string
  conversationId?: string
}

const app = Fastify({ logger: { level: 'warn' } })

let store: ConversationStore
let llm: LlmProvider

app.get('/api/health', async () => ({
  ok: true,
  store: store.kind,
  model: llm.model,
  // Deixa explícito o que está faltando, para o diagnóstico não exigir ler log.
  warnings: [
    hasDatabase ? null : 'DATABASE_URL ausente — histórico só em memória',
    hasModel ? null : 'OPENAI_API_KEY ausente — respostas de eco',
  ].filter(Boolean),
}))

/**
 * Turno de conversa, em Server-Sent Events.
 *
 * SSE e não WebSocket: o fluxo é unidirecional e cada evento mapeia 1:1 para um
 * `AgentEvent` do navegador. WebSocket traria estado de conexão sem necessidade.
 */
app.post('/api/chat', async (request, reply) => {
  const body = (request.body ?? {}) as ChatBody
  const text = body.text?.trim()

  if (!text) {
    return reply.code(400).send({ error: 'Campo "text" é obrigatório.' })
  }

  const conversationId = body.conversationId ?? (await store.createConversation(titleFrom(text)))

  reply.hijack()
  const raw = reply.raw
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Impede buffering em proxies; sem isso o stream chega todo de uma vez.
    'X-Accel-Buffering': 'no',
  })

  const send = (event: string, data: unknown) => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Desistir do turno precisa interromper o modelo, senão a resposta continua
  // sendo cobrada depois que ninguém está mais ouvindo.
  const controller = new AbortController()
  request.raw.on('close', () => controller.abort())

  try {
    send('meta', { conversationId })
    send('status', { label: 'Recuperando contexto' })

    const history = await store.history(conversationId)
    await store.appendMessage({ conversationId, role: 'user', content: text })

    send('status', { label: 'Consultando modelo' })

    let answer = ''
    for await (const chunk of llm.stream(buildMessages(history, text), controller.signal)) {
      answer += chunk
      send('token', { text: chunk })
    }

    if (controller.signal.aborted) {
      raw.end()
      return
    }

    const usage = llm.lastUsage()
    const saved = await store.appendMessage({
      conversationId,
      role: 'assistant',
      content: answer,
      metadata: usage
        ? {
            model: usage.model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            latencyMs: usage.latencyMs,
          }
        : undefined,
    })

    send('done', { messageId: saved.id, conversationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida'
    app.log.error({ err: error }, 'turno falhou')
    send('error', { message })
  } finally {
    raw.end()
  }
})

async function main() {
  store = await createStore(env.databaseUrl)
  llm = hasModel
    ? new OpenAiProvider(env.openaiKey!, env.openaiModel)
    : new EchoProvider()

  await app.listen({ port: env.port, host: '127.0.0.1' })

  console.log(`\n  ALAN · servidor em http://127.0.0.1:${env.port}`)
  console.log(`  histórico : ${store.kind === 'mongo' ? 'MongoDB' : 'memória (volátil)'}`)
  console.log(`  modelo    : ${llm.model}${hasModel ? '' : ' (sem chave — respostas de eco)'}\n`)
}

main().catch((error) => {
  console.error('[alan] falha ao subir o servidor:', error)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await store?.close()
    await app.close()
    process.exit(0)
  })
}
