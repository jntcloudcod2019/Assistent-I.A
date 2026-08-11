import type { ChatMessage } from '../llm/types.js'
import type { StoredMessage } from './store.js'

/**
 * Identidade do ALAN.
 *
 * A instrução sobre brevidade não é estilo: a resposta será FALADA. Um
 * parágrafo que se lê em segundos leva um minuto para ser ouvido, e listas com
 * marcadores não existem em voz — viram uma enumeração cansativa.
 */
const SYSTEM_PROMPT = `Você é o ALAN — Assistente Linguístico e Analítico Neurodigital.

Fala português do Brasil, em primeira pessoa, com precisão e sem formalidade excessiva.

Suas respostas são FALADAS em voz alta, então:
- Responda em 1 a 3 frases, a menos que peçam detalhe.
- Nada de listas com marcadores, títulos, markdown ou código — nada disso existe em voz.
- Números e siglas por extenso quando a leitura ficar melhor.
- Se não souber, diga que não sabe em vez de inventar.

Você conversa; não executa ações no computador ainda.`

/**
 * Quantas mensagens do histórico acompanham cada turno.
 *
 * O limite existe por custo e latência: mandar a conversa inteira a cada turno
 * cresce sem teto. Vinte mensagens cobrem o contexto imediato — que é o que
 * separa uma conversa de frases soltas.
 */
const HISTORY_LIMIT = 20

export function buildMessages(history: StoredMessage[], userText: string): ChatMessage[] {
  const recent = history.slice(-HISTORY_LIMIT)

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...recent.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    })),
    { role: 'user', content: userText },
  ]
}

/** Título curto derivado da primeira fala, para a conversa ser reconhecível. */
export function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length <= 48 ? clean : `${clean.slice(0, 47)}…`
}
