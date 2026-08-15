import { env, hasDatabase, hasModel, hasN8n, hasRedis, hasVoice } from '../env.js'
import { n8nHealth } from '../gateway/n8nChat.js'
import type { RedisConversationStore } from '../conversation/redisStore.js'
import type { PrismaConversationStore } from '../conversation/store.js'

/**
 * Sondas de dependência.
 *
 * O health anterior reportava **configuração**, não liveness: `hasRedis` era
 * `Boolean(env.redisUrl)`, então ele afirmava que o Redis estava bem mesmo com
 * o Redis morto. É o oposto do que se pede a um health check — e foi assim que
 * uma queda passou despercebida até o servidor cair junto.
 *
 * Aqui cada dependência é perguntada de verdade. Três decisões que sustentam
 * isso:
 *
 * 1. **Timeout curto e por sonda.** Uma dependência pendurada não pode fazer o
 *    health inteiro pendurar — seria trocar um diagnóstico ruim por nenhum.
 * 2. **Resultado em cache.** Uma tela aberta consultando estado viraria carga
 *    constante sobre o banco. Alguns segundos de defasagem são aceitáveis;
 *    um Mongo sob polling não é.
 * 3. **Ausente ≠ quebrado.** Sem `DATABASE_URL` o nível 3 está *desligado*,
 *    não *fora do ar*. Misturar os dois faria uma configuração deliberada
 *    parecer incidente.
 */

export type ProbeStatus =
  /** Respondeu. */
  | 'online'
  /** Configurado, mas não respondeu. É o único caso que merece alarme. */
  | 'offline'
  /** Não configurado — ausência deliberada, não falha. */
  | 'disabled'
  /** Configurado, mas ainda não exercitado — sondar custaria caro demais. */
  | 'unknown'

export interface Probe {
  id: string
  label: string
  status: ProbeStatus
  /** Frase curta em português, pronta para a tela e para o modelo ler. */
  detail: string
  latencyMs?: number
}

/** Janela de cache. Curta o bastante para ser útil num diagnóstico ao vivo. */
const CACHE_MS = 5_000

/** Teto por sonda. Acima disto a dependência conta como fora do ar. */
const TIMEOUT_MS = 2_000

export interface ProbeDeps {
  redis: RedisConversationStore | null
  mongo: PrismaConversationStore | null
}

let cache: { at: number; probes: Probe[] } | null = null

/** Mede quanto uma sonda levou, com teto. Falha e estouro viram `false`. */
async function timed(run: (signal: AbortSignal) => Promise<boolean>) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const ok = await run(controller.signal)
    return { ok, latencyMs: Date.now() - started }
  } catch {
    return { ok: false, latencyMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Sonda um webhook barato com um POST vazio.
 *
 * Só serve para workflows **sem modelo**, como o `alan/classify`, que é um nó
 * Code e responde de graça. Jamais usar em `alan/chat`: aquele POST executa o
 * agente e gasta uma requisição da cota gratuita do Gemini. Ver `n8nHealth`.
 */
async function probeCheapWebhook(url: string, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal,
  })
  // 404 é resposta: o n8n está de pé, mas o workflow não está publicado. Isso
  // é `offline` para nós, porque do ponto de vista do turno dá no mesmo.
  return response.status !== 404
}

export async function collectProbes(deps: ProbeDeps): Promise<Probe[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.probes

  const probes: Probe[] = []

  // — Modelo ————————————————————————————————————————————————
  // Sem sonda ativa de propósito: a única forma de saber se a chave funciona é
  // gastar uma requisição, e um health que consome cota a cada consulta é um
  // health que ninguém pode deixar aberto.
  probes.push(
    hasN8n
      ? {
          id: 'model',
          label: 'Núcleo cognitivo',
          status: 'online',
          detail: 'Respondendo pelo workflow do n8n.',
        }
      : hasModel
        ? {
            id: 'model',
            label: 'Núcleo cognitivo',
            status: 'online',
            detail: `Canal direto com ${env.llmModel}.`,
          }
        : {
            id: 'model',
            label: 'Núcleo cognitivo',
            status: 'disabled',
            detail: 'Sem LLM_API_KEY — as respostas são apenas eco.',
          },
  )

  // — n8n ————————————————————————————————————————————————————
  if (hasN8n) {
    // Liveness da instância, não do workflow: um GET na raiz é gratuito,
    // enquanto um POST no webhook de conversa executaria o agente.
    const base = new URL(env.n8nChatWebhookUrl!).origin
    const alive = await timed(async (signal) => {
      await fetch(base, { signal })
      return true
    })

    probes.push({
      id: 'n8n',
      label: 'Automação (n8n)',
      status: alive.ok ? 'online' : 'offline',
      detail: alive.ok ? `Instância respondendo em ${base}.` : `Nada respondendo em ${base}.`,
      latencyMs: alive.latencyMs,
    })

    // O estado do workflow de conversa vem do tráfego real, e não de uma
    // sonda: cada turno já prova se ele funciona, de graça.
    const { lastOkAt, lastFailAt, lastError } = n8nHealth
    probes.push(
      lastOkAt === 0 && lastFailAt === 0
        ? {
            id: 'n8n-chat',
            label: 'Workflow de conversa',
            status: 'unknown',
            detail: 'Ainda não exercitado — o estado aparece após a primeira mensagem.',
          }
        : lastFailAt > lastOkAt
          ? {
              id: 'n8n-chat',
              label: 'Workflow de conversa',
              status: 'offline',
              detail: `Última tentativa falhou: ${lastError}`,
            }
          : {
              id: 'n8n-chat',
              label: 'Workflow de conversa',
              status: 'online',
              detail: 'Último turno respondeu normalmente.',
            },
    )
  }

  if (env.n8nClassifyWebhookUrl) {
    // Este pode ser sondado: é um nó Code, sem modelo e sem custo.
    const classify = await timed((signal) => probeCheapWebhook(env.n8nClassifyWebhookUrl!, signal))
    probes.push({
      id: 'n8n-classify',
      label: 'Classificação de memória',
      status: classify.ok ? 'online' : 'offline',
      detail: classify.ok
        ? 'Webhook alan/classify publicado.'
        : 'Webhook alan/classify não responde — sem ele toda conversa fica sem memória.',
      latencyMs: classify.latencyMs,
    })
  } else {
    probes.push({
      id: 'n8n-classify',
      label: 'Classificação de memória',
      status: 'disabled',
      detail: 'Sem N8N_CLASSIFY_WEBHOOK_URL — toda conversa é stateless.',
    })
  }

  // — Memória de curto prazo ————————————————————————————————
  probes.push(
    !hasRedis
      ? {
          id: 'redis',
          label: 'Memória de curto prazo',
          status: 'disabled',
          detail: 'Sem REDIS_URL — o nível 2 degrada para stateless.',
        }
      : deps.redis?.isLive()
        ? {
            id: 'redis',
            label: 'Memória de curto prazo',
            status: 'online',
            detail: `Redis conectado, expirando em ${env.redisTtlSeconds}s.`,
          }
        : {
            id: 'redis',
            label: 'Memória de curto prazo',
            status: 'offline',
            detail: 'Redis configurado mas sem conexão — o nível 2 está degradado.',
          },
  )

  // — Memória permanente ————————————————————————————————————
  if (!hasDatabase) {
    probes.push({
      id: 'mongo',
      label: 'Memória permanente',
      status: 'disabled',
      detail: 'Sem DATABASE_URL — o histórico morre quando o servidor reinicia.',
    })
  } else {
    const mongo = await timed(async () => (deps.mongo ? deps.mongo.ping() : false))
    probes.push({
      id: 'mongo',
      label: 'Memória permanente',
      status: mongo.ok ? 'online' : 'offline',
      detail: mongo.ok
        ? 'MongoDB respondendo.'
        : 'MongoDB configurado mas não respondeu ao ping.',
      latencyMs: mongo.latencyMs,
    })
  }

  // — Transcrição ————————————————————————————————————————————
  if (!hasVoice) {
    probes.push({
      id: 'whisper',
      label: 'Transcrição de voz',
      status: 'disabled',
      detail: 'Sem WHISPER_MODEL — a escuta acontece no navegador.',
    })
  } else {
    const whisper = await timed(async (signal) => {
      // Qualquer resposta serve: o processo do modelo está no ar.
      await fetch(`http://127.0.0.1:${env.whisperPort}`, { signal })
      return true
    })
    probes.push({
      id: 'whisper',
      label: 'Transcrição de voz',
      status: whisper.ok ? 'online' : 'offline',
      detail: whisper.ok
        ? 'whisper-server carregado e pronto.'
        : 'whisper-server ainda não subiu — ele carrega no primeiro microfone aberto.',
      latencyMs: whisper.latencyMs,
    })
  }

  cache = { at: Date.now(), probes }
  return probes
}

/**
 * Resumo em texto para o system prompt.
 *
 * É o que permite ao ALAN responder "como está a conexão com o banco?" com a
 * verdade em vez de uma invenção plausível — sem isto o modelo não tem como
 * saber, e um modelo sem informação sobre si mesmo não hesita: ele inventa.
 */
export function describeProbes(probes: Probe[]): string {
  const linha = (p: Probe) => {
    const marca = p.status === 'online' ? 'no ar' : p.status === 'offline' ? 'FORA DO AR' : 'desligado'
    return `- ${p.label}: ${marca}. ${p.detail}`
  }
  return probes.map(linha).join('\n')
}
