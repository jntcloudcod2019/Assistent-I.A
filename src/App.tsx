import { HolographicRings } from '@/components/ai/HolographicRings'
import { ConsoleWindow } from '@/components/ui/ConsoleWindow'
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

      {/* A janela se posiciona sozinha e é arrastável — por isso sai daqui
          qualquer container de layout: quem manda na posição é ela. */}
      <ConsoleWindow />
    </div>
  )
}
