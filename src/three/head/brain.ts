/**
 * Cérebro dentro do crânio.
 *
 * Proporções antropométricas, normalizadas pela mesma altura de cabeça do
 * rosto (H ≈ 0.94 para 23 cm):
 *   comprimento ântero-posterior  17 cm → 0.694
 *   largura máxima               14 cm → 0.571
 *   altura                        9 cm → 0.367
 * O centro fica na abóbada craniana, um pouco atrás do plano dos olhos.
 *
 * O que faz um elipsoide virar cérebro são os GIROS. Eles não são ruído
 * aleatório: são sulcos alongados que correm em faixas paralelas ao longo do
 * eixo ântero-posterior, com bifurcações. Ruído isotrópico produziria uma
 * superfície de couve-flor, que lê como pedra, não como córtex.
 */

export const BRAIN = {
  /** Semi-eixos do elipsoide de base. */
  rx: 0.2855,
  ry: 0.1835,
  rz: 0.347,
  /** Centro no espaço da cabeça. A base do cérebro fica logo acima da linha
   *  dos olhos (y ≈ 0.01) e o topo pouco abaixo do vértice (y = 0.5) — mais
   *  baixo que isso e ele invade a face em vez de ocupar a abóbada. */
  cx: 0,
  cy: 0.255,
  cz: -0.045,
  /** Meia-largura da fissura longitudinal que separa os hemisférios. */
  fissure: 0.016,
} as const

export interface BrainData {
  count: number
  positions: Float32Array
  normals: Float32Array
  /** Profundidade no sulco, 0 na crista e 1 no fundo — dirige o sombreamento. */
  depth: Float32Array
  seed: Float32Array
  /** Distância normalizada até o chip, 0..1 — dirige o pulso de energia. */
  trace: Float32Array
  /** 0 córtex · 1 trilha de circuito · 2 chip */
  kind: Float32Array
  lineIndices: Uint32Array
}

const TWO_PI = Math.PI * 2

function hash(i: number, j: number): number {
  const s = Math.sin(i * 91.7 + j * 47.3) * 28461.13
  return s - Math.floor(s)
}

/**
 * Campo dos giros.
 *
 * Duas ondas de frequências diferentes ao longo do eixo Z (ântero-posterior),
 * moduladas pela latitude — é o que produz sulcos que correm de frente para
 * trás e se curvam nas laterais, como no córtex real.
 */
function gyriDepth(x: number, y: number, z: number): number {
  const along = z * 13.5 + Math.sin(y * 9.0) * 1.6
  const across = x * 7.5

  const primary = Math.sin(along + Math.sin(across) * 0.9)
  const secondary = Math.sin(along * 1.87 + across * 1.4 + 2.1) * 0.55
  const tertiary = Math.sin(y * 16.0 + z * 6.0) * 0.28

  // 0 na crista, 1 no fundo do sulco.
  return (1 - (primary + secondary + tertiary) / 1.83) * 0.5
}

export function buildBrainData(rings = 78, segments = 116): BrainData {
  const cortexCount = rings * segments
  // Trilhas irradiando do chip pela superfície.
  const TRACE_COUNT = 22
  const TRACE_STEPS = 26
  const traceCount = TRACE_COUNT * TRACE_STEPS
  // Corpo do chip.
  const CHIP_SIDE = 9
  const chipCount = CHIP_SIDE * CHIP_SIDE

  const count = cortexCount + traceCount + chipCount
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const depth = new Float32Array(count)
  const seed = new Float32Array(count)
  const trace = new Float32Array(count)
  const kind = new Float32Array(count)

  // — Córtex ————————————————————————————————————————————————
  for (let j = 0; j < rings; j++) {
    // Latitude por área igual, para os polos não adensarem.
    const w = 1 - ((j + 0.5) / rings) * 2
    const sinLat = Math.sqrt(Math.max(0, 1 - w * w))

    for (let i = 0; i < segments; i++) {
      const lon = (i / segments) * TWO_PI
      const k = j * segments + i
      const k3 = k * 3

      let nx = Math.cos(lon) * sinLat
      const ny = w
      const nz = Math.sin(lon) * sinLat

      // Fissura longitudinal: os hemisférios se afastam do plano sagital.
      const side = nx >= 0 ? 1 : -1
      const nearMid = 1 - Math.min(1, Math.abs(nx) / 0.34)

      let px = nx * BRAIN.rx
      const py = ny * BRAIN.ry
      const pz = nz * BRAIN.rz

      const d = gyriDepth(px, py, pz)
      // O sulco afunda ao longo da normal; a crista permanece no elipsoide.
      const sink = d * 0.019

      // Achatamento frontal e occipital arredondado, que o elipsoide puro não dá.
      const lobe = 1 - Math.max(0, pz) * 0.16

      px += side * nearMid * BRAIN.fissure

      positions[k3] = BRAIN.cx + (px - nx * sink) * lobe
      positions[k3 + 1] = BRAIN.cy + (py - ny * sink) * lobe
      positions[k3 + 2] = BRAIN.cz + (pz - nz * sink) * lobe

      // Normal do elipsoide, suficiente para o sombreamento de superfície.
      const len = Math.hypot(nx / BRAIN.rx, ny / BRAIN.ry, nz / BRAIN.rz) || 1
      normals[k3] = nx / BRAIN.rx / len
      normals[k3 + 1] = ny / BRAIN.ry / len
      normals[k3 + 2] = nz / BRAIN.rz / len

      depth[k] = d
      seed[k] = hash(i, j)
      trace[k] = 0
      kind[k] = 0
    }
  }

  // — Trilhas e chip ————————————————————————————————————————
  const idx: number[] = []
  let cursor = cortexCount

  // Malha do córtex: paralelos e meridianos, subamostrados.
  const stride = 2
  for (let j = 0; j < rings - stride; j += stride) {
    for (let i = 0; i < segments; i += stride) {
      const here = j * segments + i
      const right = j * segments + ((i + stride) % segments)
      const below = (j + stride) * segments + i
      idx.push(here, right, here, below)
    }
  }

  // O chip fica no centro geométrico, entre os hemisférios.
  const chipY = BRAIN.cy - 0.01
  const chipZ = BRAIN.cz + 0.02
  const chipHalf = 0.036

  const chipStart = cursor
  for (let a = 0; a < CHIP_SIDE; a++) {
    for (let b = 0; b < CHIP_SIDE; b++) {
      const k = cursor++
      const k3 = k * 3
      const fx = (a / (CHIP_SIDE - 1) - 0.5) * 2
      const fz = (b / (CHIP_SIDE - 1) - 0.5) * 2

      positions[k3] = fx * chipHalf
      positions[k3 + 1] = chipY
      positions[k3 + 2] = chipZ + fz * chipHalf
      normals[k3] = 0
      normals[k3 + 1] = 1
      normals[k3 + 2] = 0

      depth[k] = 0
      seed[k] = hash(a + 3, b + 11)
      trace[k] = 0
      kind[k] = 2
    }
  }

  // Contorno do chip, para ele ler como componente e não como mancha.
  for (let a = 0; a < CHIP_SIDE - 1; a++) {
    idx.push(chipStart + a, chipStart + a + 1)
    idx.push(
      chipStart + (CHIP_SIDE - 1) * CHIP_SIDE + a,
      chipStart + (CHIP_SIDE - 1) * CHIP_SIDE + a + 1,
    )
    idx.push(chipStart + a * CHIP_SIDE, chipStart + (a + 1) * CHIP_SIDE)
    idx.push(chipStart + a * CHIP_SIDE + CHIP_SIDE - 1, chipStart + (a + 1) * CHIP_SIDE + CHIP_SIDE - 1)
  }

  // Trilhas saindo do chip e subindo pela superfície do córtex, em degraus
  // ortogonais — é o ângulo reto que faz ler como placa, não como veia.
  for (let t = 0; t < TRACE_COUNT; t++) {
    const lon = (t / TRACE_COUNT) * TWO_PI + hash(t, 5) * 0.2
    let px = Math.cos(lon) * chipHalf * 0.9
    let py = chipY
    let pz = chipZ + Math.sin(lon) * chipHalf * 0.9

    const targetX = Math.cos(lon) * BRAIN.rx * 0.92
    const targetZ = Math.sin(lon) * BRAIN.rz * 0.92
    const targetY = BRAIN.cy + BRAIN.ry * (0.15 + hash(t, 9) * 0.7)

    const start = cursor
    for (let s = 0; s < TRACE_STEPS; s++) {
      const f = s / (TRACE_STEPS - 1)
      const k = cursor++
      const k3 = k * 3

      // Alterna avanço horizontal e vertical: degraus, não diagonal.
      const stepPhase = Math.floor(f * 8) % 2
      const hz = stepPhase === 0 ? Math.min(1, f * 1.25) : Math.min(1, (f - 0.06) * 1.25)
      const vt = stepPhase === 1 ? f : Math.max(0, f - 0.08)

      px = Math.cos(lon) * chipHalf * 0.9 + (targetX - Math.cos(lon) * chipHalf * 0.9) * hz
      pz = chipZ + Math.sin(lon) * chipHalf * 0.9 + (targetZ - Math.sin(lon) * chipHalf * 0.9) * hz
      py = chipY + (targetY - chipY) * vt

      positions[k3] = px
      positions[k3 + 1] = py
      positions[k3 + 2] = pz

      const nl = Math.hypot(px, py - BRAIN.cy, pz - BRAIN.cz) || 1
      normals[k3] = px / nl
      normals[k3 + 1] = (py - BRAIN.cy) / nl
      normals[k3 + 2] = (pz - BRAIN.cz) / nl

      depth[k] = 0
      seed[k] = hash(t, s)
      trace[k] = f
      kind[k] = 1

      if (s > 0) idx.push(k - 1, k)
    }
    void start
  }

  return {
    count,
    positions,
    normals,
    depth,
    seed,
    trace,
    kind,
    lineIndices: Uint32Array.from(idx),
  }
}
