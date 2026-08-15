import { useEffect, type ReactNode } from 'react'
import clsx from 'clsx'

import { useSettingsStore } from '@/core/state/settingsStore'

/**
 * Tela de configurações.
 *
 * Estruturada em seções nomeadas em vez de uma lista de interruptores: o
 * caminho "Agente ALAN → Exibição → forma" é o que dá lugar às próximas
 * opções sem virar uma pilha de casinhas soltas.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  // Escapar é o reflexo universal para fechar sobreposição; sem isso a única
  // saída seria mirar o botão.
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
      // Clique fora fecha; cliques de dentro não sobem por causa do stopPropagation.
      onPointerDown={onClose}
      role="presentation"
    >
      <section
        onPointerDown={(e) => e.stopPropagation()}
        className="hud-panel flex max-h-[85vh] w-[min(560px,100%)] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Configurações"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="hud-label">Configurações</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações"
            className="grid h-6 w-6 place-items-center rounded-sm text-holo-700 transition-colors hover:text-holo-100"
          >
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={1.5}>
              <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Section title="Agente ALAN" subtitle="Exibição">
            <AvatarChoice />
          </Section>
        </div>
      </section>
    </div>
  )
}

// — Camadas ————————————————————————————————————————————————

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section>
      <h2 className="hud-label text-holo-200">{title}</h2>
      <h3 className="hud-label mt-3 border-b border-white/5 pb-2">{subtitle}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function AvatarChoice() {
  const avatarMode = useSettingsStore((s) => s.avatarMode)
  const setAvatarMode = useSettingsStore((s) => s.setAvatarMode)

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Choice
        selected={avatarMode === 'human'}
        onSelect={() => setAvatarMode('human')}
        label="Personagem humano"
        description="O rosto em malha de pontos, com olhos, expressões e o cérebro sob o crânio."
        preview={<HumanPreview />}
      />
      <Choice
        selected={avatarMode === 'sphere'}
        onSelect={() => setAvatarMode('sphere')}
        label="Esfera pulsante"
        description="Casca de partículas que ondula com a voz e se agita ao raciocinar."
        preview={<SpherePreview />}
      />
    </div>
  )
}

function Choice({
  selected,
  onSelect,
  label,
  description,
  preview,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  description: string
  preview: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'flex flex-col gap-2 rounded-sm border p-3 text-left transition-colors',
        selected
          ? 'border-holo-400/60 bg-holo-400/[0.07]'
          : 'border-white/10 hover:border-holo-400/30 hover:bg-white/[0.02]',
      )}
    >
      <span className="grid h-24 place-items-center rounded-sm bg-void/60">{preview}</span>
      <span className="flex items-center gap-1.5">
        <span
          className={clsx(
            'grid h-3 w-3 shrink-0 place-items-center rounded-full border',
            selected ? 'border-holo-300' : 'border-white/20',
          )}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-holo-300" />}
        </span>
        <span className="text-[13px] text-holo-50">{label}</span>
      </span>
      <span className="text-[11px] leading-relaxed text-holo-700">{description}</span>
    </button>
  )
}

/* Miniaturas em SVG, e não em canvas 3D: dois renderizadores extras rodando
   atrás de um modal custariam mais que a escolha que ilustram. */

function HumanPreview() {
  return (
    <svg viewBox="0 0 60 60" className="h-20 w-20" fill="none">
      <ellipse cx="30" cy="27" rx="15" ry="19" stroke="var(--color-holo-500)" strokeWidth="0.7" />
      <path d="M18 47q12 7 24 0" stroke="var(--color-holo-600)" strokeWidth="0.7" />
      {Array.from({ length: 9 }, (_, r) =>
        Array.from({ length: 11 }, (_, c) => {
          const x = 16 + c * 2.8
          const y = 12 + r * 3.4
          const inside = ((x - 30) / 15) ** 2 + ((y - 27) / 19) ** 2 < 1
          return inside ? <circle key={`${r}-${c}`} cx={x} cy={y} r="0.55" fill="var(--color-holo-300)" /> : null
        }),
      )}
      <circle cx="24" cy="25" r="1.7" fill="var(--color-amber)" />
      <circle cx="36" cy="25" r="1.7" fill="var(--color-amber)" />
    </svg>
  )
}

function SpherePreview() {
  return (
    <svg viewBox="0 0 60 60" className="h-20 w-20" fill="none">
      <circle cx="30" cy="30" r="21" stroke="var(--color-holo-600)" strokeWidth="0.6" />
      {Array.from({ length: 16 }, (_, r) =>
        Array.from({ length: 16 }, (_, c) => {
          const x = 9 + c * 2.8
          const y = 9 + r * 2.8
          const dx = (x - 30) / 21
          const dy = (y - 30) / 21
          const d = Math.hypot(dx, dy)
          if (d > 1) return null
          // Ondas cruzadas, como no shader — a miniatura precisa mostrar as
          // cristas, que é o que distingue esta opção de "uma bola de pontos".
          const wave = Math.sin(dx * 7) + Math.sin(dy * 9)
          const lit = wave > 0.4
          return (
            <circle
              key={`${r}-${c}`}
              cx={x}
              cy={y}
              r={lit ? 0.8 : 0.5}
              fill={lit ? 'var(--color-holo-100)' : 'var(--color-holo-500)'}
              opacity={0.35 + (1 - d) * 0.65}
            />
          )
        }),
      )}
    </svg>
  )
}
