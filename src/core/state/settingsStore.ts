import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Preferências do ALAN.
 *
 * Separado do `alanStore` de propósito: aquele guarda o estado do turno, que
 * é volátil e morre com a sessão; este guarda escolha de quem usa, que precisa
 * sobreviver ao recarregamento. Misturar os dois faria a persistência
 * arrastar mensagens junto.
 */

/** Como o agente se apresenta na cena 3D. */
export type AvatarMode = 'human' | 'sphere'

interface SettingsState {
  avatarMode: AvatarMode
  setAvatarMode: (mode: AvatarMode) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      avatarMode: 'human',
      setAvatarMode: (avatarMode) => set({ avatarMode }),
    }),
    { name: 'alan.settings', version: 1 },
  ),
)
