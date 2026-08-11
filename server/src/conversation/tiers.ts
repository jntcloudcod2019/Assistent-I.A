import { randomUUID } from 'node:crypto'

/**
 * Níveis de memória da conversa.
 *
 * Nem toda conversa merece ser armazenada do mesmo jeito — o custo de mandar
 * histórico ao modelo cresce com ele, e nem todo assunto precisa sobreviver.
 * O nível é decidido pelo n8n (classificação antes da resposta) e nunca
 * rebaixa: conversa que sobe de nível migra o contexto para o storage novo.
 *
 *   1 — stateless: nada é gravado, cada turno é independente.
 *   2 — Redis com TTL: memória de curto prazo, expira sozinha.
 *   3 — MongoDB: histórico permanente.
 */

export type ConversationTier = 1 | 2 | 3

/** Quantas mensagens o Redis guarda por conversa de nível 2. */
export const L2_MESSAGE_LIMIT = 20

/** TTL padrão do nível 2 (24h), sobrescrito por REDIS_TTL. */
export const L2_DEFAULT_TTL_SECONDS = 60 * 60 * 24

/**
 * Descobre o nível pelo id.
 *
 * O prefixo é o contrato: `l1-` e `l2-` são efêmeros criados aqui, enquanto
 * id sem prefixo é um ObjectId do MongoDB — logo nível 3 por existir lá.
 */
export function tierFromId(conversationId: string | null | undefined): ConversationTier | null {
  if (!conversationId) return null
  if (conversationId.startsWith('l1-')) return 1
  if (conversationId.startsWith('l2-')) return 2
  return 3
}

let seq = 0

/** Id efêmero para conversas de nível 1 e 2 — nada a ver com o banco. */
export function ephemeralId(tier: 1 | 2): string {
  const prefix = tier === 1 ? 'l1' : 'l2'
  return `${prefix}-${randomUUID()}-${(seq++).toString(36)}`
}

/** Normaliza o tier vindo do n8n; valores inválidos viram null. */
export function toTier(value: unknown): ConversationTier | null {
  if (value === 1 || value === 2 || value === 3) return value
  if (typeof value === 'string' && /^[123]$/.test(value)) return Number(value) as ConversationTier
  return null
}