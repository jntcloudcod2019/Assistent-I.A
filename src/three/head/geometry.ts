import {
  basePoint,
  classifyRegion,
  evalProfile,
  fadeWeight,
  featureDisplacement,
  jawWeight,
  makeProfile,
} from './faceModel'

/**
 * Amostra a superfície paramétrica do rosto numa grade (u, v) e produz os
 * buffers da GPU.
 *
 * A grade regular dá três coisas de graça que a nuvem anterior não tinha:
 *  1. normais exatas por diferenças finitas entre vizinhos, sem reavaliar o campo;
 *  2. a malha de varredura sai dos próprios índices — nada de adivinhar vizinhos
 *     de Fibonacci nem filtrar arestas por distância;
 *  3. o elemento de área local, que compensa a densidade nas regiões onde a
 *     seção transversal encolhe (topo do crânio, pescoço).
 *
 * Roda uma única vez no boot; depois disso a GPU é dona da animação.
 */

export interface HeadData {
  count: number
  positions: Float32Array
  normals: Float32Array
  /** Peso na rotação da mandíbula, 0..1 */
  jaw: Float32Array
  region: Float32Array
  seed: Float32Array
  fade: Float32Array
  /** Elemento de área normalizado — compensa o adensamento nos polos */
  area: Float32Array
  /** Índices de linha da malha de varredura */
  lineIndices: Uint32Array
}

const NU = 192
const NV = 156
/** Espaçamento da malha de varredura sobre a grade de pontos. */
const LATTICE_STRIDE = 3

const TWO_PI = Math.PI * 2

/** Ruído determinístico: a mesma cabeça a cada boot. */
function hash2(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export function buildHeadData(): HeadData {
  const count = NU * NV
  const positions = new Float32Array(count * 3)
  const base = new Float32Array(count * 3)
  const baseNormals = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const jaw = new Float32Array(count)
  const region = new Float32Array(count)
  const seed = new Float32Array(count)
  const fade = new Float32Array(count)
  const area = new Float32Array(count)
  const us = new Float32Array(count)

  const prof = makeProfile()
  const du = TWO_PI / NU

  // — Passo 1: superfície-base. O perfil só depende de v, então é avaliado uma
  //   vez por linha em vez de uma vez por ponto.
  for (let j = 0; j < NV; j++) {
    const v = (j + 0.5) / NV
    evalProfile(v, prof)
    for (let i = 0; i < NU; i++) {
      // Jitter apenas em u: mantém o perfil compartilhado por linha e ainda
      // quebra o moiré de uma grade perfeitamente regular.
      const u = -Math.PI + i * du + (hash2(i, j) - 0.5) * du * 0.6
      const k = j * NU + i
      us[k] = u
      basePoint(u, prof, base, k * 3)
    }
  }

  gridNormals(base, baseNormals)

  // — Passo 2: desloca ao longo da normal-base pela mistura de gaussianas.
  for (let j = 0; j < NV; j++) {
    const v = (j + 0.5) / NV
    for (let i = 0; i < NU; i++) {
      const k = j * NU + i
      const k3 = k * 3
      const u = us[k]
      const d = featureDisplacement(u, v)

      positions[k3] = base[k3] + baseNormals[k3] * d
      positions[k3 + 1] = base[k3 + 1] + baseNormals[k3 + 1] * d
      positions[k3 + 2] = base[k3 + 2] + baseNormals[k3 + 2] * d

      region[k] = classifyRegion(u, v)
      jaw[k] = jawWeight(u, v)
      fade[k] = fadeWeight(v)
      seed[k] = Math.random()
    }
  }

  // — Passo 3: normais e densidade da superfície já deslocada.
  gridNormals(positions, normals, area)
  normalizeArea(area)

  return {
    count,
    positions,
    normals,
    jaw,
    region,
    seed,
    fade,
    area,
    lineIndices: buildLattice(),
  }
}

/**
 * Normais por diferenças centrais entre vizinhos da grade.
 *
 * n̂ = normalize(∂P/∂v × ∂P/∂u) — nesta ordem, porque u cresce de +Z para +X e
 * v desce; o produto na ordem inversa apontaria para dentro da cabeça.
 */
function gridNormals(src: Float32Array, out: Float32Array, areaOut?: Float32Array) {
  for (let j = 0; j < NV; j++) {
    const jUp = Math.max(0, j - 1)
    const jDown = Math.min(NV - 1, j + 1)
    for (let i = 0; i < NU; i++) {
      const iPrev = (i - 1 + NU) % NU
      const iNext = (i + 1) % NU

      const a = (j * NU + iNext) * 3
      const b = (j * NU + iPrev) * 3
      const c = (jDown * NU + i) * 3
      const d = (jUp * NU + i) * 3

      const ux = src[a] - src[b]
      const uy = src[a + 1] - src[b + 1]
      const uz = src[a + 2] - src[b + 2]
      const vx = src[c] - src[d]
      const vy = src[c + 1] - src[d + 1]
      const vz = src[c + 2] - src[d + 2]

      const nx = vy * uz - vz * uy
      const ny = vz * ux - vx * uz
      const nz = vx * uy - vy * ux

      const len = Math.hypot(nx, ny, nz)
      const k = j * NU + i
      const k3 = k * 3
      if (len > 1e-9) {
        out[k3] = nx / len
        out[k3 + 1] = ny / len
        out[k3 + 2] = nz / len
      } else {
        // Degenerado só no polo do crânio, onde a seção colapsa.
        out[k3] = 0
        out[k3 + 1] = 1
        out[k3 + 2] = 0
      }
      if (areaOut) areaOut[k] = len
    }
  }
}

/** Normaliza pela mediana para virar um multiplicador em torno de 1. */
function normalizeArea(area: Float32Array) {
  const sorted = Float32Array.from(area).sort()
  const median = sorted[Math.floor(sorted.length / 2)] || 1
  for (let i = 0; i < area.length; i++) {
    area[i] = Math.min(1.4, Math.max(0.25, area[i] / median))
  }
}

/**
 * Malha de varredura: arestas do próprio reticulado, subamostradas. Em u ela
 * fecha o anel; em v para antes da última linha.
 */
function buildLattice(): Uint32Array {
  const idx: number[] = []
  const cols = Math.floor(NU / LATTICE_STRIDE)

  for (let j = 0; j < NV - LATTICE_STRIDE; j += LATTICE_STRIDE) {
    for (let c = 0; c < cols; c++) {
      const i = c * LATTICE_STRIDE
      const iNext = ((c + 1) % cols) * LATTICE_STRIDE
      const here = j * NU + i

      idx.push(here, j * NU + iNext) // paralelo
      idx.push(here, (j + LATTICE_STRIDE) * NU + i) // meridiano
    }
  }

  return Uint32Array.from(idx)
}
