import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { audioSignal, damp } from '@/core/state/audioSignal'
import { useAlanStore } from '@/core/state/alanStore'
import { RING_SIZE } from '@/core/ui/layout'
import { SPHERE_FRAG, SPHERE_VERT } from './sphere.glsl'

/**
 * O ALAN como esfera de energia.
 *
 * Alternativa ao rosto humano, escolhida em Configurações. Consome os mesmos
 * sinais (`audioSignal`, fase da conversa), então fala, escuta e raciocínio
 * aparecem aqui do mesmo jeito — o que muda é a forma, não o comportamento.
 */

/** Densidade da casca. Alto o bastante para ler como superfície, não como pontos soltos. */
const COUNT = 42_000

/**
 * Distribuição de Fibonacci.
 *
 * Uma grade latitude/longitude aglomeraria pontos nos polos e os rarefaria no
 * equador — a densidade denunciaria os eixos. A espiral áurea distribui de
 * forma quase uniforme sem direção privilegiada, que é o que faz a esfera
 * parecer uma casca contínua de qualquer ângulo.
 */
function buildSphere(count: number) {
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)

  // Ângulo áureo: a rotação por ponto que nunca fecha um padrão repetido.
  const golden = Math.PI * (3 - Math.sqrt(5))

  for (let i = 0; i < count; i++) {
    // y varre de +1 a -1 uniformemente; é o que garante área igual por faixa.
    const y = 1 - (i / (count - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i

    positions[i * 3] = Math.cos(theta) * radius
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = Math.sin(theta) * radius
    seeds[i] = Math.random()
  }

  return { positions, seeds }
}

const PHASE_TARGET = {
  idle: { thinking: 0.06, level: 0.0 },
  listening: { thinking: 0.12, level: 0.0 },
  thinking: { thinking: 1.0, level: 0.0 },
  speaking: { thinking: 0.18, level: 0.0 },
} as const

export function SpherePoints() {
  const { positions, seeds } = useMemo(() => buildSphere(COUNT), [])
  const pixelRatio = useThree((s) => s.viewport.dpr)
  const groupRef = useRef<THREE.Points>(null)
  const startedAt = useRef(performance.now())

  /**
   * Escala derivada do anel, não fixada num número.
   *
   * `viewport.height` é a altura visível em unidades de mundo no plano z=0, e
   * `size.height` é a mesma altura em pixels — a razão converte um no outro.
   * Uma escala constante casaria com o anel só numa resolução e descolaria em
   * qualquer outra, porque o anel tem tamanho fixo em pixels enquanto a esfera
   * é projetada em perspectiva.
   *
   * Divide por 2 porque a geometria tem raio 1, logo diâmetro 2.
   */
  const scale = useThree((s) => (RING_SIZE * (s.viewport.height / s.size.height)) / 2)

  const phase = useAlanStore((s) => s.phase)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uJaw: { value: 0 },
      uThinking: { value: 0 },
      uReveal: { value: 0 },
      uSize: { value: 3.4 },
      uPixelRatio: { value: 1 },
      // Mesma paleta do rosto: a esfera é o mesmo agente noutra forma, e uma
      // cor nova sugeriria outro sistema. O amarelo é exatamente o da íris,
      // que é onde a energia do personagem já se concentra.
      uColorDeep: { value: new THREE.Color('#0a4fb0') },
      uColorMid: { value: new THREE.Color('#00bfff') },
      uColorHot: { value: new THREE.Color('#e8ff0a') },
    }),
    [],
  )

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    return g
  }, [positions, seeds])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: SPHERE_VERT,
        fragmentShader: SPHERE_FRAG,
        transparent: true,
        depthWrite: false,
        // Aditivo: pontos sobrepostos somam luz, que é o que faz as cristas
        // acenderem sem precisar de mais geometria.
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const target = PHASE_TARGET[phaseRef.current]

    // `performance.now()`, e não delta acumulado: com a aba em segundo plano
    // o rAF para, e o tempo acumulado congelaria a materialização pela metade.
    const elapsed = (performance.now() - startedAt.current) / 1000
    uniforms.uReveal.value = Math.min(1, elapsed / 2.2)

    uniforms.uTime.value = elapsed
    uniforms.uPixelRatio.value = pixelRatio

    const micLevel = phaseRef.current === 'listening' ? audioSignal.level : 0
    const jawLevel = phaseRef.current === 'speaking' ? audioSignal.jaw : 0

    uniforms.uLevel.value = damp(uniforms.uLevel.value, micLevel, 12, dt)
    uniforms.uJaw.value = damp(uniforms.uJaw.value, jawLevel, 24, dt)
    uniforms.uThinking.value = damp(uniforms.uThinking.value, target.thinking, 4, dt)

    // Rotação lenta e constante: sem ela a esfera lida como imagem parada, e
    // o volume só aparece quando a silhueta se move.
    if (groupRef.current) groupRef.current.rotation.y = elapsed * 0.075
  })

  return <points ref={groupRef} geometry={geometry} material={material} scale={scale} />
}
