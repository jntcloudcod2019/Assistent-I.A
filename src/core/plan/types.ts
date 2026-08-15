/**
 * Planos de compromisso.
 *
 * O ALAN deixa de só conversar e passa a sustentar um objetivo ao longo de
 * meses. A forma dos dados reflete isso: um plano tem **fases** (blocos de
 * semanas com uma meta verificável), cada fase tem **etapas** (o que se marca
 * como feito), e um **dia típico** que se repete — porque o que faz alguém
 * desistir não é a falta de plano, é não saber o que fazer hoje às 8h.
 *
 * O formato é deliberadamente serializável: hoje vive no `localStorage`, e
 * migra para o MongoDB sem mudar de forma quando `DATABASE_URL` existir.
 */

export interface Step {
  id: string
  title: string
  /** O que exatamente fazer — vago aqui vira procrastinação depois. */
  detail: string
  /** Quando foi concluída, em ms. `null` = pendente. */
  doneAt: number | null
}

export interface Phase {
  id: string
  title: string
  /** Meta verificável: "entender fala lenta sem legenda", não "melhorar". */
  goal: string
  /** Semana inicial e final, 1-indexadas e inclusivas. */
  weeks: [number, number]
  steps: Step[]
}

/** Um bloco do dia típico. A soma dos minutos é a carga diária. */
export interface DailyBlock {
  minutes: number
  label: string
  detail: string
}

/**
 * Lembrete diário do plano.
 *
 * Pertence ao plano, e não a uma configuração global: cada compromisso tem seu
 * horário e sua frase. Um lembrete genérico às 18h30 não diria o que começar.
 */
export interface Reminder {
  enabled: boolean
  /** "HH:MM" em 24 h, no fuso do próprio navegador. */
  at: string
  message: string
  /**
   * Dia em que já disparou, como "AAAA-MM-DD" local.
   *
   * Data e não timestamp: a pergunta é "já avisei HOJE?", e comparar strings
   * de dia responde isso sem aritmética de fuso nem de horário de verão.
   */
  lastFiredOn: string | null
}

export interface Plan {
  id: string
  title: string
  /** Por que isto existe — lido de volta nos dias em que a vontade falta. */
  why: string
  reminder: Reminder
  /** Início em ms; é daqui que sai "em que semana estou". */
  startedAt: number
  hoursPerDay: number
  daysPerWeek: number
  phases: Phase[]
  dailyBlocks: DailyBlock[]
}

// — Derivações ——————————————————————————————————————————————

/** Semana corrente do plano, 1-indexada. */
export function currentWeek(plan: Plan): number {
  const days = Math.floor((Date.now() - plan.startedAt) / 86_400_000)
  return Math.max(1, Math.floor(days / 7) + 1)
}

export function totalWeeks(plan: Plan): number {
  return plan.phases.at(-1)?.weeks[1] ?? 0
}

/** A fase em que a semana atual cai; a última se o plano já passou do fim. */
export function activePhase(plan: Plan): Phase {
  const week = currentWeek(plan)
  return plan.phases.find((p) => week >= p.weeks[0] && week <= p.weeks[1]) ?? plan.phases.at(-1)!
}

export function phaseProgress(phase: Phase): { done: number; total: number; ratio: number } {
  const total = phase.steps.length
  const done = phase.steps.filter((s) => s.doneAt !== null).length
  return { done, total, ratio: total === 0 ? 0 : done / total }
}

export function planProgress(plan: Plan): { done: number; total: number; ratio: number } {
  const steps = plan.phases.flatMap((p) => p.steps)
  const done = steps.filter((s) => s.doneAt !== null).length
  return { done, total: steps.length, ratio: steps.length === 0 ? 0 : done / steps.length }
}

/**
 * Adiantado ou atrasado em relação ao calendário.
 *
 * Compara a fração de etapas concluídas com a fração de semanas decorridas.
 * É o número que responde "estou no ritmo?" — sem ele o painel mostraria
 * progresso sem referência, e progresso sem referência não cobra nada.
 */
export function pace(plan: Plan): { expected: number; actual: number; deltaSteps: number } {
  const weeks = totalWeeks(plan)
  const expected = weeks === 0 ? 0 : Math.min(1, (currentWeek(plan) - 1) / weeks)
  const { ratio: actual, total } = planProgress(plan)
  return { expected, actual, deltaSteps: Math.round((actual - expected) * total) }
}
