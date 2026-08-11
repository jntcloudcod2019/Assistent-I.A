import { createClient, type RedisClientType } from 'redis'

import type { ConversationStore, MessageRole, StoredMessage } from './store.js'
import { L2_MESSAGE_LIMIT, ephemeralId } from './tiers.js'

/**
 * Memória de curto prazo da conversa (nível 2).
 *
 * Cada conversa é uma chave Redis com as últimas mensagens e TTL — expira
 * sozinha, sem job de limpeza. Mensagens demais são podadas no append, para
 * a chave nunca crescer além do que o contexto do modelo aguenta.
 */

interface CachedMessage {
  role: MessageRole
  content: string
  ts: number
}

export class RedisConversationStore implements ConversationStore {
  readonly kind = 'redis' as const
  private redis: RedisClientType
  private ready: Promise<unknown>

  constructor(
    url: string,
    private readonly ttlSeconds: number,
    private readonly prefix = 'alan:conv:',
  ) {
    this.redis = createClient({ url })
    this.ready = this.redis.connect().catch((error) => {
      // Construtor não pode lançar assíncrono; o erro aparece na primeira
      // operação, quando `resolveTier` devolve null e o nível 2 degrada.
      console.warn(`[alan] Redis indisponível — nível 2 degradando para stateless.\n       Motivo: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
    })
  }

  private key(id: string): string {
    return this.prefix + id
  }

  async exists(id: string): Promise<boolean> {
    await this.ready
    return (await this.redis.exists(this.key(id))) > 0
  }

  async clear(id: string): Promise<void> {
    await this.ready
    await this.redis.del(this.key(id))
  }

  async createConversation(): Promise<string> {
    return ephemeralId(2)
  }

  async appendMessage(input: {
    conversationId: string
    role: MessageRole
    content: string
    metadata?: Record<string, unknown>
  }): Promise<StoredMessage> {
    await this.ready
    const key = this.key(input.conversationId)

    const raw = await this.redis.get(key)
    const list: CachedMessage[] = raw ? (JSON.parse(raw) as CachedMessage[]) : []
    list.push({ role: input.role, content: input.content, ts: Date.now() })

    const trimmed = list.slice(-L2_MESSAGE_LIMIT)
    await this.redis.set(key, JSON.stringify(trimmed), { EX: this.ttlSeconds })

    return toStored(input.conversationId, trimmed.length - 1, input.content ?? '', input.role)
  }

  async history(conversationId: string): Promise<StoredMessage[]> {
    await this.ready
    const raw = await this.redis.get(this.key(conversationId))
    if (!raw) return []
    const list = JSON.parse(raw) as CachedMessage[]
    return list.map((m, i) => toStored(conversationId, i, m.content, m.role, m.ts))
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => {})
  }
}

function toStored(
  conversationId: string,
  index: number,
  content: string,
  role: MessageRole,
  ts?: number,
): StoredMessage {
  return {
    id: `${conversationId}:${index}`,
    conversationId,
    role,
    content,
    timestamp: new Date(ts ?? Date.now()),
    metadata: null,
  }
}