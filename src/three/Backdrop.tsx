import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { audioSignal, damp } from '@/core/state/audioSignal'

/**
 * Atlas de dígitos binários. As colunas rolam em velocidades diferentes no
 * shader, então uma única textura estática basta.
 */
function makeBinaryTexture(): THREE.CanvasTexture {
  const cols = 32
  const rows = 32
  const cell = 24
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = rows * cell
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = `600 ${cell * 0.7}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Alguns espaços em branco impedem que a chuva vire um bloco sólido.
      if (Math.random() < 0.35) continue
      ctx.fillStyle = `rgba(120, 230, 255, ${0.25 + Math.random() * 0.75})`
      ctx.fillText(Math.random() < 0.5 ? '0' : '1', (x + 0.5) * cell, (y + 0.5) * cell)
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearFilter
  return texture
}

const RAIN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const RAIN_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uColumns;
  uniform float uRepeat;
  uniform vec3 uColor;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    // O atlas se repete uRepeat vezes no plano — sem isso cada dígito ficaria
    // do tamanho da cabeça.
    vec2 tiled = vUv * uRepeat;

    // Cada coluna desce no seu próprio ritmo.
    float col = floor(tiled.x * uColumns);
    float speed = 0.06 + hash(col) * 0.26 + uEnergy * 0.4;
    float offset = hash(col * 7.3) * 10.0;

    float scroll = tiled.y - uTime * speed + offset;
    float glyph = texture2D(uMap, vec2(tiled.x, fract(scroll))).g;

    // Cabeça de coluna mais brilhante, cauda desvanecendo.
    float trail = fract(scroll * 0.25);
    float fade = smoothstep(0.0, 0.5, trail) * smoothstep(1.0, 0.55, trail);

    // Escurece nas bordas para não competir com o holograma.
    float edge = smoothstep(0.0, 0.24, vUv.x) * smoothstep(1.0, 0.76, vUv.x);
    edge *= smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);

    float a = glyph * fade * edge * (0.028 + uEnergy * 0.06);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

const GRID_VERT = RAIN_VERT

const GRID_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    vec2 g = abs(fract(vUv * 26.0) - 0.5);
    float line = min(g.x, g.y);
    float grid = smoothstep(0.06, 0.0, line);

    // Pulso concêntrico saindo do centro do palco.
    float r = length(vUv - 0.5) * 2.0;
    float pulse = sin(r * 12.0 - uTime * 1.1) * 0.5 + 0.5;

    float a = grid * smoothstep(1.0, 0.15, r) * (0.05 + pulse * 0.05);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

export function Backdrop() {
  const binaryTexture = useMemo(makeBinaryTexture, [])

  const rainUniforms = useMemo(
    () => ({
      uMap: { value: binaryTexture },
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uColumns: { value: 32 },
      uRepeat: { value: 4 },
      uColor: { value: new THREE.Color('#5fd8f5') },
    }),
    [binaryTexture],
  )

  const gridUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#2fb6d8') },
    }),
    [],
  )

  useEffect(() => () => binaryTexture.dispose(), [binaryTexture])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    rainUniforms.uTime.value = t
    gridUniforms.uTime.value = t
    rainUniforms.uEnergy.value = damp(rainUniforms.uEnergy.value, audioSignal.energy, 4, dt)
  })

  return (
    <group>
      {/* Chuva binária ao fundo */}
      <mesh position={[0, 0.2, -4.2]}>
        <planeGeometry args={[12, 7]} />
        <shaderMaterial
          uniforms={rainUniforms}
          vertexShader={RAIN_VERT}
          fragmentShader={RAIN_FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Grade no piso do palco */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.04, -0.4]}>
        <planeGeometry args={[9, 9]} />
        <shaderMaterial
          uniforms={gridUniforms}
          vertexShader={GRID_VERT}
          fragmentShader={GRID_FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  )
}
