/**
 * Domínio da busca de vagas.
 *
 * As etapas do funil são um tipo, não uma string livre, porque o painel, o
 * relatório e o rastreamento por e-mail precisam concordar sobre elas — e um
 * "entrevista_tecnica" digitado num canto e "entrevista tecnica" no outro
 * quebraria a contagem sem erro nenhum aparecer.
 */

export const STAGES = [
  'rascunho',
  'aguardando_envio',
  'enviada',
  'triagem',
  'teste',
  'entrevista',
  'proposta',
  'recusada',
  'desistiu',
] as const

export type Stage = (typeof STAGES)[number]

/** Etapas em que o processo ainda está vivo — o que o painel destaca. */
export const ACTIVE_STAGES: Stage[] = ['aguardando_envio', 'enviada', 'triagem', 'teste', 'entrevista', 'proposta']

/** Rótulos para a tela e para o ALAN falar. */
export const STAGE_LABEL: Record<Stage, string> = {
  rascunho: 'Rascunho',
  aguardando_envio: 'Aguardando envio',
  enviada: 'Candidatura enviada',
  triagem: 'Em triagem',
  teste: 'Teste técnico',
  entrevista: 'Entrevista',
  proposta: 'Proposta',
  recusada: 'Recusada',
  desistiu: 'Desisti',
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
}

export type Seniority = 'pleno' | 'senior' | 'outro'

/** Vaga recém-coletada, antes de virar registro. */
export interface JobInput {
  source: string
  sourceId: string
  url: string
  title: string
  company: string
  location?: string
  workMode?: string
  seniority?: Seniority
  salaryText?: string
  description?: string
  postedAt?: Date
}

/**
 * Classifica a senioridade pelo título.
 *
 * Heurística, e de propósito: chamar o modelo para cada uma de centenas de
 * vagas coletadas custaria caro e demoraria, e o título quase sempre diz. O
 * ALAN entra depois, só nas que passarem por este filtro.
 *
 * Júnior e estágio caem em `outro` e são descartados na coleta — é o filtro
 * "pleno e sênior" que o Jonathan pediu.
 */
export function inferSeniority(title: string): Seniority {
  const t = title.toLowerCase()

  // Testado antes de tudo: "desenvolvedor júnior/pleno" existe, e quem procura
  // pleno não quer a vaga que aceita júnior.
  if (/\b(j[uú]nior|jr\.?|est[aá]gi|intern|trainee|aprendiz)\b/.test(t)) return 'outro'
  if (/\b(s[eê]nior|senior|sr\.?|especialista|staff|principal|lead|l[ií]der|t[eé]ch\s*lead|arquiteto)\b/.test(t)) {
    return 'senior'
  }
  if (/\b(pleno|pl\.?|mid[- ]?level|plena)\b/.test(t)) return 'pleno'

  // Sem marcação, no Brasil, costuma ser pleno — mas fica explícito como
  // incerto para o ALAN decidir na pontuação.
  return 'outro'
}
