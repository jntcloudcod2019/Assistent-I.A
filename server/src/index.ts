import Fastify from 'fastify'
import websocket from '@fastify/websocket'

import { env, hasDatabase, hasModel, hasN8n, hasRedis, hasVoice } from './env.js'
import { createWhisperCppProvider } from './stt/whisperCpp.js'
import { registerVoiceRoute } from './voice/socket.js'
import type { SttProvider } from './stt/types.js'
import { EchoProvider, OpenAiProvider } from './llm/openai.js'
import type { LlmProvider } from './llm/types.js'
import { buildMessages, titleFrom } from './conversation/prompt.js'
import { createStore, PrismaConversationStore, type ConversationStore } from './conversation/store.js'
import { collectProbes, describeProbes } from './health/probes.js'
import { JobStore } from './jobs/store.js'
import { registerJobRoutes } from './jobs/routes.js'
import { registerCollectRoutes } from './collect/routes.js'
import { RedisConversationStore } from './conversation/redisStore.js'
import { TieredConversationStore } from './conversation/tiered.js'
import { toTier, type ConversationTier } from './conversation/tiers.js'
import { chatWithN8n } from './gateway/n8nChat.js'

/**
 * Servidor do ALAN.
 *
 * Fino de propósito: existe porque a chave da API não pode viver no navegador
 * e porque o MongoDB precisa de servidor. Faz três coisas — proxy do modelo,
 * stream de tokens e persistência.
 *
 * Dois canais de conversa, escolhidos pela presença de `N8N_CHAT_WEBHOOK_URL`:
 *  - direto: o servidor fala com o modelo (OpenAI) e guarda no store comum.
 *  - n8n: o turno vai para o workflow do n8n, que classifica o nível de
 *    memória (1 stateless, 2 Redis, 3 MongoDB) e conversa com o ChatGPT.
 *    Este servidor vira o relé SSE e o dono da persistência por nível.
 */

interface ChatBody {
  text?: string
  conversationId?: string
  /**
   * Nível de memória escolhido ao abrir a conversa (1, 2 ou 3).
   *
   * Só é lido no primeiro turno: a partir daí o nível vive no prefixo do
   * `conversationId` e `resolveTier` o deduz de lá. Valor inválido vira `null`
   * em `toTier`, e a conversa segue stateless em vez de quebrar.
   */
  tier?: unknown
}

type Send = (event: string, data: unknown) => void

const app = Fastify({ logger: { level: 'warn' } })

let store: ConversationStore
let tiered: TieredConversationStore | null = null
let llm: LlmProvider
let stt: SttProvider | null = null

// Referências diretas para as sondas: o `store` pode ser a facade em níveis,
// que esconde qual instância é qual — e sondar precisa falar com cada uma.
let redisStore: RedisConversationStore | null = null
let mongoStore: PrismaConversationStore | null = null

/**
 * Raiz do servidor.
 *
 * Este processo é só a API — a interface vive no Vite, noutra porta. Abrir a
 * porta do servidor no navegador é o primeiro reflexo de qualquer um, e sem
 * esta rota a resposta era um 404 em JSON, que parece defeito e não é. Aqui a
 * porta de entrada diz o que este processo é e para onde ir.
 */
app.get('/', async (_request, reply) => {
  reply.type('text/html; charset=utf-8')
  return `<!doctype html>
<meta charset="utf-8">
<title>ALAN · API</title>
<style>
  body { background:#02080d; color:#b8f5ff; font:14px/1.7 ui-monospace,monospace;
         display:grid; place-items:center; min-height:100vh; margin:0 }
  main { max-width:34rem; padding:2rem }
  h1 { font-size:13px; letter-spacing:.22em; text-transform:uppercase; color:#3ddaf5 }
  a { color:#7febff }
  code { color:#eafcff }
  .muted { color:#08596b }
</style>
<main>
  <h1>ALAN · servidor</h1>
  <p>Este processo é apenas a API. Ele existe porque a chave do modelo não pode
     viver no navegador e porque o banco precisa de servidor.</p>
  <p><strong>A interface está em <a href="http://localhost:5173">localhost:5173</a></strong>
     — é lá que o ALAN aparece.</p>
  <p class="muted">Rotas: <code>GET /api/health</code> · <code>POST /api/chat</code> (SSE)</p>
</main>`
})

/**
 * Estado do sistema, medido e não deduzido da configuração.
 *
 * A versão anterior lia variáveis de ambiente e afirmava que tudo ia bem
 * enquanto o Redis estava morto. Agora cada dependência é perguntada — e
 * `ok` só é verdadeiro quando nada configurado está fora do ar. Ausência
 * deliberada (`disabled`) não conta como falha.
 */
app.get('/api/health', async () => {
  const probes = await collectProbes({ redis: redisStore, mongo: mongoStore })
  const offline = probes.filter((p) => p.status === 'offline')

  return {
    ok: offline.length === 0,
    store: store.kind,
    channel: hasN8n ? 'n8n' : 'direct',
    probes,
    // Só o que está genuinamente quebrado: uma lista que sempre tem itens
    // deixa de ser lida.
    warnings: offline.map((p) => `${p.label}: ${p.detail}`),
  }
})

/**
 * Turno de conversa, em Server-Sent Events.
 *
 * SSE e não WebSocket: o fluxo é unidirecional e cada evento mapeia 1:1 para um
 * `AgentEvent` do navegador. WebSocket traria estado de conexão sem necessidade.
 *
 * Eventos enviados ao navegador: `meta` (conversationId, tier), `status`,
 * `token`, `done`, `error` — o contrato do frontend não muda entre canais.
 */
app.post('/api/chat', async (request, reply) => {
  const body = (request.body ?? {}) as ChatBody
  const text = body.text?.trim()

  if (!text) {
    return reply.code(400).send({ error: 'Campo "text" é obrigatório.' })
  }

  reply.hijack()
  const raw = reply.raw
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Impede buffering em proxies; sem isso o stream chega todo de uma vez.
    'X-Accel-Buffering': 'no',
  })

  const send: Send = (event, data) => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Desistir do turno precisa interromper o modelo, senão a resposta continua
  // sendo cobrada depois que ninguém está mais ouvindo.
  //
  // O evento é no `reply.raw`, não no `request.raw`: o IncomingMessage emite
  // 'close' assim que o corpo chega inteiro (início do turno), e não quando o
  // cliente desconecta. É no ServerResponse que 'close' significa conexão
  // encerrada — e como só acontece depois do `raw.end()`, não corta o final.
  const controller = new AbortController()
  reply.raw.on('close', () => controller.abort())

  try {
    if (tiered) {
      await runN8nTurn({
        text,
        conversationId: body.conversationId,
        tier: toTier(body.tier) ?? undefined,
        send,
        signal: controller.signal,
      })
    } else {
      await runDirectTurn({ text, conversationId: body.conversationId, send, signal: controller.signal })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida'
    app.log.error({ err: error }, 'turno falhou')
    send('error', { message })
  } finally {
    raw.end()
  }
})

// ---------------------------------------------------------------------------
// Canal direto (legado): servidor fala com o modelo
// ---------------------------------------------------------------------------

async function runDirectTurn(input: {
  text: string
  conversationId?: string
  send: Send
  signal: AbortSignal
}): Promise<void> {
  const { text, send, signal } = input
  const conversationId = input.conversationId ?? (await store.createConversation(titleFrom(text)))

  send('meta', { conversationId })
  send('status', { label: 'Recuperando contexto' })

  const history = await store.history(conversationId)
  await store.appendMessage({ conversationId, role: 'user', content: text })

  send('status', { label: 'Consultando modelo' })

  let answer = ''
  // As sondas ficam em cache por alguns segundos, então anexar o estado a cada
  // turno não vira carga sobre as dependências.
  const systemState = describeProbes(await collectProbes({ redis: redisStore, mongo: mongoStore }))

  for await (const chunk of llm.stream(buildMessages(history, text, systemState), signal)) {
    answer += chunk
    send('token', { text: chunk })
  }

  if (signal.aborted) return

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
}

// ---------------------------------------------------------------------------
// Canal n8n: classificação de memória + relé SSE
// ---------------------------------------------------------------------------

async function runN8nTurn(input: {
  text: string
  conversationId?: string
  /** Nível escolhido ao abrir a conversa. Só vale no primeiro turno. */
  tier?: ConversationTier
  send: Send
  signal: AbortSignal
}): Promise<void> {
  const { text, send, signal } = input
  let conversationId = input.conversationId
  let idCreated = false

  // Nível desconhecido (primeira mensagem, `l1-` ou Redis expirado)? O n8n
  // classifica antes do turno — só aí sabemos onde (e se) o turno será
  // armazenado. Nível nunca rebaixa: id `l1-`/`l2-` pode subir e ganhar
  // storage; id do MongoDB é permanente.
  let tier = await tiered!.resolveTier(conversationId)
  if (tier === null && input.tier) {
    // Nível escolhido por quem abriu a conversa. Antes isto era decidido por um
    // classificador no n8n; agora quem decide é a pessoa, uma vez, e o nível
    // gruda no prefixo do id a partir daqui.
    tier = input.tier
    conversationId = await tiered!.createFor(tier, titleFrom(text))
    idCreated = true
  }

  if (idCreated) {
    send('meta', { conversationId, tier })
  }

  send('status', { label: tier ? 'Recuperando contexto' : 'Sem contexto (conversa stateless)' })

  // A ORDEM aqui é o que faz a memória funcionar, e ela é fácil de errar:
  //
  // 1. Ler o histórico ANTES de gravar a mensagem atual. Invertido, o histórico
  //    já conteria a pergunta que também vai em `userText`, e o modelo a leria
  //    duas vezes.
  // 2. Gravar a mensagem do usuário em TODO turno, e não só na criação da
  //    conversa. Preso ao `idCreated`, só a primeira pergunta era guardada e o
  //    histórico virava [usuário₁, ALAN₁, ALAN₂, …] — um diálogo em que só um
  //    dos lados é lembrado, pior que memória nenhuma.
  const history = tier ? await tiered!.historyFor(tier, conversationId!) : []

  if (tier && tier >= 2 && conversationId) {
    await tiered!.appendFor(tier, conversationId, { role: 'user', content: text })
  }

  let answer = ''
  let finished = false
  let failed = false

  try {
    for await (const frame of chatWithN8n(
      {
        conversationId: tier ? conversationId ?? null : null,
        tier,
        userText: text,
        history,
        // O workflow não tem como sondar nada: quem enxerga Redis, Mongo e
        // whisper é este processo. Vai no payload para o Agent do n8n poder
        // responder sobre o estado sem inventar.
        systemState: describeProbes(await collectProbes({ redis: redisStore, mongo: mongoStore })),
      },
      signal,
    )) {
      if (signal.aborted || finished || failed) break

      let data: Record<string, unknown>
      try {
        data = JSON.parse(frame.data) as Record<string, unknown>
      } catch {
        continue
      }

      switch (frame.event) {
        case 'status':
          send('status', { label: String(data.label ?? '') })
          break
        case 'token':
        // O streaming nativo do n8n entrega chunkers com nomes próprios
        // (`item`, `message`); trata todos como token, lendo o campo certo.
        case 'item':
        case 'message': {
          const chunk = String(
            data.text ?? data.content ?? data.delta ?? data.output ?? frame.data ?? '',
          )
          if (!chunk) break
          answer += chunk
          send('token', { text: chunk })
          break
        }
        case 'done':
          finished = true
          break
        case 'error':
          // O registro de saúde do canal fica em `chatWithN8n`, que enxerga
          // o stream inteiro — duplicar aqui daria duas fontes de verdade.
          failed = true
          send('error', { message: String(data.message ?? 'Falha no canal n8n.') })
          break
      }
    }
  } catch (error) {
    // Workflow desligado, rede caiu, timeout: o n8n não pode derrubar a
    // conversa. Cai para o modelo direto.
    app.log.warn({ err: error }, 'canal n8n falhou — caindo para o modelo direto')
    await runDirectTurn({ text, conversationId, send, signal })
    return
  }

  if (signal.aborted) return
  if (failed) return

  if (tier && tier >= 2) {
    await tiered!.appendFor(tier, conversationId!, { role: 'assistant', content: answer })
  }

  send('done', { conversationId: conversationId ?? null })
}

/**
 * Sobe a porta, tolerando a corrida do `tsx watch`.
 *
 * Salvar um arquivo reinicia o processo, e por alguns instantes a instância
 * antiga ainda segura a 3001 — o novo bind falha com EADDRINUSE. Antes isso
 * caía no `process.exit(1)` e matava o servidor de vez: o watcher não sobe
 * outro, então a porta ficava morta até alguém reiniciar à mão, e o front
 * passava a receber 500 do proxy do Vite. Uma corrida transitória não pode
 * ser fatal; só desiste se a porta seguir ocupada de verdade.
 */
async function listenWithRetry(attempts = 12, delayMs = 400): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await app.listen({ port: env.port, host: '127.0.0.1' })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'EADDRINUSE' || attempt >= attempts) throw error
      if (attempt === 1) {
        console.log(`  porta ${env.port} ocupada — esperando a instância anterior sair…`)
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

async function main() {
  const legacyStore = await createStore(env.databaseUrl)

  // As sondas precisam da instância concreta, não da interface: só o cliente
  // do Redis sabe se está conectado, e só o do Prisma sabe responder a um ping.
  if (legacyStore instanceof PrismaConversationStore) mongoStore = legacyStore

  if (hasN8n) {
    store = legacyStore
    redisStore = hasRedis ? new RedisConversationStore(env.redisUrl!, env.redisTtlSeconds) : null
    tiered = new TieredConversationStore(redisStore, legacyStore)
  } else {
    store = legacyStore
  }

  llm = hasModel
    ? new OpenAiProvider(env.llmKey!, env.llmModel, env.llmBaseUrl)
    : new EchoProvider()

  if (mongoStore) {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: env.databaseUrl! } } })
    const jobStore = new JobStore(prisma)
    registerJobRoutes(app, jobStore)
    // A coleta por navegador acompanha as rotas de vaga: sem banco não há
    // onde guardar o resultado, então não faz sentido existir sozinha.
    registerCollectRoutes(app, jobStore)
  }

  if (hasVoice) {
    stt = createWhisperCppProvider({
      modelPath: env.whisperModel!,
      port: env.whisperPort,
      language: env.whisperLanguage,
    })
    // O WebSocket precisa estar registrado antes do `listen`; o modelo em si
    // só carrega quando o primeiro microfone abre.
    await app.register(websocket)
    registerVoiceRoute(app, stt)
  }

  await listenWithRetry()

  console.log(`\n  ALAN · servidor em http://127.0.0.1:${env.port}`)
  console.log(`  canal     : ${hasN8n ? `n8n (${new URL(env.n8nChatWebhookUrl!).host})` : 'direto (OpenAI)'}`)
  if (hasN8n) {
    console.log(`  classifica: ${env.n8nClassifyWebhookUrl ? 'n8n' : 'desligado — toda conversa é stateless'}`)
  }
  console.log(`  histórico : ${store.kind === 'mongo' ? 'MongoDB' : 'memória (volátil)'}`)
  if (tiered) {
    console.log(`  memória   : nível 1 stateless · nível 2 ${hasRedis ? 'redis' : 'stateless (sem REDIS_URL)'} · nível 3 ${hasDatabase ? 'mongo' : 'memória (sem DATABASE_URL)'}`)
  }
  console.log(`  modelo    : ${llm.model}${hasModel ? '' : ' (sem chave — respostas de eco)'}`)
  console.log(`  voz       : ${stt ? `${stt.name} · ws://127.0.0.1:${env.port}/api/voice` : 'desligada (sem WHISPER_MODEL)'}\n`)
}

main().catch((error) => {
  console.error('[alan] falha ao subir o servidor:', error)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await store?.close()
    await tiered?.close()
    // Sem isto o whisper-server fica órfão segurando 465 MB.
    await stt?.close()
    await app.close()
    process.exit(0)
  })
}