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

/**
 * Estado do sistema anexado ao prompt.
 *
 * Sem isto, perguntar "como está a conexão com o banco?" produz uma resposta
 * plausível e inventada — um modelo sem informação sobre si mesmo não hesita,
 * ele preenche a lacuna. Anexar o resultado das sondas é o que troca palpite
 * por fato.
 *
 * Vai no fim do bloco de sistema e não como mensagem separada: é contexto
 * sobre quem responde, não algo que alguém disse na conversa.
 */
function systemBlock(systemState?: string): string {
  if (!systemState) return SYSTEM_PROMPT

  return `${SYSTEM_PROMPT}

ESTADO ATUAL DOS SEUS SISTEMAS (medido agora, não suponha nada além disto):
${systemState}

Quando perguntarem sobre conexão, banco de dados, memória ou serviços, responda
com base nesta lista. Se algo estiver fora do ar, diga o que é e o efeito
prático — sem jargão de infraestrutura.`
}

export function buildMessages(
  history: StoredMessage[],
  userText: string,
  systemState?: string,
): ChatMessage[] {
  const recent = history.slice(-HISTORY_LIMIT)

  return [
    { role: 'system', content: systemBlock(systemState) },
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
