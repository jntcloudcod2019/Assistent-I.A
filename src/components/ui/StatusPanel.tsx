import { useEffect } from 'react'
import clsx from 'clsx'

import { useSystemStatus, type Probe, type ProbeStatus } from '@/core/state/useSystemStatus'

/**
 * Painel de estado do sistema.
 *
 * Mostra o que as sondas do servidor mediram, e não o que está configurado —
 * a distinção é o ponto inteiro: antes o sistema afirmava que o Redis estava
 * bem enquanto ele estava morto.
 *
 * Três estados, e a diferença importa: `desligado` é escolha, `fora do ar` é
 * problema. Pintar os dois de vermelho faria uma configuração deliberada
 * parecer incidente, e o alarme perderia o sentido.
 */
export function StatusPanel({ onClose }: { onClose: () => void }) {
  const { status, error, loading, refresh } = useSystemStatus(true)

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
        className="hud-panel flex max-h-[85vh] w-[min(560px,100%)] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Estado do sistema"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="hud-label">Estado do sistema</span>
            {status && (
              <span className={clsx('hud-label', status.ok ? 'text-holo-300' : 'text-alert')}>
                {status.ok ? 'tudo no ar' : `${status.warnings.length} com problema`}
              </span>
            )}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              aria-label="Atualizar agora"
              title="Atualizar agora"
              className={clsx(
                'grid h-6 w-6 place-items-center rounded-sm text-holo-700 transition-colors hover:text-holo-100',
                loading && 'animate-pulse-soft',
              )}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4}>
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
                <path d="M13.5 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar estado do sistema"
              className="grid h-6 w-6 place-items-center rounded-sm text-holo-700 transition-colors hover:text-holo-100"
            >
              <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={1.5}>
                <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error && <p className="text-[13px] leading-relaxed text-alert">{error}</p>}

          {!error && !status && (
            <p className="hud-label animate-pulse-soft">Consultando o servidor…</p>
          )}

          {status && (
            <>
              <ul className="flex flex-col gap-2">
                {status.probes.map((probe) => (
                  <ProbeRow key={probe.id} probe={probe} />
                ))}
              </ul>

              <p className="hud-label mt-4 border-t border-white/5 pt-3">
                Canal: {status.channel} · Histórico: {status.store}
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * Quatro estados, e a diferença entre eles é o ponto.
 *
 * `desligado` é escolha; `fora do ar` é problema; `não exercitado` é falta de
 * informação, não falha — sondar o workflow de conversa custaria uma requisição
 * da cota do modelo a cada consulta, então o estado dele só aparece depois de
 * uma mensagem de verdade. Pintar os quatro de vermelho faria o alarme perder
 * o sentido.
 */
const TONE: Record<ProbeStatus, { dot: string; text: string; label: string }> = {
  online: { dot: 'bg-holo-300', text: 'text-holo-300', label: 'no ar' },
  offline: { dot: 'bg-alert', text: 'text-alert', label: 'fora do ar' },
  disabled: { dot: 'bg-holo-700', text: 'text-holo-700', label: 'desligado' },
  unknown: { dot: 'bg-amber', text: 'text-amber', label: 'não exercitado' },
}

function ProbeRow({ probe }: { probe: Probe }) {
  const tone = TONE[probe.status]

  return (
    <li className="flex gap-2.5 rounded-sm border border-white/5 px-3 py-2">
      {/* `mt-[7px]` alinha o ponto com a primeira linha do texto, não com o
          topo da caixa — centralizar verticalmente o desalinharia quando o
          detalhe ocupa duas linhas. */}
      <span className={clsx('mt-[7px] h-2 w-2 shrink-0 rounded-full', tone.dot)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] text-holo-50">{probe.label}</span>
          <span className={clsx('hud-label', tone.text)}>{tone.label}</span>
          {probe.latencyMs !== undefined && probe.status === 'online' && (
            <span className="hud-label">{probe.latencyMs} ms</span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-holo-700">{probe.detail}</span>
      </span>
    </li>
  )
}
