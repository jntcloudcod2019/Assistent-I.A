import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'

import { Backdrop } from './Backdrop'
import { Pedestal } from './Pedestal'
import { HeadPoints } from './head/HeadPoints'

export function HologramScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, -0.12, 2.95], fov: 32, near: 0.1, far: 30 }}
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
