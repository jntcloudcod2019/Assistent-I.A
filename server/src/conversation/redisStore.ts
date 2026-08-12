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

  /** Estado real da conexão, não a presença da variável de ambiente. */
  private live = false
  /** Evita encher o log: o cliente tenta reconectar em loop e erra a cada volta. */
  private warned = false

  constructor(
    url: string,
    private readonly ttlSeconds: number,
    private readonly prefix = 'alan:conv:',
  ) {
    this.redis = createClient({ url })

    // ESTE listener é obrigatório, não decorativo. O cliente é um
    // EventEmitter, e um EventEmitter que emite 'error' sem ninguém ouvindo
    // lança exceção não capturada — que derruba o processo inteiro. O
    // `.catch()` abaixo só cobre a promessa do `connect()`; quando uma
    // conexão JÁ estabelecida cai, o erro vem por aqui. Sem esta linha,
    // desligar o Redis matava o servidor do ALAN junto.
    this.redis.on('error', (error: Error) => {
      this.live = false
      if (this.warned) return
      this.warned = true
      console.warn(
        `[alan] Redis fora do ar — nível 2 degradando para stateless.\n       Motivo: ${error.message.split('\n')[0]}`,
      )
    })

    this.redis.on('ready', () => {
      this.live = true
      this.warned = false
    })
    this.redis.on('end', () => {
      this.live = false
    })

    this.ready = this.redis.connect().catch(() => {
      // Já registrado pelo listener acima; aqui só impedimos a rejeição
      // não tratada.
    })
  }

  /** Usado pelo health check: liveness de verdade, medida na conexão. */
  isLive(): boolean {
    return this.live
  }

  /**
   * Porta de entrada de toda operação.
   *
   * Com o Redis fora, as chamadas precisam falhar em silêncio e devolver algo
   * neutro — o nível 2 é memória de curto prazo, e perder o cache degrada a
   * conversa; lançar derrubaria o turno inteiro.
   */
  private async online(): Promise<boolean> {
    await this.ready
    return this.live
  }

  private key(id: string): string {
    return this.prefix + id
  }

  async exists(id: string): Promise<boolean> {
    if (!(await this.online())) return false
    return (await this.redis.exists(this.key(id))) > 0
  }

  async clear(id: string): Promise<void> {
    if (!(await this.online())) return
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
    const key = this.key(input.conversationId)

    if (!(await this.online())) {
      // Devolve a mensagem como se tivesse gravado: quem chamou precisa do
      // objeto para seguir o turno, e o que se perde é só a persistência.
      return toStored(input.conversationId, 0, input.content ?? '', input.role)
    }

    const raw = await this.redis.get(key)
    const list: CachedMessage[] = raw ? (JSON.parse(raw) as CachedMessage[]) : []
    list.push({ role: input.role, content: input.content, ts: Date.now() })

    const trimmed = list.slice(-L2_MESSAGE_LIMIT)
    await this.redis.set(key, JSON.stringify(trimmed), { EX: this.ttlSeconds })

    return toStored(input.conversationId, trimmed.length - 1, input.content ?? '', input.role)
  }

  async history(conversationId: string): Promise<StoredMessage[]> {
    if (!(await this.online())) return []
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