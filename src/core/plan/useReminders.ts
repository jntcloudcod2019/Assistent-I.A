import { useEffect } from 'react'

import { usePlanStore } from '@/core/state/planStore'
import { useAlanStore } from '@/core/state/alanStore'
import { speak } from '@/core/speech/speak'
import type { Plan } from './types'

/**
 * Lembretes diários dos planos.
 *
 * O ALAN avisa por três caminhos ao mesmo tempo, porque cada um falha de um
 * jeito: **fala** (não adianta se o som estiver mudo), **notificação do
 * sistema** (não adianta sem permissão) e **mensagem no chat** (não adianta se
 * a janela estiver minimizada). Juntos, algum chega.
 *
 * Limite honesto: isto roda no navegador, então só dispara com a aba aberta.
 * Alerta com o aplicativo fechado exige Service Worker com push, ou um canal
 * externo — e-mail ou mensageiro disparado por um cron no n8n.
 */

/** De quanto em quanto tempo o relógio é conferido. */
const CHECK_MS = 30_000

/**
 * Janela de tolerância depois do horário.
 *
 * Abrir o aplicativo às 18h50 deve disparar o lembrete das 18h30 — você
 * perdeu, e saber disso ainda serve. Abrir às 23h, não: "daqui a alguns
 * minutos comece" já não faz sentido, e um alarme fora de hora ensina a
 * ignorar todos os outros.
 */
const GRACE_MINUTES = 60

/** "AAAA-MM-DD" no fuso local — a chave de "já avisei hoje?". */
function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Minutos desde a meia-noite, para comparar horário sem montar `Date`. */
function minutesOfDay(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes()
}

function parseAt(at: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(at.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/** O lembrete deste plano deve disparar agora? */
export function shouldFire(plan: Plan, now = new Date()): boolean {
  const { reminder } = plan
  if (!reminder.enabled) return false
  if (reminder.lastFiredOn === localDay(now)) return false

  const target = parseAt(reminder.at)
  if (target === null) return false

  const elapsed = minutesOfDay(now) - target
  return elapsed >= 0 && elapsed <= GRACE_MINUTES
}

/**
 * Pede permissão de notificação.
 *
 * Só funciona a partir de um gesto — o navegador ignora o pedido feito no
 * carregamento. Por isso vive num botão, e não num efeito.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

export function useReminders() {
  useEffect(() => {
    const check = () => {
      const { plans, markReminderFired } = usePlanStore.getState()

      for (const plan of plans) {
        if (!shouldFire(plan)) continue

        // Marcar ANTES de avisar: se a fala falhar, o lembrete não pode virar
        // um laço que dispara a cada 30 segundos até o fim do dia.
        markReminderFired(plan.id)

        const text = plan.reminder.message

        // No chat, para ficar registrado depois que a fala passar.
        useAlanStore.getState().addAlanNotice(text)

        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(plan.title, { body: text, tag: `alan-${plan.id}` })
        }

        // A fala é o canal principal: é o ALAN avisando, não o sistema.
        void speak(text)
      }
    }

    check()
    const timer = setInterval(check, CHECK_MS)
    return () => clearInterval(timer)
  }, [])
}
