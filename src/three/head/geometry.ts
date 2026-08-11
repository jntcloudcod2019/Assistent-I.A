import {
  basePoint,
  classifyRegion,
  evalProfile,
  evalSurface,
  fadeWeight,
  featureDisplacement,
  featureGlow,
  jawWeight,
  makeProfile,
  EYE_ASPECT,
  EYE_PATCH,
  MOUTH_PATCH,
  REGION,
} from './faceModel'

/**
 * Amostra a superfície paramétrica do rosto como uma malha LOW-POLY.
 *
 * O alvo estético é o wireframe triangulado esparso: poucos vértices, nós
 * acesos, arestas finas e a cabeça vazada por dentro — não uma nuvem densa
 * preenchida. Isso muda três coisas em relação a uma grade fina:
 *
 * 1. POUCOS VÉRTICES (~3 mil, não 40 mil). Densidade alta preenche a silhueta e
 *    mata o efeito de casca translúcida.
 * 2. JITTER FORTE nos dois eixos. Uma grade regular lê como tela de mosquiteiro;
 *    deslocar cada vértice até ~0.42 de célula devolve a irregularidade de uma
 *    triangulação de Delaunay sem precisar computá-la.
 * 3. ARESTAS COM FALHAS. Cada quadrícula vira triângulo (lado, base e diagonal),
 *    e uma fração das arestas é descartada — as referências têm a malha
 *    visivelmente incompleta, e é isso que a faz parecer gerada, não desenhada.
 *
 * Roda uma única vez no boot; depois a GPU é dona da animação.
 */

export interface HeadData {
  count: number
  gridCount: number
  positions: Float32Array
  normals: Float32Array
  jaw: Float32Array
  region: Float32Array
  /** Ruído por vértice; nos retalhos carrega o ângulo polar normalizado. */
  seed: Float32Array
  fade: Float32Array
  area: Float32Array
  /** Raio local dentro de um retalho, 0..~1.2; 0 fora deles. */
  detail: Float32Array
  /** Concentração de luz da feição, 0..1 — acende rosto, apaga crânio. */
  glow: Float32Array
  lineIndices: Uint32Array
}

const NU = 56
const NV = 48
/** Fração das arestas descartada, para a malha ficar incompleta. */
const EDGE_DROPOUT = 0.3
/** Deslocamento máximo do vértice, em frações de célula. */
const JITTER = 0.42
/** Partículas soltas orbitando a cabeça. */
const MOTES = 70

const TWO_PI = Math.PI * 2

// ---------------------------------------------------------------------------
// Densidade dirigida
// ---------------------------------------------------------------------------

interface DensitySeg {
  to: number
  weight: number
}

/**
 * Inverte a CDF de uma densidade constante por trechos: devolve t ∈ [0,1] → x,
 * gastando amostras proporcionalmente ao peso de cada trecho.
 */
function makeWarp(from: number, segs: DensitySeg[]): (t: number) => number {
  const edges = [from, ...segs.map((s) => s.to)]
  const mass = segs.map((s, i) => (edges[i + 1] - edges[i]) * s.weight)
  const total = mass.reduce((a, b) => a + b, 0)

  const cdf = [0]
  for (const m of mass) cdf.push(cdf[cdf.length - 1] + m / total)

  return (t: number) => {
    const clamped = Math.min(1, Math.max(0, t))
    let i = 0
    while (i < cdf.length - 2 && cdf[i + 1] < clamped) i++
    const span = cdf[i + 1] - cdf[i]
    const local = span > 1e-9 ? (clamped - cdf[i]) / span : 0
    return edges[i] + local * (edges[i + 1] - edges[i])
  }
}

/**
 * Densidade quase plana. Concentrar linhas na faixa olhos–boca fazia sentido
 * quando a malha desenhava as feições; agora quem as desenha são os retalhos, e
 * o adensamento só produzia um emaranhado brilhante em volta delas.
 */
const warpV = makeWarp(0, [
  { to: 0.25, weight: 1.5 }, // calota
  { to: 0.3, weight: 1.6 }, // testa
  { to: 0.42, weight: 1.5 }, // olhos
  { to: 0.48, weight: 1.6 }, // nariz
  { to: 0.56, weight: 1.5 }, // boca
  { to: 0.7, weight: 1.4 }, // queixo
  { to: 1.0, weight: 0.7 }, // pescoço
])

const warpU = makeWarp(-Math.PI, [
  { to: -1.8, weight: 0.85 },
  { to: -1.2, weight: 1.2 },
  { to: -0.6, weight: 1.6 },
  { to: 0.6, weight: 1.8 },
  { to: 1.2, weight: 1.6 },
  { to: 1.8, weight: 1.2 },
  { to: Math.PI, weight: 0.85 },
])

/** Ruído determinístico: a mesma cabeça a cada boot. */
function hash2(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return s - Math.floor(s)
}

// ---------------------------------------------------------------------------
// Retalhos polares
// ---------------------------------------------------------------------------

interface PatchAnchor {
  u: number
  v: number
  su: number
  sv: number
}

interface PatchPoint {
  u: number
  v: number
  r: number
  a: number
  detail: number
}

/** Onde cada anel começa e quantos pontos tem, para fechá-lo em arestas. */
interface Ring {
  start: number
  count: number
}

/** Traço anatômico desenhado ponto a ponto, onde a malha não dá conta. */
interface ContourPath {
  pts: Array<[u: number, v: number]>
  closed: boolean
}

const mirrorPath = (pts: Array<[number, number]>): Array<[number, number]> =>
  pts.map(([u, v]) => [-u, v] as [number, number])

/**
 * O nariz não sobrevive a um retalho polar — anéis concêntricos na ponta leriam
 * como alvo, não como nariz. Aqui ele é um traço explícito: o laço da asa e da
 * base, mais duas linhas descendo o dorso. As sobrancelhas seguem a mesma
 * lógica, como arcos abertos.
 */
function buildContours(): ContourPath[] {
  const noseHalf: Array<[number, number]> = [
    [0.0, 0.4185],
    [0.042, 0.4245],
    [0.082, 0.4375],
    [0.112, 0.4525],
    [0.122, 0.4665],
    [0.092, 0.4755],
    [0.05, 0.4735],
    [0.0, 0.4775],
  ]
  // Espelha e remove os dois extremos, que já estão no plano sagital.
  const noseLoop = [...noseHalf, ...mirrorPath([...noseHalf].reverse()).slice(1, -1)]

  const dorsum: Array<[number, number]> = [
    [0.028, 0.352],
    [0.032, 0.382],
    [0.038, 0.406],
    [0.052, 0.428],
  ]

  const brow: Array<[number, number]> = [
    [0.235, 0.3235],
    [0.33, 0.3145],
    [0.44, 0.3105],
    [0.55, 0.3135],
    [0.635, 0.3235],
  ]

  return [
    { pts: noseLoop, closed: true },
    { pts: dorsum, closed: false },
    { pts: mirrorPath(dorsum), closed: false },
    { pts: brow, closed: false },
    { pts: mirrorPath(brow), closed: false },
  ]
}

interface Patch {
  points: PatchPoint[]
  rings: Ring[]
}

function polarPatch(anchor: PatchAnchor, rings: number, rMax: number): Patch {
  const points: PatchPoint[] = []
  const ringSpans: Ring[] = []
  const dr = rMax / rings

  for (let ri = 0; ri < rings; ri++) {
    const r = (ri + 0.5) * dr
    const spokes = Math.max(6, Math.round((TWO_PI * r) / dr))
    const phase = (ri % 2) * 0.5
    ringSpans.push({ start: points.length, count: spokes })

    for (let si = 0; si < spokes; si++) {
      const a = (si + phase) / spokes
      const theta = a * TWO_PI
      points.push({
        u: anchor.u + Math.cos(theta) * r * anchor.su,
        v: anchor.v + Math.sin(theta) * r * anchor.sv,
        r,
        a,
        detail: r,
      })
    }
  }
  return { points, rings: ringSpans }
}

/**
 * A abertura é amendoada, mas a íris é um círculo. `rIso` desfaz o achatamento
 * da fenda palpebral, então pupila e íris saem redondas mesmo num olho largo.
 */
function classifyEye(p: PatchPoint): number {
  if (p.r > 1) return REGION.EYELID

  const theta = p.a * TWO_PI
  const rIso = Math.hypot(Math.cos(theta) * p.r * EYE_ASPECT, Math.sin(theta) * p.r)
  p.detail = rIso

  // A íris ultrapassa a abertura em altura e é recortada pelas pálpebras, como
  // num olho real. Limitá-la a rIso < 1 deixava só uma faixa vertical estreita
  // de mecanismo, cercada de esclera.
  if (rIso < 0.5) return REGION.PUPIL
  if (rIso < 1.3) return REGION.IRIS
  return REGION.SCLERA
}

function classifyMouth(p: PatchPoint): number {
  if (p.r > 1) return REGION.SKIN
  const dv = Math.sin(p.a * TWO_PI) * p.r
  return Math.abs(dv) < 0.13 ? REGION.MOUTH_LINE : REGION.LIPS
}

// ---------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------

export function buildHeadData(): HeadData {
  const gridCount = NU * NV

  // A íris mecânica precisa de resolução: anéis, arcos e marcas radiais não
  // aparecem com 5 anéis de amostragem.
  const eyeLeft = polarPatch(EYE_PATCH, 14, 1.16)
  const eyeRight = polarPatch({ ...EYE_PATCH, u: -EYE_PATCH.u }, 14, 1.16)
  const mouth = polarPatch(MOUTH_PATCH, 4, 1.12)
  const patches = [eyeLeft, eyeRight, mouth]
  const patchCount = patches.reduce((n, p) => n + p.points.length, 0)
  const contours = buildContours()
  const contourCount = contours.reduce((n, c) => n + c.pts.length, 0)
  const count = gridCount + patchCount + MOTES + contourCount

  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const jaw = new Float32Array(count)
  const region = new Float32Array(count)
  const seed = new Float32Array(count)
  const fade = new Float32Array(count)
  const area = new Float32Array(count)
  const detail = new Float32Array(count)
  const glow = new Float32Array(count)

  // — Grade principal ——————————————————————————————————————
  const base = new Float32Array(gridCount * 3)
  const baseNormals = new Float32Array(gridCount * 3)
  const us = new Float32Array(gridCount)
  const vsPer = new Float32Array(gridCount)
  const prof = makeProfile()

  const du = 1 / NU
  const dv = 1 / NV

  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const k = j * NU + i
      // Jitter nos dois eixos. Com apenas ~2.7 mil vértices o perfil pode ser
      // avaliado por ponto, então v também pode ser deslocado.
      const tu = i / NU + (hash2(i, j) - 0.5) * du * 2 * JITTER
      // O mínimo em 0.022 evita amostrar o polo do crânio, onde a seção
      // colapsa e todas as colunas convergem num nó emaranhado.
      const tv = Math.min(0.998, Math.max(0.022, (j + 0.5) * dv + (hash2(j, i + 91) - 0.5) * dv * 2 * JITTER))

      const u = warpU(tu - Math.floor(tu))
      const v = warpV(tv)
      us[k] = u
      vsPer[k] = v

      evalProfile(v, prof)
      basePoint(u, prof, base, k * 3)
    }
  }

  gridNormals(base, baseNormals)

  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const k = j * NU + i
      const k3 = k * 3
      const u = us[k]
      const v = vsPer[k]
      const d = featureDisplacement(u, v)

      positions[k3] = base[k3] + baseNormals[k3] * d
      positions[k3 + 1] = base[k3 + 1] + baseNormals[k3 + 1] * d
      positions[k3 + 2] = base[k3 + 2] + baseNormals[k3 + 2] * d

      region[k] = classifyRegion(u, v)
      jaw[k] = jawWeight(u, v)
      fade[k] = fadeWeight(v)
      glow[k] = featureGlow(u, v)
      seed[k] = hash2(i + 7, j + 13)
    }
  }

  gridNormals(positions, normals, area)
  normalizeArea(area, gridCount)

  // — Retalhos ————————————————————————————————————————————
  let cursor = gridCount
  /** Offsets globais de cada anel, para o traçado dos contornos. */
  const contourRings: Ring[] = []

  const writePatch = (
    patch: Patch,
    classify: (p: PatchPoint) => number,
    density: number,
    /** Quais anéis viram traço. Desenhar todos faria olho e boca lerem como alvo. */
    drawRing: (index: number, total: number) => boolean,
  ) => {
    const base = cursor
    patch.rings.forEach((ring, index) => {
      if (drawRing(index, patch.rings.length)) {
        contourRings.push({ start: base + ring.start, count: ring.count })
      }
    })
    for (const p of patch.points) {
      const k = cursor++
      const k3 = k * 3
      evalSurface(p.u, p.v, positions, k3)

      evalSurface(p.u + NORMAL_H, p.v, scratchA, 0)
      evalSurface(p.u - NORMAL_H, p.v, scratchB, 0)
      evalSurface(p.u, p.v + NORMAL_H, scratchC, 0)
      evalSurface(p.u, p.v - NORMAL_H, scratchD, 0)

      const ux = scratchA[0] - scratchB[0]
      const uy = scratchA[1] - scratchB[1]
      const uz = scratchA[2] - scratchB[2]
      const vx = scratchC[0] - scratchD[0]
      const vy = scratchC[1] - scratchD[1]
      const vz = scratchC[2] - scratchD[2]

      let nx = vy * uz - vz * uy
      let ny = vz * ux - vx * uz
      let nz = vx * uy - vy * ux
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len

      // Empurra o retalho um fio para fora: coplanar com a grade, o z-fighting
      // aditivo faria as feições cintilarem.
      positions[k3] += nx * 0.0015
      positions[k3 + 1] += ny * 0.0015
      positions[k3 + 2] += nz * 0.0015

      normals[k3] = nx
      normals[k3 + 1] = ny
      normals[k3 + 2] = nz

      region[k] = classify(p)
      jaw[k] = jawWeight(p.u, p.v)
      fade[k] = fadeWeight(p.v)
      glow[k] = 1
      area[k] = density
      seed[k] = p.a
      detail[k] = p.detail
    }
  }

  // Olho: o anel externo dá a fenda palpebral e o interno lê como íris.
  const eyeRings = (i: number, n: number) => i === n - 1 || i === 1
  // Boca: só o contorno externo — os internos viravam alvo concêntrico.
  const outerOnly = (i: number, n: number) => i === n - 1
  writePatch(eyeLeft, classifyEye, 0.9, eyeRings)
  writePatch(eyeRight, classifyEye, 0.9, eyeRings)
  writePatch(mouth, classifyMouth, 0.8, outerOnly)

  // — Partículas soltas ————————————————————————————————————
  // As referências têm pontos flutuando ao redor da cabeça, alguns ligados por
  // linhas longas. É o que dá a impressão de varredura em andamento.
  const moteStart = cursor
  for (let m = 0; m < MOTES; m++) {
    const k = cursor++
    const k3 = k * 3
    const t = (m + 0.5) / MOTES
    const phi = Math.acos(1 - 2 * t)
    const theta = t * MOTES * 2.399963
    const radius = 0.58 + hash2(m, 3) * 0.42

    const sx = Math.sin(phi) * Math.cos(theta)
    const sy = Math.cos(phi) * 0.85 - 0.1
    const sz = Math.sin(phi) * Math.sin(theta)

    positions[k3] = sx * radius
    positions[k3 + 1] = sy * radius
    positions[k3 + 2] = sz * radius
    normals[k3] = sx
    normals[k3 + 1] = sy
    normals[k3 + 2] = sz

    region[k] = REGION.SKIN
    jaw[k] = 0
    fade[k] = 1
    glow[k] = 0.9
    area[k] = 1
    seed[k] = hash2(m + 51, 17)
    detail[k] = 0
  }

  // — Traços anatômicos ————————————————————————————————————
  const contourEdges: number[] = []
  for (const path of contours) {
    const base = cursor
    for (const [u, v] of path.pts) {
      const k = cursor++
      const k3 = k * 3
      evalSurface(u, v, positions, k3)

      // Normal radial aproximada: estes pontos só precisam de orientação para o
      // termo de frente/verso, não de sombreamento fino.
      const nx = positions[k3]
      const ny = positions[k3 + 1] - 0.05
      const nz = positions[k3 + 2]
      const len = Math.hypot(nx, ny, nz) || 1
      normals[k3] = nx / len
      normals[k3 + 1] = ny / len
      normals[k3 + 2] = nz / len

      // Desloca para fora, senão o traço afunda na malha.
      positions[k3] += normals[k3] * 0.004
      positions[k3 + 1] += normals[k3 + 1] * 0.004
      positions[k3 + 2] += normals[k3 + 2] * 0.004

      region[k] = REGION.SKIN
      jaw[k] = jawWeight(u, v)
      fade[k] = fadeWeight(v)
      glow[k] = 1
      area[k] = 0.8
      seed[k] = 0.5
      // detail > 0 marca como retalho: ponto menor, sem cintilação de nó.
      detail[k] = 0.5
    }

    const n = path.pts.length
    const last = path.closed ? n : n - 1
    for (let s = 0; s < last; s++) {
      contourEdges.push(base + s, base + ((s + 1) % n))
    }
  }

  return {
    count,
    gridCount,
    positions,
    normals,
    jaw,
    region,
    seed,
    fade,
    area,
    detail,
    glow,
    lineIndices: buildLattice(moteStart, contourRings, contourEdges),
  }
}

const NORMAL_H = 2e-3
const scratchA = new Float32Array(3)
const scratchB = new Float32Array(3)
const scratchC = new Float32Array(3)
const scratchD = new Float32Array(3)

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
        out[k3] = 0
        out[k3 + 1] = 1
        out[k3 + 2] = 0
      }
      if (areaOut) areaOut[k] = len
    }
  }
}

function normalizeArea(area: Float32Array, upTo: number) {
  const sorted = Float32Array.from(area.subarray(0, upTo)).sort()
  const median = sorted[Math.floor(sorted.length / 2)] || 1
  for (let i = 0; i < upTo; i++) {
    area[i] = Math.min(1.4, Math.max(0.12, area[i] / median))
  }
}

/**
 * Malha triangulada: cada quadrícula contribui lado, base e diagonal. Uma
 * fração das arestas é descartada para a malha ficar incompleta como nas
 * referências. Algumas partículas soltas são amarradas à cabeça por linhas
 * longas, produzindo os raios que saem do contorno.
 */
function buildLattice(
  moteStart: number,
  contourRings: Ring[],
  contourEdges: number[],
): Uint32Array {
  const idx: number[] = [...contourEdges]

  // Contornos das feições. Nas referências olhos e boca não são aglomerados de
  // pontos: são desenhados como laços fechados — a abertura palpebral, o anel
  // da íris, o contorno do lábio. Fechar cada anel do retalho em arestas é o
  // que transforma pontilhado em traço.
  for (const ring of contourRings) {
    for (let s = 0; s < ring.count; s++) {
      idx.push(ring.start + s, ring.start + ((s + 1) % ring.count))
    }
  }

  for (let j = 0; j < NV - 1; j++) {
    for (let i = 0; i < NU; i++) {
      const iNext = (i + 1) % NU
      const here = j * NU + i
      const right = j * NU + iNext
      const below = (j + 1) * NU + i
      const diag = (j + 1) * NU + iNext

      if (hash2(i, j * 3 + 1) > EDGE_DROPOUT) idx.push(here, right)
      if (hash2(i, j * 3 + 2) > EDGE_DROPOUT) idx.push(here, below)
      if (hash2(i, j * 3 + 3) > EDGE_DROPOUT) idx.push(here, diag)
    }
  }

  // Raios ligando partículas soltas a vértices da cabeça.
  for (let m = 0; m < MOTES; m += 4) {
    const mote = moteStart + m
    const anchor = Math.floor(hash2(m + 5, 29) * NU * NV)
    idx.push(mote, anchor)
  }

  return Uint32Array.from(idx)
}
