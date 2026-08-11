import { useEffect, useRef } from 'react'
import clsx from 'clsx'

import { useAlanStore } from '@/core/state/alanStore'

/**
 * Transcrição da conversa.
 *
 * Rola sozinho apenas quando o usuário já está no fim — arrastar a leitura de
 * volta para baixo enquanto alguém relê uma resposta anterior é hostil.
 */
export function ChatPanel({ className }: { className?: string }) {
  const messages = useAlanStore((s) => s.messages)
  const steps = useAlanStore((s) => s.steps)
  const phase = useAlanStore((s) => s.phase)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages, steps])

  if (messages.length === 0) return null

  return (
    <section
      className={clsx('hud-panel flex max-h-[62vh] w-full flex-col', className)}
      aria-label="Conversa"
    >
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <span className="hud-label">Transcrição</span>
        <span className="hud-label">{messages.length} msg</span>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
        onScroll={(e) => {
          const el = e.currentTarget
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
        // Respostas chegam em streaming; `polite` anuncia sem atropelar.
        aria-live="polite"
      >
        {messages.map((message) => (
          <article key={message.id} className="animate-rise">
            <span
              className="hud-label"
              style={{
                color: message.role === 'user' ? undefined : 'var(--color-holo-300)',
              }}
            >
              {message.role === 'user' ? 'Você' : 'ALAN'}
            </span>
            <p
              className={clsx(
                'mt-1 text-[13px] leading-relaxed',
                message.error && 'text-alert',
                message.role === 'user' ? 'text-holo-100/85' : 'text-holo-50',
              )}
            >
              {message.text}
              {message.streaming && (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-holo-300 animate-pulse-soft" />
              )}
            </p>
          </article>
        ))}

        {phase === 'thinking' && steps.length > 0 && (
          <ul className="space-y-1 border-l border-holo-700 pl-3">
            {steps.map((step) => (
              <li
                key={step.id}
                className={clsx(
                  'hud-label animate-rise',
                  step.state === 'running' && 'animate-pulse-soft',
                )}
              >
                {step.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
