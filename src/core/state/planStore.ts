import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { ENGLISH_PLAN } from '@/core/plan/englishPlan'
import type { Plan } from '@/core/plan/types'

/**
 * Planos de compromisso, guardados no navegador.
 *
 * Vive no `localStorage` pelo mesmo motivo das sessões: o servidor ainda roda
 * com store em memória (sem `DATABASE_URL`) e perde tudo a cada reinício —
 * inaceitável para um cronograma de dez meses, em que esquecer o progresso
 * destrói justamente o que o plano tenta construir.
 *
 * O formato é o mesmo que irá para o MongoDB, então a migração é copiar, não
 * converter.
 */

interface PlanState {
  plans: Plan[]
  /** Marca ou desmarca uma etapa. Desmarcar é tão necessário quanto marcar. */
  toggleStep: (planId: string, stepId: string) => void
  /** Recomeça o plano a partir de hoje, zerando o progresso. */
  restart: (planId: string) => void
  /** Registra que o lembrete de hoje já disparou. */
  markReminderFired: (planId: string) => void
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set) => ({
      // O plano de inglês entra como semente. Quando o ALAN puder criar planos
      // pela conversa, esta lista deixa de nascer preenchida.
      plans: [ENGLISH_PLAN],

      toggleStep: (planId, stepId) =>
        set((state) => ({
          plans: state.plans.map((plan) =>
            plan.id !== planId
              ? plan
              : {
                  ...plan,
                  phases: plan.phases.map((phase) => ({
                    ...phase,
                    steps: phase.steps.map((step) =>
                      step.id !== stepId ? step : { ...step, doneAt: step.doneAt ? null : Date.now() },
                    ),
                  })),
                },
          ),
        })),

      markReminderFired: (planId) =>
        set((state) => {
          // Data local, não timestamp: a pergunta é "já avisei HOJE?", e
          // comparar o dia responde isso sem aritmética de fuso.
          const now = new Date()
          const pad = (n: number) => String(n).padStart(2, '0')
          const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

          return {
            plans: state.plans.map((plan) =>
              plan.id !== planId ? plan : { ...plan, reminder: { ...plan.reminder, lastFiredOn: today } },
            ),
          }
        }),

      restart: (planId) =>
        set((state) => ({
          plans: state.plans.map((plan) =>
            plan.id !== planId
              ? plan
              : {
                  ...plan,
                  startedAt: Date.now(),
                  phases: plan.phases.map((phase) => ({
                    ...phase,
                    steps: phase.steps.map((step) => ({ ...step, doneAt: null })),
                  })),
                },
          ),
        })),
    }),
    {
      name: 'alan.plans',
      version: 1,
      /**
       * Uma versão nova do cronograma não pode apagar o progresso.
       *
       * As etapas concluídas são reaplicadas por `id` sobre o plano vindo do
       * código. Sem isto, corrigir um texto de etapa zeraria meses de trabalho
       * — e a pessoa perderia a confiança no sistema exatamente quando ele
       * mais precisa dela.
       */
      merge: (persisted, current) => {
        const saved = (persisted as PlanState | undefined)?.plans ?? []
        const doneAtOf = new Map<string, number>()
        const startedAtOf = new Map<string, number>()

        for (const plan of saved) {
          startedAtOf.set(plan.id, plan.startedAt)
          for (const phase of plan.phases) {
            for (const step of phase.steps) {
              if (step.doneAt) doneAtOf.set(`${plan.id}:${step.id}`, step.doneAt)
            }
          }
        }

        return {
          ...current,
          plans: current.plans.map((plan) => ({
            ...plan,
            startedAt: startedAtOf.get(plan.id) ?? plan.startedAt,
            phases: plan.phases.map((phase) => ({
              ...phase,
              steps: phase.steps.map((step) => ({
                ...step,
                doneAt: doneAtOf.get(`${plan.id}:${step.id}`) ?? null,
              })),
            })),
          })),
        }
      },
    },
  ),
)
