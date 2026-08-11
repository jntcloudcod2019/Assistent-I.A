import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { audioSignal, damp } from '@/core/state/audioSignal'
import { useAlanStore } from '@/core/state/alanStore'
import { buildBrainData } from './brain'

/**
 * Cérebro holográfico dentro do crânio.
 *
 * Renderiza em duas passagens sobre os mesmos vértices — pontos para o córtex
 * e linhas para a malha e as trilhas —, do mesmo jeito que a cabeça. O chip
 * pulsa e o pulso viaja pelas trilhas para fora: `aTrace` guarda a posição ao
 * longo de cada trilha, e o shader usa isso como coordenada de propagação.
 */

const COLOR_CORTEX = new THREE.Color('#1d6fb8')
const COLOR_ENERGY = new THREE.Color('#ffc400')

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform float uSize;
  uniform float uPixelRatio;

  attribute vec3 aNormal;
  attribute float aDepth;
  attribute float aSeed;
  attribute float aTrace;
  attribute float aKind;

  varying float vBright;
  varying float vEnergy;
  varying float vAlpha;

  void main() {
    vec3 p = position;

    vec3 vn = normalize(normalMatrix * aNormal);
    float key = max(0.0, dot(vn, normalize(vec3(-0.35, 0.55, 0.75))));
    float fres = pow(1.0 - abs(vn.z), 2.0);
    float front = smoothstep(-0.5, 0.45, vn.z);

    if (aKind > 1.5) {
      // Chip: quadriculado aceso, respirando com o processamento.
      float grid = step(0.55, fract(p.x * 90.0)) + step(0.55, fract(p.z * 90.0));
      vBright = 0.7 + grid * 0.5 + uPulse * 0.8;
      vEnergy = 1.0;
      vAlpha = 1.0;
    } else if (aKind > 0.5) {
      // Trilha: um pacote de luz percorre do chip para a periferia.
      float head = fract(aTrace - uTime * 0.45);
      float packet = smoothstep(0.88, 1.0, head);
      vBright = 0.28 + packet * 2.2 + uPulse * 0.3;
      vEnergy = 1.0;
      vAlpha = 0.9;
    } else {
      // Córtex: a crista do giro recebe luz, o fundo do sulco fica na sombra.
      // É esse contraste que descreve o relevo — sem ele, a superfície some.
      float ridge = 1.0 - aDepth;
      vBright = 0.16 + key * 0.7 * ridge + fres * 0.6 + ridge * 0.45;
      vEnergy = 0.0;
      // Precisa atravessar a casca do crânio, que já é aditiva por cima.
      vAlpha = mix(0.35, 1.0, front) * (0.5 + ridge * 0.5);
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uPixelRatio * (1.0 + vBright * 0.4) / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uColorCortex;
  uniform vec3 uColorEnergy;

  varying float vBright;
  varying float vEnergy;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.2, d);
    a *= a;

    vec3 col = mix(uColorCortex, uColorEnergy, vEnergy);
    float alpha = a * vAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col * (0.35 + vBright), alpha);
  }
`

const LINE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;

  attribute vec3 aNormal;
  attribute float aDepth;
  attribute float aSeed;
  attribute float aTrace;
  attribute float aKind;

  varying float vBright;
  varying float vEnergy;
  varying float vAlpha;

  void main() {
    vec3 vn = normalize(normalMatrix * aNormal);
    float front = smoothstep(-0.5, 0.45, vn.z);

    if (aKind > 0.5) {
      float head = fract(aTrace - uTime * 0.45);
      float packet = smoothstep(0.86, 1.0, head);
      vBright = 0.2 + packet * 1.8 + uPulse * 0.25;
      vEnergy = 1.0;
      vAlpha = 0.8;
    } else {
      float ridge = 1.0 - aDepth;
      vBright = 0.08 + ridge * 0.35;
      vEnergy = 0.0;
      vAlpha = mix(0.05, 0.3, front) * (0.3 + ridge * 0.7);
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export function BrainPoints() {
  const phase = useAlanStore((s) => s.phase)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const data = useMemo(() => buildBrainData(), [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uSize: { value: 2.1 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColorCortex: { value: COLOR_CORTEX },
      uColorEnergy: { value: COLOR_ENERGY },
    }),
    [],
  )

  const [pointsGeometry, lineGeometry] = useMemo(() => {
    const attrs = {
      position: new THREE.BufferAttribute(data.positions, 3),
      aNormal: new THREE.BufferAttribute(data.normals, 3),
      aDepth: new THREE.BufferAttribute(data.depth, 1),
      aSeed: new THREE.BufferAttribute(data.seed, 1),
      aTrace: new THREE.BufferAttribute(data.trace, 1),
      aKind: new THREE.BufferAttribute(data.kind, 1),
    }

    const pts = new THREE.BufferGeometry()
    const lines = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(attrs)) {
      pts.setAttribute(name, attr)
      lines.setAttribute(name, attr)
    }
    lines.setIndex(new THREE.BufferAttribute(data.lineIndices, 1))
    return [pts, lines] as const
  }, [data])

  const pointsMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )

  const lineMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: LINE_VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )

  useEffect(
    () => () => {
      pointsGeometry.dispose()
      lineGeometry.dispose()
      pointsMaterial.dispose()
      lineMaterial.dispose()
    },
    [pointsGeometry, lineGeometry, pointsMaterial, lineMaterial],
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    uniforms.uTime.value = state.clock.elapsedTime

    // O chip acelera quando o agente raciocina ou fala.
    const busy = phaseRef.current === 'thinking' ? 1 : phaseRef.current === 'idle' ? 0.12 : 0.5
    const target = busy * (0.6 + audioSignal.energy * 0.6)
    uniforms.uPulse.value = damp(uniforms.uPulse.value, target, 4, dt)
  })

  return (
    <group>
      <points geometry={pointsGeometry} material={pointsMaterial} frustumCulled={false} />
      <lineSegments geometry={lineGeometry} material={lineMaterial} frustumCulled={false} />
    </group>
  )
}
