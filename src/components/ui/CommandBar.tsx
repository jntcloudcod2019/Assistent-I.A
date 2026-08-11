import { useState, type FormEvent } from 'react'
import clsx from 'clsx'

import { useAlanStore } from '@/core/state/alanStore'
import { useConversation } from '@/core/conversation/useConversation'

/**
 * Entrada de comando.
 *
 * O microfone ainda não existe; o botão aparece desabilitado com o motivo ao
 * lado, em vez de escondido — assim o recurso é descoberto e a ausência é
 * explicada, em vez de simplesmente sumir.
 */
export function CommandBar({ className }: { className?: string }) {
  const [draft, setDraft] = useState('')
  const phase = useAlanStore((s) => s.phase)
  const interim = useAlanStore((s) => s.interim)
  const micSupported = useAlanStore((s) => s.micSupported)
  const { send, cancel } = useConversation()

  const busy = phase === 'thinking' || phase === 'speaking'

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || phase === 'thinking') return
    void send(draft)
    setDraft('')
  }

  return (
    <form onSubmit={onSubmit} className={clsx('hud-panel w-full', className)}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          disabled
          title="Reconhecimento de voz ainda não implementado"
          aria-label="Microfone indisponível"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-white/10 text-holo-700 disabled:cursor-not-allowed"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
          </svg>
        </button>

        <input
          value={interim || draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={busy ? 'ALAN está respondendo…' : 'Pergunte alguma coisa…'}
          aria-label="Mensagem para o ALAN"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-holo-50 outline-none placeholder:text-holo-700"
        />

        {busy ? (
          <button
            type="button"
            onClick={cancel}
            className="shrink-0 rounded-sm border border-alert/40 px-3 py-1.5 text-[10px] tracking-[0.18em] text-alert uppercase transition-colors hover:bg-alert/10"
          >
            Parar
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            className="shrink-0 rounded-sm border border-holo-400/40 px-3 py-1.5 text-[10px] tracking-[0.18em] text-holo-200 uppercase transition-colors hover:bg-holo-400/10 disabled:opacity-30"
          >
            Enviar
          </button>
        )}
      </div>

      {!micSupported && (
        <p className="hud-label border-t border-white/5 px-3 py-1.5">
          Voz ainda não conectada — converse por texto
        </p>
      )}
    </form>
  )
}
