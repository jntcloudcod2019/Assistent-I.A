import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'

import { Backdrop } from './Backdrop'
import { Pedestal } from './Pedestal'
import { HeadPoints } from './head/HeadPoints'

export function HologramScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, -0.06, 3.0], fov: 34, near: 0.1, far: 30 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      // Nenhuma luz na cena: todo material é aditivo e emissivo por conta própria.
      onCreated={({ gl }) => gl.setClearColor('#02080d', 1)}
    >
      <fog attach="fog" args={['#02080d', 3.4, 8]} />

      <Backdrop />
      <Pedestal />
      <HeadPoints />

      <EffectComposer>
        <Bloom
          intensity={0.85}
          luminanceThreshold={0.22}
          luminanceSmoothing={0.4}
          mipmapBlur
          radius={0.72}
        />
      </EffectComposer>
    </Canvas>
  )
}
