import { create } from 'zustand'

/** A máquina de estados da qual tudo na tela deriva. */
export type AlanPhase = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface Message {
  id: string
  role: 'user' | 'alan'
  text: string
  ts: number
  /** Verdadeiro enquanto os tokens ainda estão chegando. */
  streaming?: boolean
  error?: boolean
}

export interface StatusStep {
  id: string
  label: string
  state: 'running' | 'done'
}

export interface ModuleState {
  id: string
  label: string
  status: 'online' | 'offline' | 'standby'
}

let seq = 0
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

interface AlanState {
  phase: AlanPhase
  messages: Message[]
  steps: StatusStep[]
  /** Transcrição parcial do reconhecimento de voz, antes de virar mensagem. */
  interim: string
  /** Suporte do navegador a reconhecimento de fala. */
  micSupported: boolean
  micError: string | null
  ttsSupported: boolean
  modules: ModuleState[]
  bootedAt: number

  setPhase: (phase: AlanPhase) => void
  setInterim: (text: string) => void
  setMicSupported: (supported: boolean) => void
  setMicError: (error: string | null) => void
  setTtsSupported: (supported: boolean) => void

  addUserMessage: (text: string) => string
  /** Substitui a conversa inteira — usado ao abrir uma sessão salva. */
  loadMessages: (messages: Message[]) => void
  startAlanMessage: () => string
  appendToMessage: (id: string, chunk: string) => void
  finishMessage: (id: string) => void
  failMessage: (id: string, message: string) => void

  pushStep: (label: string) => void
  completeSteps: () => void
  clearSteps: () => void

  reset: () => void
}

const INITIAL_MODULES: ModuleState[] = [
  { id: 'core', label: 'Núcleo cognitivo', status: 'online' },
  { id: 'speech', label: 'Síntese de voz', status: 'online' },
  { id: 'hearing', label: 'Reconhecimento', status: 'standby' },
  { id: 'github', label: 'GitHub', status: 'offline' },
  { id: 'gmail', label: 'Gmail', status: 'offline' },
  { id: 'cloud', label: 'Cloud', status: 'offline' },
  { id: 'web', label: 'Navegação web', status: 'offline' },
]

export const useAlanStore = create<AlanState>((set) => ({
  phase: 'idle',
  messages: [],
  steps: [],
  interim: '',
  micSupported: false,
  micError: null,
  ttsSupported: false,
  modules: INITIAL_MODULES,
  bootedAt: Date.now(),

  setPhase: (phase) => set({ phase }),
  setInterim: (interim) => set({ interim }),
  setMicSupported: (micSupported) =>
    set((s) => ({
      micSupported,
      modules: s.modules.map((m) =>
        m.id === 'hearing' ? { ...m, status: micSupported ? 'online' : 'offline' } : m,
      ),
    })),
  setMicError: (micError) => set({ micError }),
  setTtsSupported: (ttsSupported) =>
    set((s) => ({
      ttsSupported,
      modules: s.modules.map((m) =>
        m.id === 'speech' ? { ...m, status: ttsSupported ? 'online' : 'offline' } : m,
      ),
    })),

  addUserMessage: (text) => {
    const id = uid('u')
    set((s) => ({
      messages: [...s.messages, { id, role: 'user', text, ts: Date.now() }],
      interim: '',
    }))
    return id
  },

  // Limpa passo e transcrição parcial junto: são estado do turno anterior e
  // ficariam pendurados sobre a conversa recém-aberta.
  loadMessages: (messages) => set({ messages, steps: [], interim: '', phase: 'idle' }),

  startAlanMessage: () => {
    const id = uid('a')
    set((s) => ({
      messages: [...s.messages, { id, role: 'alan', text: '', ts: Date.now(), streaming: true }],
    }))
    return id
  },

  appendToMessage: (id, chunk) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, text: m.text + chunk } : m)),
    })),

  finishMessage: (id) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
    })),

  failMessage: (id, message) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text: message, streaming: false, error: true } : m,
      ),
    })),

  pushStep: (label) =>
    set((s) => ({
      steps: [
        ...s.steps.map((step) => ({ ...step, state: 'done' as const })),
        { id: uid('s'), label, state: 'running' as const },
      ],
    })),

  completeSteps: () =>
    set((s) => ({ steps: s.steps.map((step) => ({ ...step, state: 'done' as const })) })),

  clearSteps: () => set({ steps: [] }),

  reset: () => set({ phase: 'idle', messages: [], steps: [], interim: '' }),
}))
