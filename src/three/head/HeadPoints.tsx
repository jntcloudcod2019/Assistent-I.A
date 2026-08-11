import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { useAlanStore } from '@/core/state/alanStore'
import { audioSignal, damp } from '@/core/state/audioSignal'
import { EYE_ASPECT } from './faceModel'
import { buildHeadData } from './geometry'
import { HEAD_FRAG, HEAD_VERT, LATTICE_FRAG, LATTICE_VERT } from './head.glsl'

// A rampa vai de azul elétrico profundo (sombra) a ciano brilhante (nó aceso),
// em vez do ciano quase branco anterior — era ele que lavava o rosto inteiro.
const COLOR_CORE = new THREE.Color('#8ff0ff')
const COLOR_EDGE = new THREE.Color('#0a4fb0')
const COLOR_ACCENT = new THREE.Color('#00bfff')
/** Roxo neon da íris — deliberadamente fora da família ciano da cabeça, para
 *  que o olhar seja a primeira coisa que o rosto comunica. Vermelho médio e
 *  verde baixo mantêm o tom violeta mesmo quando o brilho satura o azul. */
const COLOR_IRIS = new THREE.Color('#7b2cff')

/** 10 piscadas por minuto — uma a cada 6 s. */
const BLINK_INTERVAL = 6
/** Jitter em torno do intervalo: cadência exata soa mecânica. */
const BLINK_JITTER = 1.6
/** Duração de uma piscada completa, em segundos. */
const BLINK_DURATION = 0.16
/** Fração da piscada gasta fechando; o resto abre. */
const BLINK_CLOSE_RATIO = 0.38

/**
 * Curva da piscada: a pálpebra cai mais rápido do que sobe, como a real.
 * Recebe 0..1 (progresso) e devolve 0..1 (fechamento).
 */
function blinkCurve(p: number): number {
  if (p < BLINK_CLOSE_RATIO) {
    const t = p / BLINK_CLOSE_RATIO
    return t * t * (3 - 2 * t)
  }
  const t = (p - BLINK_CLOSE_RATIO) / (1 - BLINK_CLOSE_RATIO)
  return 1 - t * t * (3 - 2 * t)
}

/** Alvos dos uniforms para cada fase da máquina de estados. */
const PHASE_TARGETS = {
  idle: { thinking: 0, glitch: 0.015, scanSpeed: 0.22, ambient: 0.04 },
  listening: { thinking: 0.08, glitch: 0.05, scanSpeed: 0.45, ambient: 0.1 },
  thinking: { thinking: 1, glitch: 0.28, scanSpeed: 1.35, ambient: 0.22 },
  speaking: { thinking: 0.06, glitch: 0.03, scanSpeed: 0.55, ambient: 0.12 },
} as const

export function HeadPoints() {
  const phase = useAlanStore((s) => s.phase)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const groupRef = useRef<THREE.Group>(null)
  const scanRef = useRef(-0.6)
  /** `progress` negativo = olhos abertos, esperando a próxima piscada. */
  const blinkRef = useRef({ nextAt: 2, progress: -1 })
  /** Materialização ancorada no relógio real: se a aba ficar em segundo plano
   *  durante o boot, a cabeça já está formada quando o usuário volta, em vez de
   *  arrastar a animação por frames que nunca rodaram. */
  const mountedAt = useRef(performance.now())

  const data = useMemo(() => buildHeadData(), [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uThinking: { value: 0 },
      uJaw: { value: 0 },
      uScanY: { value: -0.6 },
      uGlitch: { value: 0 },
      uReveal: { value: 0 },
      // Nós pequenos e nítidos: nas referências quem desenha o rosto é a malha
      // triangulada, e os vértices são só as marcas nos cruzamentos.
      uSize: { value: 4.2 },
      uEyeAspect: { value: EYE_ASPECT },
      uBlink: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColorCore: { value: COLOR_CORE },
      uColorEdge: { value: COLOR_EDGE },
      uColorAccent: { value: COLOR_ACCENT },
      uColorIris: { value: COLOR_IRIS },
    }),
    [],
  )

  // Pontos e malha compartilham os mesmos BufferAttributes; a malha apenas
  // acrescenta um índice de linhas. Um único conjunto de vértices na GPU.
  const [pointsGeometry, latticeGeometry] = useMemo(() => {
    const attrs = {
      position: new THREE.BufferAttribute(data.positions, 3),
      aNormal: new THREE.BufferAttribute(data.normals, 3),
      aJaw: new THREE.BufferAttribute(data.jaw, 1),
      aRegion: new THREE.BufferAttribute(data.region, 1),
      aSeed: new THREE.BufferAttribute(data.seed, 1),
      aFade: new THREE.BufferAttribute(data.fade, 1),
      aArea: new THREE.BufferAttribute(data.area, 1),
      aDetail: new THREE.BufferAttribute(data.detail, 1),
      aGlow: new THREE.BufferAttribute(data.glow, 1),
    }

    const points = new THREE.BufferGeometry()
    const lattice = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(attrs)) {
      points.setAttribute(name, attr)
      lattice.setAttribute(name, attr)
    }
    lattice.setIndex(new THREE.BufferAttribute(data.lineIndices, 1))

    return [points, lattice] as const
  }, [data])

  const pointsMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: HEAD_VERT,
        fragmentShader: HEAD_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )

  const latticeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: LATTICE_VERT,
        fragmentShader: LATTICE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )

  useEffect(
    () => () => {
      pointsGeometry.dispose()
      latticeGeometry.dispose()
      pointsMaterial.dispose()
      latticeMaterial.dispose()
    },
    [pointsGeometry, latticeGeometry, pointsMaterial, latticeMaterial],
  )

  useFrame((state, delta) => {
    // `delta` pode explodir se a aba ficou em segundo plano.
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const target = PHASE_TARGETS[phaseRef.current]

    const reveal = Math.min(1, (performance.now() - mountedAt.current) / 1600)

    // Varredura sobe pela cabeça e reinicia; acelera durante o raciocínio.
    scanRef.current += dt * target.scanSpeed
    if (scanRef.current > 0.62) scanRef.current = -0.62

    // Piscada. Roda no relógio da cena, não em setTimeout: se a aba ficar em
    // segundo plano o ciclo pausa junto com o render, em vez de acumular
    // piscadas atrasadas para disparar todas de uma vez na volta.
    const blink = blinkRef.current
    if (blink.progress < 0) {
      if (t >= blink.nextAt) blink.progress = 0
    } else {
      blink.progress += dt / BLINK_DURATION
      if (blink.progress >= 1) {
        blink.progress = -1
        blink.nextAt = t + BLINK_INTERVAL + (Math.random() * 2 - 1) * BLINK_JITTER
      }
    }
    uniforms.uBlink.value = blink.progress < 0 ? 0 : blinkCurve(blink.progress)

    // Sinais contínuos vêm do objeto mutável, nunca de state React.
    const micLevel = phaseRef.current === 'listening' ? audioSignal.level : 0
    const jawLevel = phaseRef.current === 'speaking' ? audioSignal.jaw : 0
    const levelTarget = Math.max(micLevel, jawLevel * 0.7, target.ambient)

    uniforms.uTime.value = t
    uniforms.uReveal.value = reveal
    uniforms.uScanY.value = scanRef.current
    uniforms.uLevel.value = damp(uniforms.uLevel.value, levelTarget, 12, dt)
    uniforms.uJaw.value = damp(uniforms.uJaw.value, jawLevel, 24, dt)
    uniforms.uThinking.value = damp(uniforms.uThinking.value, target.thinking, 4, dt)

    // Glitch em rajadas curtas, mais frequentes quando o ALAN raciocina.
    const burst = Math.random() < target.glitch * 0.12 ? 1 : 0
    uniforms.uGlitch.value = damp(
      uniforms.uGlitch.value,
      burst ? target.glitch : 0,
      burst ? 30 : 8,
      dt,
    )

    audioSignal.energy = damp(audioSignal.energy, levelTarget, 6, dt)

    // A cabeça acompanha o ponteiro de leve e balança sozinha em repouso.
    const group = groupRef.current
    if (group) {
      const targetY = state.pointer.x * 0.3 + Math.sin(t * 0.35) * 0.05
      const targetX = -state.pointer.y * 0.16 + Math.sin(t * 0.27) * 0.02
      group.rotation.y = damp(group.rotation.y, targetY, 3, dt)
      group.rotation.x = damp(group.rotation.x, targetX, 3, dt)
      group.position.y = damp(group.position.y, Math.sin(t * 0.6) * 0.012, 3, dt)
    }
  })

  return (
    <group ref={groupRef}>
      <points geometry={pointsGeometry} material={pointsMaterial} frustumCulled={false} />
      <lineSegments geometry={latticeGeometry} material={latticeMaterial} frustumCulled={false} />
    </group>
  )
}
