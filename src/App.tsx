import { HologramScene } from './three/HologramScene'

export function App() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      <div className="absolute inset-0">
        <HologramScene />
      </div>
    </div>
  )
}
