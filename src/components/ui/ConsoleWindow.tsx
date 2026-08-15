import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import clsx from 'clsx'

import { useAlanStore } from '@/core/state/alanStore'
import { useSessionStore, searchSessions, relativeTime } from '@/core/state/sessionStore'
import { useConversation } from '@/core/conversation/useConversation'
import { useVoiceInput } from '@/core/speech/stt/useVoiceInput'
import { httpAgent, type MemoryLevel } from '@/core/agent/httpAgent'
import { useFloatingWindow } from '@/core/ui/useFloatingWindow'

/**
 * A janela de conversa: menu, transcrição e entrada numa peça só — móvel,
 * redimensionável e recolhível.
 *
 * As camadas ficam neste arquivo de propósito, como subcomponentes locais:
 * são partes de uma coisa só e não têm uso fora daqui.
 */
export function ConsoleWindow() {
  const messages = useAlanStore((s) => s.messages)
  const [menuOpen, setMenuOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)

  const { ref, style, dragging, resizing, handleProps, resizeHandleProps, releaseHeight } =
    useFloatingWindow<HTMLDivElement>({
      initialWidth: Math.min(380, window.innerWidth - 16),
      // Canto inferior direito, que é onde ela vivia — só que agora é ponto de
      // partida, não destino fixo.
      initial: useCallback(
        (size: { width: number; height: number }, viewport: { width: number; height: number }) => ({
          x: viewport.width - size.width - 20,
          y: viewport.height - size.height - 20,
        }),
        [],
      ),
    })

  useSessionSync()

  const toggleMinimized = () => {
    setMinimized((wasMinimized) => {
      // Ao recolher, a altura explícita é abandonada: mantê-la deixaria um
      // vão vazio embaixo do cabeçalho, do tamanho do que foi escondido.
      if (!wasMinimized) releaseHeight()
      return !wasMinimized
    })
  }

  const collapsed = minimized

  return (
    <div
      ref={ref}
      style={{ ...style, ...(collapsed ? { height: 'auto' } : {}) }}
      className={clsx(
        'hud-panel fixed z-20 flex flex-col',
        // Teto só enquanto a altura é automática; depois de redimensionada,
        // quem manda é o tamanho escolhido.
        style.height === undefined && 'max-h-[70vh]',
        // Sem transição durante o gesto: interpolar contra o ponteiro produz
        // aquele atraso elástico que parece travamento.
        dragging || resizing ? 'select-none' : 'transition-shadow',
        dragging && 'cursor-grabbing shadow-[0_0_40px_-8px_var(--color-holo-400)]',
      )}
      aria-label="Console do ALAN"
    >
      <TitleBar
        count={messages.length}
        dragging={dragging}
        handleProps={handleProps}
        menuOpen={menuOpen && !collapsed}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        minimized={collapsed}
        onToggleMinimized={toggleMinimized}
      />

      {!collapsed && (
        <>
          {menuOpen && <SessionMenu onClose={() => setMenuOpen(false)} />}
          {!menuOpen && messages.length > 0 && <Transcript />}
          <InputBar />
          <ResizeGrip handleProps={resizeHandleProps} active={resizing} />
        </>
      )}
    </div>
  )
}

/**
 * Alça de redimensionamento no canto inferior direito.
 *
 * Um canto só, e não oito bordas: pega as duas dimensões num gesto e mantém o
 * canto superior esquerdo fixo — que é o que permite clampar contra a borda
 * da tela com uma conta simples, sem reposicionar a janela no meio do arrasto.
 */
function ResizeGrip({
  handleProps,
  active,
}: {
  handleProps: React.HTMLAttributes<HTMLElement> & { style: React.CSSProperties }
  active: boolean
}) {
  return (
    <div
      {...handleProps}
      role="separator"
      aria-label="Redimensionar janela"
      className={clsx(
        'absolute right-0 bottom-0 grid h-4 w-4 cursor-nwse-resize place-items-center',
        active ? 'text-holo-200' : 'text-holo-700 hover:text-holo-300',
      )}
    >
      {/* Três riscos na diagonal: a convenção que diz "puxe daqui". */}
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" stroke="currentColor" strokeWidth={1}>
        <path d="M9 1 1 9M9 4.5 4.5 9M9 8 8 9" strokeLinecap="round" />
      </svg>
    </div>
  )
}

/**
 * Salva a sessão aberta ao fim de cada turno.
 *
 * Só quando nada está em streaming: gravar a cada token escreveria no
 * `localStorage` dezenas de vezes por resposta, e a escrita é síncrona —
 * seria travamento visível no meio da fala do ALAN.
 */
function useSessionSync() {
  const messages = useAlanStore((s) => s.messages)
  const save = useSessionStore((s) => s.save)

  useEffect(() => {
    if (messages.length === 0) return
    if (messages.some((m) => m.streaming)) return
    save(messages, httpAgent.currentConversationId)
  }, [messages, save])
}

// — Camadas ————————————————————————————————————————————————

function TitleBar({
  count,
  dragging,
  handleProps,
  menuOpen,
  onToggleMenu,
  minimized,
  onToggleMinimized,
}: {
  count: number
  dragging: boolean
  handleProps: React.HTMLAttributes<HTMLElement> & { style: React.CSSProperties }
  menuOpen: boolean
  onToggleMenu: () => void
  minimized: boolean
  onToggleMinimized: () => void
}) {
  return (
    <header
      {...handleProps}
      // Recolhida, a janela é só este cabeçalho — e um duplo clique nele é o
      // gesto que todo mundo já tenta antes de procurar o botão.
      onDoubleClick={onToggleMinimized}
      className={clsx(
        'flex shrink-0 items-center justify-between gap-2 px-3 py-2',
        !minimized && 'border-b border-white/5',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      <span className="flex items-center gap-2">
        {/* Os seis pontos abrem o menu. Por serem um `button`, o arraste os
            ignora automaticamente — o resto do cabeçalho segue sendo a alça. */}
        <button
          type="button"
          onClick={onToggleMenu}
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu de sessões'}
          aria-expanded={menuOpen}
          className={clsx(
            'grid grid-cols-2 gap-[3px] rounded-sm p-1 transition-colors',
            menuOpen ? 'text-holo-200' : 'text-holo-300 opacity-50 hover:opacity-100',
          )}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="h-[3px] w-[3px] rounded-full bg-current" />
          ))}
        </button>
        <span className="hud-label">ALAN</span>
      </span>

      <span className="flex items-center gap-2">
        {count > 0 && !menuOpen && <span className="hud-label">{count} msg</span>}
        <button
          type="button"
          onClick={onToggleMinimized}
          aria-label={minimized ? 'Restaurar janela' : 'Minimizar janela'}
          aria-expanded={!minimized}
          title={minimized ? 'Restaurar' : 'Minimizar'}
          className="grid h-5 w-5 place-items-center rounded-sm text-holo-700 transition-colors hover:text-holo-200"
        >
          {/* Traço quando aberta (recolher), chevron quando recolhida
              (expandir): o ícone mostra o que vai acontecer, não o estado. */}
          <svg viewBox="0 0 12 12" className="h-3 w-3" stroke="currentColor" strokeWidth={1.4} fill="none">
            {minimized ? (
              <path d="M2.5 7.5 6 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M2.5 6h7" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </span>
    </header>
  )
}

function SessionMenu({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const sessions = useSessionStore((s) => s.sessions)
  const currentId = useSessionStore((s) => s.currentId)
  const create = useSessionStore((s) => s.create)
  const open = useSessionStore((s) => s.open)
  const remove = useSessionStore((s) => s.remove)
  const save = useSessionStore((s) => s.save)

  const messages = useAlanStore((s) => s.messages)
  const loadMessages = useAlanStore((s) => s.loadMessages)

  const found = searchSessions(sessions, query)

  const startNew = (level: MemoryLevel) => {
    // Guardar antes de trocar: sem isto o que está na tela evapora.
    save(messages, httpAgent.currentConversationId)
    create()
    loadMessages([])
    // O servidor também precisa esquecer, senão a conversa "nova" nasceria
    // carregando o contexto da anterior — e é aqui que o nível é definido,
    // uma vez só, para valer pela conversa inteira.
    httpAgent.reset(level)
    onClose()
  }

  const openSession = (id: string) => {
    save(messages, httpAgent.currentConversationId)
    const session = open(id)
    if (!session) return
    loadMessages(session.messages)
    httpAgent.resume(session.conversationId)
    onClose()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-white/5">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar conversas…"
          aria-label="Buscar conversas"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-holo-50 outline-none placeholder:text-holo-700"
        />
      </div>

      <NewConversation onStart={startNew} />

      <ul className="flex-1 overflow-y-auto border-t border-white/5">
        {found.length === 0 && (
          <li className="hud-label px-3 py-3">
            {sessions.length === 0 ? 'Nenhuma conversa ainda' : 'Nada encontrado'}
          </li>
        )}

        {found.map((session) => (
          <li key={session.id} className="group flex items-center gap-1 px-1.5">
            <button
              type="button"
              onClick={() => openSession(session.id)}
              className={clsx(
                'min-w-0 flex-1 rounded-sm px-1.5 py-2 text-left transition-colors hover:bg-white/[0.04]',
                session.id === currentId && 'bg-white/[0.06]',
              )}
            >
              <span className="block truncate text-[13px] text-holo-50">{session.title}</span>
              <span className="hud-label mt-0.5 block">
                {relativeTime(session.updatedAt)} · {session.messages.length} msg
              </span>
            </button>
            <button
              type="button"
              onClick={() => remove(session.id)}
              aria-label={`Apagar conversa: ${session.title}`}
              // Só aparece no hover/foco: um botão de apagar sempre visível ao
              // lado de cada item convida ao clique errado.
              className="shrink-0 rounded-sm px-2 py-1 text-holo-700 opacity-0 transition-opacity group-hover:opacity-100 hover:text-alert focus:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Escolha do nível de memória ao abrir uma conversa.
 *
 * Três botões em vez de um "+ Nova": onde a conversa vai morar é decidido uma
 * vez, no começo, e vale para ela inteira. Perguntar a cada mensagem
 * triplicaria o turno falado; não perguntar nunca esconderia que existe
 * diferença entre desabafar e pedir para lembrar.
 *
 * Rotulados pelo efeito — "24 horas", e não "nível 2". O número é vocabulário
 * do servidor; quem conversa pensa em quanto tempo aquilo dura.
 */
const LEVELS: { level: MemoryLevel; label: string; hint: string }[] = [
  { level: 'ephemeral', label: 'Efêmera', hint: 'Nada é guardado' },
  { level: 'day', label: '24 horas', hint: 'Expira sozinha' },
  { level: 'permanent', label: 'Permanente', hint: 'Fica salva' },
]

function NewConversation({ onStart }: { onStart: (level: MemoryLevel) => void }) {
  return (
    <div className="border-t border-white/5 px-2.5 py-2">
      <p className="hud-label mb-1.5">Nova conversa · onde ela mora</p>
      <div className="grid grid-cols-3 gap-1.5">
        {LEVELS.map(({ level, label, hint }) => (
          <button
            key={level}
            type="button"
            onClick={() => onStart(level)}
            title={hint}
            className={clsx(
              'rounded-sm border px-1.5 py-1.5 text-center transition-colors',
              // O padrão ganha destaque em vez de vir pré-selecionado: são três
              // ações, não um formulário — não há o que confirmar depois.
              level === 'day'
                ? 'border-holo-400/50 bg-holo-400/[0.07] hover:bg-holo-400/15'
                : 'border-white/10 hover:border-holo-400/30 hover:bg-white/[0.03]',
            )}
          >
            <span className="block text-[11px] text-holo-50">{label}</span>
            <span className="hud-label mt-0.5 block">{hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Rola sozinho apenas quando o usuário já está no fim — arrastar a leitura de
 * volta para baixo enquanto alguém relê uma resposta anterior é hostil.
 */
function Transcript() {
  const messages = useAlanStore((s) => s.messages)
  const steps = useAlanStore((s) => s.steps)
  const phase = useAlanStore((s) => s.phase)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages, steps])

  return (
    <div
      ref={scrollRef}
      // `min-h-0` é o que faz a rolagem existir: num container flex, o padrão
      // é `min-height: auto`, que deixa o filho crescer além do limite em vez
      // de rolar. Sem isto a janela estica sem fim numa conversa longa.
      //
      // O teto vive na janela (`max-h` quando a altura é automática, ou a
      // altura escolhida no redimensionamento); aqui basta ocupar o que sobrar.
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
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
            style={{ color: message.role === 'user' ? undefined : 'var(--color-holo-300)' }}
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
              className={clsx('hud-label animate-rise', step.state === 'running' && 'animate-pulse-soft')}
            >
              {step.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InputBar() {
  const [draft, setDraft] = useState('')
  const phase = useAlanStore((s) => s.phase)
  const interim = useAlanStore((s) => s.interim)
  const micSupported = useAlanStore((s) => s.micSupported)
  const micError = useAlanStore((s) => s.micError)
  const { send, cancel } = useConversation()

  // A fala vira rascunho, não mensagem enviada. Transcrever e disparar no
  // mesmo gesto não deixa espaço para corrigir o que o reconhecimento errou —
  // e ele erra. Quem decide enviar é quem falou.
  const { listening, toggle } = useVoiceInput({
    onResult: useCallback((text: string) => {
      setDraft((current) => (current ? `${current} ${text}` : text))
    }, []),
  })

  const busy = phase === 'thinking' || phase === 'speaking'

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || phase === 'thinking') return
    void send(draft)
    setDraft('')
  }

  return (
    <form onSubmit={onSubmit} className="shrink-0 border-t border-white/5">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={toggle}
          disabled={!micSupported || phase === 'thinking'}
          title={micSupported ? (listening ? 'Parar de ouvir' : 'Falar com o ALAN') : (micError ?? '')}
          aria-label={listening ? 'Parar de ouvir' : 'Falar com o ALAN'}
          aria-pressed={listening}
          className={clsx(
            'grid h-9 w-9 shrink-0 place-items-center rounded-sm border transition-colors',
            listening
              ? 'border-alert/60 bg-alert/10 text-alert'
              : 'border-white/10 text-holo-700 enabled:hover:border-holo-400/40 enabled:hover:text-holo-200',
            'disabled:cursor-not-allowed',
          )}
        >
          {/* O pulso é a única confirmação de que o microfone está mesmo
              aberto — sem ele não dá para distinguir "ouvindo" de "travado". */}
          <svg
            viewBox="0 0 24 24"
            className={clsx('h-4 w-4', listening && 'animate-pulse')}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
          </svg>
        </button>

        <input
          value={interim || draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            listening ? 'Ouvindo…' : busy ? 'ALAN está respondendo…' : 'Pergunte alguma coisa…'
          }
          aria-label="Mensagem para o ALAN"
          className={clsx(
            'min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-holo-700',
            // A hipótese parcial ainda vai mudar; o itálico apagado diz isso
            // sem precisar de rótulo.
            interim ? 'text-holo-300 italic' : 'text-holo-50',
          )}
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

      {/* Um aviso de cada vez, e o erro vence: se o microfone falhou agora,
          saber disso importa mais que saber que o navegador o suporta. */}
      {micError ? (
        <p className="hud-label border-t border-alert/20 px-3 py-1.5 text-alert">{micError}</p>
      ) : listening ? (
        <p className="hud-label border-t border-white/5 px-3 py-1.5">
          Ouvindo — clique no microfone para transcrever
        </p>
      ) : !micSupported ? (
        <p className="hud-label border-t border-white/5 px-3 py-1.5">
          Voz não disponível neste navegador — converse por texto
        </p>
      ) : null}
    </form>
  )
}
