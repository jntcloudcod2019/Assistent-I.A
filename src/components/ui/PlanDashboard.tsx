import { useEffect, useState } from 'react'
import clsx from 'clsx'

import { usePlanStore } from '@/core/state/planStore'
import {
  activePhase,
  currentWeek,
  pace,
  phaseProgress,
  planProgress,
  totalWeeks,
  type Phase,
  type Plan,
} from '@/core/plan/types'

/**
 * Painel de compromisso.
 *
 * A tela responde três perguntas, nesta ordem de importância: **o que faço
 * hoje**, **estou no ritmo**, e **quanto falta**. A ordem não é estética — um
 * painel que abre mostrando a barra de progresso vira troféu; abrindo no bloco
 * de hoje, vira instrução.
 */
export function PlanDashboard({ onClose }: { onClose: () => void }) {
  const plans = usePlanStore((s) => s.plans)
  // Abre na lista, não num projeto. Entrar direto no primeiro só funcionaria
  // enquanto houvesse um — e a premissa aqui é que vão existir vários.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const plan = plans.find((p) => p.id === selectedId) ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-void/70 p-4 backdrop-blur-sm"
      onPointerDown={onClose}
      role="presentation"
    >
      <section
        onPointerDown={(e) => e.stopPropagation()}
        className="hud-panel flex max-h-[88vh] w-[min(720px,100%)] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Painel de compromissos"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            {plan && (
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Voltar para a lista de projetos"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-holo-700 transition-colors hover:text-holo-100"
              >
                <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M8.5 3 4.5 7l4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <span className="min-w-0">
              <span className="hud-label block">{plan ? 'Compromisso' : 'Compromissos'}</span>
              <span className="mt-0.5 block truncate text-[13px] text-holo-50">
                {plan ? plan.title : `${plans.length} projeto${plans.length === 1 ? '' : 's'}`}
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-holo-700 transition-colors hover:text-holo-100"
          >
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={1.5}>
              <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {plan ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <Today plan={plan} />
            <Overview plan={plan} />
            <Phases plan={plan} />
          </div>
        ) : (
          <ProjectList plans={plans} onOpen={setSelectedId} />
        )}
      </section>
    </div>
  )
}

// — Camadas ————————————————————————————————————————————————

/**
 * Lista de projetos — a tela inicial.
 *
 * Cada cartão mostra o suficiente para escolher onde entrar sem abrir: em que
 * fase está, quanto já foi feito, e se está no ritmo. É o "estou devendo o
 * quê?" respondido de relance, que é a pergunta de quem tem mais de um
 * compromisso em curso.
 */
function ProjectList({ plans, onOpen }: { plans: Plan[]; onOpen: (id: string) => void }) {
  if (plans.length === 0) {
    return (
      <div className="flex-1 px-4 py-8 text-center">
        <p className="text-[13px] text-holo-50">Nenhum compromisso ainda.</p>
        <p className="mt-1 text-[11px] leading-relaxed text-holo-700">
          Descreva um objetivo na conversa e peça ao ALAN para transformá-lo em plano.
        </p>
      </div>
    )
  }

  return (
    <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
      {plans.map((plan) => {
        const { done, total, ratio } = planProgress(plan)
        const { expected, deltaSteps } = pace(plan)
        const phase = activePhase(plan)

        return (
          <li key={plan.id}>
            <button
              type="button"
              onClick={() => onOpen(plan.id)}
              className="w-full rounded-sm border border-white/8 p-3 text-left transition-colors hover:border-holo-400/40 hover:bg-white/[0.02]"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] text-holo-50">{plan.title}</span>
                <span
                  className={clsx(
                    'hud-label shrink-0',
                    deltaSteps < 0 ? 'text-alert' : deltaSteps > 0 ? 'text-holo-300' : 'text-holo-700',
                  )}
                >
                  {deltaSteps === 0
                    ? 'no ritmo'
                    : deltaSteps > 0
                      ? `+${deltaSteps}`
                      : `${deltaSteps}`}
                </span>
              </span>

              <span className="hud-label mt-1 block">
                semana {currentWeek(plan)} de {totalWeeks(plan)} · {phase.title} · {done}/{total} etapas
              </span>

              <span className="relative mt-2 block h-1.5 overflow-hidden rounded-full bg-white/5">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-holo-400"
                  style={{ width: `${ratio * 100}%` }}
                />
                <span
                  className="absolute inset-y-0 w-px bg-amber"
                  style={{ left: `${expected * 100}%` }}
                  aria-hidden
                />
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** O que fazer hoje. Primeiro bloco de propósito: é a pergunta das 8h. */
function Today({ plan }: { plan: Plan }) {
  const phase = activePhase(plan)
  const week = currentWeek(plan)
  const pending = phase.steps.filter((s) => s.doneAt === null)

  return (
    <section className="rounded-sm border border-holo-400/25 bg-holo-400/[0.04] p-3">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="hud-label text-holo-200">Hoje · semana {week}</span>
        <span className="hud-label">
          {phase.title} · {plan.hoursPerDay} h, {plan.daysPerWeek}× por semana
        </span>
      </span>

      <p className="mt-1.5 text-[12px] leading-relaxed text-holo-100/85">{phase.goal}</p>

      <ul className="mt-3 space-y-1.5">
        {plan.dailyBlocks.map((block) => (
          <li key={block.label} className="flex gap-2.5">
            {/* Largura fixa alinha os minutos numa coluna: a soma fica
                conferível de relance, que é o que faz o dia parecer viável. */}
            <span className="hud-label w-12 shrink-0 text-right text-holo-300">{block.minutes} min</span>
            <span className="min-w-0">
              <span className="block text-[12px] text-holo-50">{block.label}</span>
              <span className="block text-[11px] leading-relaxed text-holo-700">{block.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {pending.length > 0 && (
        <p className="hud-label mt-3 border-t border-white/5 pt-2">
          Próxima etapa desta fase: {pending[0].title}
        </p>
      )}
    </section>
  )
}

/** Progresso com referência: número sozinho não cobra nada. */
function Overview({ plan }: { plan: Plan }) {
  const { done, total, ratio } = planProgress(plan)
  const { expected, deltaSteps } = pace(plan)
  const weeks = totalWeeks(plan)

  return (
    <section>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="hud-label">
          {done} de {total} etapas · {weeks} semanas
        </span>
        <span
          className={clsx(
            'hud-label',
            deltaSteps < 0 ? 'text-alert' : deltaSteps > 0 ? 'text-holo-300' : 'text-holo-700',
          )}
        >
          {deltaSteps === 0
            ? 'no ritmo previsto'
            : deltaSteps > 0
              ? `${deltaSteps} etapa${deltaSteps > 1 ? 's' : ''} adiantado`
              : `${-deltaSteps} etapa${-deltaSteps > 1 ? 's' : ''} atrasado`}
        </span>
      </span>

      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/5">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-holo-400 transition-[width] duration-500"
          style={{ width: `${ratio * 100}%` }}
        />
        {/* Marca do esperado: sem ela a barra mostra quanto foi feito, mas não
            se isso é suficiente para a data prometida. */}
        <div
          className="absolute inset-y-0 w-px bg-amber"
          style={{ left: `${expected * 100}%` }}
          aria-hidden
        />
      </div>
      <p className="hud-label mt-1.5">
        A marca âmbar é onde você deveria estar hoje pelo calendário.
      </p>
    </section>
  )
}

function Phases({ plan }: { plan: Plan }) {
  const active = activePhase(plan)
  return (
    <section className="space-y-2">
      {plan.phases.map((phase) => (
        <PhaseCard key={phase.id} plan={plan} phase={phase} isActive={phase.id === active.id} />
      ))}
    </section>
  )
}

function PhaseCard({ plan, phase, isActive }: { plan: Plan; phase: Phase; isActive: boolean }) {
  // A fase corrente abre sozinha; as outras ficam recolhidas para o painel
  // caber na tela sem rolagem infinita.
  const [open, setOpen] = useState(isActive)
  const toggleStep = usePlanStore((s) => s.toggleStep)
  const { done, total, ratio } = phaseProgress(phase)

  return (
    <article
      className={clsx(
        'rounded-sm border transition-colors',
        isActive ? 'border-holo-400/40' : 'border-white/8',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
      >
        <span
          className={clsx(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px]',
            ratio === 1
              ? 'border-holo-300 bg-holo-400/15 text-holo-200'
              : isActive
                ? 'border-holo-400/60 text-holo-200'
                : 'border-white/15 text-holo-700',
          )}
        >
          {ratio === 1 ? '✓' : phase.weeks[0]}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-[13px] text-holo-50">{phase.title}</span>
            <span className="hud-label">
              semanas {phase.weeks[0]}–{phase.weeks[1]}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-holo-700">{phase.goal}</span>
        </span>

        <span className="hud-label shrink-0">
          {done}/{total}
        </span>
      </button>

      {open && (
        <ul className="space-y-1 border-t border-white/5 px-3 py-2">
          {phase.steps.map((step) => (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => toggleStep(plan.id, step.id)}
                aria-pressed={step.doneAt !== null}
                className="flex w-full gap-2.5 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
              >
                <span
                  className={clsx(
                    'mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border text-[9px]',
                    step.doneAt
                      ? 'border-holo-300 bg-holo-400/20 text-holo-100'
                      : 'border-white/20',
                  )}
                >
                  {step.doneAt ? '✓' : ''}
                </span>
                <span className="min-w-0">
                  <span
                    className={clsx(
                      'block text-[12px]',
                      step.doneAt ? 'text-holo-700 line-through' : 'text-holo-50',
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-holo-700">
                    {step.detail}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
