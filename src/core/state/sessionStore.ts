import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { Message } from './alanStore'

/**
 * Sessões de conversa, guardadas no navegador.
 *
 * Ficam no `localStorage` e não no servidor por um motivo concreto: hoje o
 * servidor roda com store em memória (sem `DATABASE_URL`) e perde tudo a cada
 * reinício. Guardar aqui é o que faz o histórico existir de verdade agora, e
 * sobreviver a um F5.
 *
 * O `conversationId` acompanha cada sessão porque é ele que dá memória do lado
 * do servidor: reabrir uma sessão sem retomar o id mostraria o histórico na
 * tela enquanto o ALAN começaria do zero.
 */

export interface ChatSession {
  id: string
  title: string
  /** Id no servidor. `null` enquanto o primeiro turno não respondeu. */
  conversationId: string | null
  messages: Message[]
  updatedAt: number
}

/**
 * Teto de sessões guardadas.
 *
 * O `localStorage` tem ~5 MB por origem, e uma conversa longa passa fácil de
 * 50 KB. Sem o corte, o histórico cresce até a escrita começar a falhar em
 * silêncio — e falha silenciosa em persistência é o pior tipo.
 */
const MAX_SESSIONS = 50

let seq = 0
const uid = () => `s-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** Título derivado da primeira fala de quem perguntou. */
function deriveTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user')?.text.trim()
  if (!first) return 'Conversa sem título'
  return first.length > 48 ? `${first.slice(0, 47)}…` : first
}

interface SessionState {
  sessions: ChatSession[]
  currentId: string | null

  /** Grava o estado da sessão aberta. Chamado ao fim de cada turno. */
  save: (messages: Message[], conversationId: string | null) => void
  /** Abre uma sessão nova e vazia; devolve o id. */
  create: () => string
  open: (id: string) => ChatSession | undefined
  remove: (id: string) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentId: null,

      save: (messages, conversationId) => {
        // Sessão vazia não vira registro: abrir o menu e não perguntar nada
        // não deveria encher a lista de fantasmas.
        if (messages.length === 0) return

        const id = get().currentId ?? uid()
        const existing = get().sessions.find((s) => s.id === id)

        const session: ChatSession = {
          id,
          // Um título já escolhido não muda: renomear a conversa embaixo de
          // quem está lendo a lista é desorientador.
          title: existing?.title ?? deriveTitle(messages),
          conversationId,
          messages,
          updatedAt: Date.now(),
        }

        set((state) => ({
          currentId: id,
          sessions: [session, ...state.sessions.filter((s) => s.id !== id)].slice(0, MAX_SESSIONS),
        }))
      },

      create: () => {
        const id = uid()
        set({ currentId: id })
        return id
      },

      open: (id) => {
        const session = get().sessions.find((s) => s.id === id)
        if (session) set({ currentId: id })
        return session
      },

      remove: (id) =>
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
          currentId: state.currentId === id ? null : state.currentId,
        })),
    }),
    {
      name: 'alan.sessions',
      version: 1,
      // `currentId` fica de fora: ao voltar, a conversa começa limpa e o
      // histórico está no menu. Restaurar a última sessão automaticamente
      // faria o ALAN parecer estar no meio de um assunto que já passou.
      partialize: (state) => ({ sessions: state.sessions }),
    },
  ),
)

/** Filtra por título e conteúdo — é o que a busca do menu usa. */
export function searchSessions(sessions: ChatSession[], query: string): ChatSession[] {
  const term = query.trim().toLowerCase()
  if (!term) return sessions
  return sessions.filter(
    (session) =>
      session.title.toLowerCase().includes(term) ||
      session.messages.some((m) => m.text.toLowerCase().includes(term)),
  )
}

/** "agora", "há 5 min", "há 3 h", "há 2 d" — datas absolutas atrapalham aqui. */
export function relativeTime(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return 'agora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  return `há ${Math.floor(hours / 24)} d`
}
