import { useState } from 'react'

import { HolographicRings } from '@/components/ai/HolographicRings'
import { ConsoleWindow } from '@/components/ui/ConsoleWindow'
import { Dock, type DockItem } from '@/components/ui/Dock'
import { SettingsPanel } from '@/components/ui/SettingsPanel'
import { StatusPanel } from '@/components/ui/StatusPanel'
import { PlanDashboard } from '@/components/ui/PlanDashboard'
import { JobsPanel } from '@/components/ui/JobsPanel'
import { useReminders } from '@/core/plan/useReminders'
import { RING_SIZE } from '@/core/ui/layout'
import { HologramScene } from './three/HologramScene'

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [jobsOpen, setJobsOpen] = useState(false)

  // Lembretes diários dos planos: precisam viver acima dos painéis, senão só
  // disparariam com o painel de compromissos aberto.
  useReminders()

  const dockItems: DockItem[] = [
    {
      id: 'settings',
      label: 'Configurações',
      active: settingsOpen,
      // Abrir um painel fecha o outro: os dois são sobreposições de tela
      // cheia, e empilhá-las esconderia a de baixo sem nenhum ganho.
      onClick: () => {
        setStatusOpen(false)
        setJobsOpen(false)
        setPlanOpen(false)
        setJobsOpen(false)
        setSettingsOpen((open) => !open)
      },
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'status',
      label: 'Estado do sistema',
      active: statusOpen,
      onClick: () => {
        setSettingsOpen(false)
        setJobsOpen(false)
        setPlanOpen(false)
        setStatusOpen((open) => !open)
      },
      icon: (
        // Um traçado de monitor cardíaco: diz "sinais vitais" sem legenda.
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M2.5 12h4l2-5 3.5 10 2.5-6.5 1.6 3.5h5.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'plan',
      label: 'Compromissos',
      active: planOpen,
      onClick: () => {
        setSettingsOpen(false)
        setStatusOpen(false)
        setPlanOpen((open) => !open)
      },
      icon: (
        // Alvo com flecha: objetivo com progresso, e não "lista de tarefas".
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: 'jobs',
      label: 'Processos seletivos',
      active: jobsOpen,
      onClick: () => {
        setSettingsOpen(false)
        setStatusOpen(false)
        setPlanOpen(false)
        setJobsOpen((open) => !open)
      },
      icon: (
        // Pasta com marca: candidatura arquivada, não "tarefa".
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h9A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" strokeLinejoin="round" />
          <path d="m9.5 13.8 2 2 3.5-3.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ]

  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      {/* Anéis atrás do avatar, centrados onde o busto se dissolve. */}
      <div className="pointer-events-none absolute left-1/2 top-[88%] -translate-x-1/2 -translate-y-1/2">
        <HolographicRings size={RING_SIZE} ringCount={5} speed={1} intensity={1.2} tiltDeg={74} showBeams />
      </div>

      <div className="absolute inset-0">
        <HologramScene />
      </div>

      {/* A janela se posiciona sozinha e é arrastável — por isso sai daqui
          qualquer container de layout: quem manda na posição é ela. */}
      <ConsoleWindow />

      {/* Dock centrado embaixo, ancorado à tela. Fica abaixo da janela de
          conversa no empilhamento (z-20) para não cobri-la quando arrastada
          até a base, mas acima do canvas. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-10 flex justify-center">
        <Dock items={dockItems} className="pointer-events-auto" />
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {statusOpen && <StatusPanel onClose={() => setStatusOpen(false)} />}
      {planOpen && <PlanDashboard onClose={() => setPlanOpen(false)} />}
      {jobsOpen && <JobsPanel onClose={() => setJobsOpen(false)} />}
    </div>
  )
}
