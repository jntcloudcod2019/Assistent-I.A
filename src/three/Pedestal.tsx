import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { useAlanStore } from '@/core/state/alanStore'
import { audioSignal, damp } from '@/core/state/audioSignal'

const BASE_Y = -1.18

/** Anel de texto gravado na borda do emissor. */
function makeRingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 96
  const ctx = canvas.getContext('2d')!

  // Preto = nada, já que o material é aditivo.
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.font = 'bold 40px ui-monospace, "JetBrains Mono", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#8fe9ff'

  const labels = ['ALAN TURING · 1912–1954', 'A.I. INTERFACE', 'ALAN TURING · 1912–1954', 'A.I. INTERFACE']
  const slot = canvas.width / labels.length
  labels.forEach((label, i) => {
    ctx.fillText(label, (i + 0.5) * slot, canvas.height / 2)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const EMITTER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const EMITTER_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // Núcleo incandescente no centro do emissor.
    float core = exp(-r * 5.5) * (1.2 + uEnergy * 1.6);

    // Anéis concêntricos correndo para fora.
    float rings = sin(r * 34.0 - uTime * 2.2) * 0.5 + 0.5;
    rings *= smoothstep(1.0, 0.25, r) * 0.35;

    // Marcas radiais, como uma escala de instrumento.
    float ticks = step(0.86, fract(atan(p.y, p.x) * 12.0 / 3.14159));
    ticks *= smoothstep(0.55, 0.95, r) * smoothstep(1.0, 0.92, r) * 0.7;

    float a = (core + rings + ticks) * smoothstep(1.0, 0.9, r);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * (0.6 + core), a);
  }
`

const CONE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const CONE_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    // vUv.y: 0 na base do cone, 1 no topo (junto da cabeça).
    float vertical = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);

    // Estrias de luz subindo pelo feixe.
    float streak = sin(vUv.x * 90.0) * 0.5 + 0.5;
    streak = pow(streak, 3.0);
    float travel = fract(vUv.y * 1.5 - uTime * 0.35);
    float pulse = smoothstep(0.0, 0.25, travel) * smoothstep(0.6, 0.25, travel);

    // Alfa deliberadamente baixo: o material é aditivo e DoubleSide, então cada
    // fragmento é somado duas vezes ao atravessar o feixe.
    float a = vertical * (0.012 + streak * 0.022 + pulse * 0.014) * (0.7 + uEnergy);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

export function Pedestal() {
  const phase = useAlanStore((s) => s.phase)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const ringTexture = useMemo(makeRingTexture, [])
  const outerRingRef = useRef<THREE.Mesh>(null)
  const innerRingRef = useRef<THREE.Mesh>(null)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uColor: { value: new THREE.Color('#5fd8f5') },
    }),
    [],
  )

  useEffect(() => () => ringTexture.dispose(), [ringTexture])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    uniforms.uTime.value = state.clock.elapsedTime
    uniforms.uEnergy.value = damp(uniforms.uEnergy.value, audioSignal.energy, 8, dt)

    // Os anéis giram mais rápido enquanto o ALAN raciocina.
    const speed = phaseRef.current === 'thinking' ? 1.4 : 0.22
    if (outerRingRef.current) outerRingRef.current.rotation.z += dt * speed
    if (innerRingRef.current) innerRingRef.current.rotation.z -= dt * speed * 1.6
  })

  return (
    <group position={[0, BASE_Y, 0]}>
      {/* Disco emissor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.8, 96]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={EMITTER_VERT}
          fragmentShader={EMITTER_FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Feixe volumétrico que sustenta a cabeça. Termina abaixo do queixo: se
          cruzasse o rosto, a face aditiva da frente lavaria as feições. */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.22, 0.64, 0.8, 72, 1, true]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={CONE_VERT}
          fragmentShader={CONE_FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Borda gravada */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.86, 0.86, 0.12, 96, 1, true]} />
        <meshBasicMaterial
          map={ringTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Anéis giratórios */}
      <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]}>
        <torusGeometry args={[0.93, 0.0035, 6, 160]} />
        <meshBasicMaterial color="#3ddaf5" transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={innerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <torusGeometry args={[0.7, 0.0025, 6, 128]} />
        <meshBasicMaterial color="#7febff" transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}
