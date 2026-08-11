import type { ConversationStore, MessageRole, StoredMessage } from './store.js'
import { ephemeralId, tierFromId, type ConversationTier } from './tiers.js'

/**
 * Facade que roteia a persistência pelo nível da conversa.
 *
 * Implementa a mesma `ConversationStore`, então o resto do servidor trata o
 * tiering como um único armazenamento. As operações específicas de nível
 * (`resolveTier`, `createFor`, `upgrade`) são o que o router de canal usa.
 *
 * Degradações quando falta infraestrutura (nunca derruba o turno):
 *   - nível 2 sem Redis  → stateless
 *   - nível 3 sem banco → stateless
 */

export class TieredConversationStore implements ConversationStore {
  readonly kind = 'tiered' as const

  constructor(
    private readonly redis: { exists(id: string): Promise<boolean>; clear(id: string): Promise<void>; createConversation(): Promise<string>; appendMessage(input: { conversationId: string; role: MessageRole; content: string; metadata?: Record<string, unknown> }): Promise<StoredMessage>; history(id: string): Promise<StoredMessage[]>; close(): Promise<void> } | null,
    private readonly mongo: ConversationStore | null,
  ) {}

  /** Nível atual da conversa, ou null quando desconhecido (precisa classificar). */
  async resolveTier(conversationId: string | null | undefined): Promise<ConversationTier | null> {
    const tier = tierFromId(conversationId)
    // `l1-` volta null de propósito: stateless é transitório, e o turno pode
    // escalar para 2/3 — a classificação roda de novo a cada turno.
    if (tier === 1) return null
    // `l2-` com chave expirada não é mais conversa: some e reclassifica.
    if (tier === 2) return conversationId && (await this.redis?.exists(conversationId)) ? 2 : null
    if (tier === 3) return this.mongo ? 3 : null
    return null
  }

  /** Cria a conversa no storage do nível escolhido; devolve o id a usar. */
  async createFor(tier: ConversationTier, _title: string): Promise<string> {
    if (tier === 1) return ephemeralId(1)
    if (tier === 2) return this.redis ? this.redis.createConversation() : ephemeralId(1)
    return this.mongo ? this.mongo.createConversation(_title) : ephemeralId(1)
  }

  async historyFor(tier: ConversationTier, conversationId: string): Promise<StoredMessage[]> {
    if (tier <= 1) return []
    if (tier === 2) return this.redis ? this.redis.history(conversationId) : []
    return this.mongo ? this.mongo.history(conversationId) : []
  }

  async appendFor(
    tier: ConversationTier,
    conversationId: string,
    input: { role: MessageRole; content: string; metadata?: Record<string, unknown> },
  ): Promise<StoredMessage | null> {
    if (tier <= 1) return null
    if (tier === 2) return this.redis ? this.redis.appendMessage({ ...input, conversationId }) : null
    return this.mongo ? this.mongo.appendMessage({ ...input, conversationId }) : null
  }

  // -------------------------------------------------------------------------
  // Compatibilidade com a interface `ConversationStore`
  // -------------------------------------------------------------------------

  async createConversation(title: string): Promise<string> {
    return this.createFor(1, title)
  }

  async appendMessage(input: {
    conversationId: string
    role: MessageRole
    content: string
    metadata?: Record<string, unknown>
  }): Promise<StoredMessage> {
    const tier = tierFromId(input.conversationId)
    const saved = await this.appendFor(tier ?? 1, input.conversationId, input)
    if (!saved) {
      return {
        id: `lost-${input.conversationId}`,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        timestamp: new Date(),
        metadata: input.metadata ?? null,
      }
    }
    return saved
  }

  async history(conversationId: string): Promise<StoredMessage[]> {
    return this.historyFor(tierFromId(conversationId) ?? 1, conversationId)
  }

  async close(): Promise<void> {
    await this.redis?.close()
    await this.mongo?.close()
  }
}