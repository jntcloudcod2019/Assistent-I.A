/**
 * Persistência da conversa.
 *
 * A interface vem antes das implementações de propósito: o resto do servidor
 * só conhece `ConversationStore`, então a ausência do banco não impede a
 * conversa de funcionar, e trocar Mongo por outra coisa depois não toca em
 * nenhuma rota.
 */

export type MessageRole = 'user' | 'assistant' | 'system'

export interface StoredMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  timestamp: Date
  metadata?: Record<string, unknown> | null
}

export interface ConversationStore {
  readonly kind: 'mongo' | 'memory' | 'redis' | 'tiered'
  createConversation(title: string): Promise<string>
  appendMessage(input: {
    conversationId: string
    role: MessageRole
    content: string
    metadata?: Record<string, unknown>
  }): Promise<StoredMessage>
  history(conversationId: string): Promise<StoredMessage[]>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// Memória
// ---------------------------------------------------------------------------

/**
 * Guarda tudo em memória do processo. O histórico morre no restart, mas o
 * ciclo de conversa fica inteiro — o que permite verificar voz, streaming e
 * rosto sem depender de infraestrutura.
 */
export class MemoryConversationStore implements ConversationStore {
  readonly kind = 'memory' as const
  private conversations = new Map<string, StoredMessage[]>()
  private seq = 0

  async createConversation(_title: string): Promise<string> {
    const id = `mem-${Date.now().toString(36)}-${(this.seq++).toString(36)}`
    this.conversations.set(id, [])
    return id
  }

  async appendMessage(input: {
    conversationId: string
    role: MessageRole
    content: string
    metadata?: Record<string, unknown>
  }): Promise<StoredMessage> {
    const list = this.conversations.get(input.conversationId) ?? []
    const message: StoredMessage = {
      id: `msg-${(this.seq++).toString(36)}`,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      timestamp: new Date(),
      metadata: input.metadata ?? null,
    }
    list.push(message)
    this.conversations.set(input.conversationId, list)
    return message
  }

  async history(conversationId: string): Promise<StoredMessage[]> {
    return this.conversations.get(conversationId) ?? []
  }

  async close(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// MongoDB via Prisma
// ---------------------------------------------------------------------------

/** Estrutura mínima do cliente Prisma que usamos, para não acoplar ao tipo gerado. */
interface PrismaLike {
  conversation: {
    create(args: { data: { title: string } }): Promise<{ id: string }>
    update(args: { where: { id: string }; data: { updatedAt: Date } }): Promise<unknown>
  }
  message: {
    create(args: { data: Record<string, unknown> }): Promise<{
      id: string
      conversationId: string
      role: string
      content: string
      timestamp: Date
      metadata: unknown
    }>
    findMany(args: {
      where: { conversationId: string }
      orderBy: { timestamp: 'asc' }
    }): Promise<
      Array<{
        id: string
        conversationId: string
        role: string
        content: string
        timestamp: Date
        metadata: unknown
      }>
    >
  }
  $runCommandRaw(command: Record<string, unknown>): Promise<unknown>
  $disconnect(): Promise<void>
}

export class PrismaConversationStore implements ConversationStore {
  readonly kind = 'mongo' as const

  constructor(private prisma: PrismaLike) {}

  /**
   * Liveness de verdade: pergunta ao banco em vez de olhar a configuração.
   *
   * Diferente do Redis, que mantém estado de conexão observável por evento, o
   * cliente do Prisma abre conexão sob demanda — só um comando responde se o
   * banco está mesmo lá.
   */
  async ping(): Promise<boolean> {
    try {
      await this.prisma.$runCommandRaw({ ping: 1 })
      return true
    } catch {
      return false
    }
  }

  async createConversation(title: string): Promise<string> {
    const created = await this.prisma.conversation.create({ data: { title } })
    return created.id
  }

  async appendMessage(input: {
    conversationId: string
    role: MessageRole
    content: string
    metadata?: Record<string, unknown>
  }): Promise<StoredMessage> {
    const row = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        metadata: input.metadata ?? undefined,
      },
    })

    // Mantém `updatedAt` da conversa em dia, para ordenar a lista depois.
    await this.prisma.conversation
      .update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } })
      .catch(() => {
        /* a conversa pode ter sido removida em paralelo; não é fatal */
      })

    return toStored(row)
  }

  async history(conversationId: string): Promise<StoredMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'asc' },
    })
    return rows.map(toStored)
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect()
  }
}

function toStored(row: {
  id: string
  conversationId: string
  role: string
  content: string
  timestamp: Date
  metadata: unknown
}): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as MessageRole,
    content: row.content,
    timestamp: row.timestamp,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }
}

/**
 * Escolhe a implementação disponível.
 *
 * Se o banco estiver configurado mas inacessível, cai para memória com aviso
 * em vez de derrubar o servidor: uma credencial errada não deve impedir você
 * de conversar com o agente.
 */
export async function createStore(databaseUrl: string | undefined): Promise<ConversationStore> {
  if (!databaseUrl) return new MemoryConversationStore()

  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    // Uma leitura barata prova que a conexão e o replica set respondem.
    await prisma.$runCommandRaw({ ping: 1 })
    return new PrismaConversationStore(prisma as unknown as PrismaLike)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(
      `[alan] Banco indisponível, seguindo em memória.\n       Motivo: ${reason.split('\n')[0]}`,
    )
    return new MemoryConversationStore()
  }
}
