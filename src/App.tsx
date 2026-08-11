import { HolographicRings } from '@/components/ai/HolographicRings'
import { ChatPanel } from '@/components/ui/ChatPanel'
import { CommandBar } from '@/components/ui/CommandBar'
import { HologramScene } from './three/HologramScene'

export function App() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      {/* Anéis atrás do avatar, centrados onde o busto se dissolve. */}
      <div className="pointer-events-none absolute left-1/2 top-[88%] -translate-x-1/2 -translate-y-1/2">
        <HolographicRings size={440} ringCount={5} speed={1} intensity={1.2} tiltDeg={74} showBeams />
      </div>

      <div className="absolute inset-0">
        <HologramScene />
      </div>

      {/* Conversa à direita no desktop; no mobile ela desce e o holograma sobe. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-3 sm:p-5 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[380px] lg:justify-end">
        <div className="pointer-events-auto w-full">
          <ChatPanel />
        </div>
        <div className="pointer-events-auto w-full">
          <CommandBar />
        </div>
      </div>
    </div>
  )
}
