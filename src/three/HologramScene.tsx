import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'

import { useSettingsStore } from '@/core/state/settingsStore'
import { BrainPoints } from './head/BrainPoints'
import { HeadPoints } from './head/HeadPoints'
import { SpherePoints } from './sphere/SpherePoints'

export function HologramScene() {
  const avatarMode = useSettingsStore((s) => s.avatarMode)

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, -0.12, 2.95], fov: 32, near: 0.1, far: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      // Alpha ligado e sem clear color: o fundo é do DOM, e os anéis do HUD
      // ficam atrás do canvas.
    >
      {/* Uma forma de cada vez. O cérebro pertence ao crânio: sem a cabeça
          ele ficaria flutuando dentro da esfera, sem leitura nenhuma. */}
      {avatarMode === 'human' ? (
        <>
          <BrainPoints />
          <HeadPoints />
        </>
      ) : (
        <SpherePoints />
      )}

      <EffectComposer>
        <Bloom
          intensity={0.7}
          luminanceThreshold={0.38}
          luminanceSmoothing={0.4}
          mipmapBlur
          radius={0.72}
        />
      </EffectComposer>
    </Canvas>
  )
}
