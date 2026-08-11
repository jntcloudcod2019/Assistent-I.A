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

// Malha fina o suficiente para as arestas descreverem a superfície em vez de
// facetá-la. A carta (u, v) já corre em anéis ao redor da cabeça e meridianos
// descendo, então o quadriculado segue o fluxo anatômico sozinho.
const NU = 104
const NV = 92
/** Deslocamento máximo do vértice, em frações de célula. */
const JITTER = 0.06
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
  region: number
  /**
   * Curva os cantos por Catmull-Rom. Verdadeiro para anatomia; falso para
   * circuitos, que precisam de ângulos retos — suavizá-los os transformaria
   * em rabiscos orgânicos.
   */
  smooth?: boolean
}

const mirrorPath = (pts: Array<[number, number]>): Array<[number, number]> =>
  pts.map(([u, v]) => [-u, v] as [number, number])

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/**
 * Adensa e suaviza um traço por Catmull-Rom.
 *
 * Os pontos de controle são poucos, escolhidos por anatomia. Ligados direto,
 * o contorno lê como uma linha quebrada de vértices soltos em vez de curva —
 * a boca em particular perde o arco do cupido.
 */
function resamplePath(
  pts: Array<[number, number]>,
  closed: boolean,
  perSegment: number,
): Array<[number, number]> {
  const n = pts.length
  if (n < 3) return pts

  const at = (i: number): [number, number] =>
    closed ? pts[(i + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]

  const out: Array<[number, number]> = []
  const segments = closed ? n : n - 1

  for (let i = 0; i < segments; i++) {
    const [x0, y0] = at(i - 1)
    const [x1, y1] = at(i)
    const [x2, y2] = at(i + 1)
    const [x3, y3] = at(i + 2)
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment
      out.push([catmull(x0, x1, x2, x3, t), catmull(y0, y1, y2, y3, t)])
    }
  }
  if (!closed) out.push(pts[n - 1])
  return out
}

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

  // — Pálpebras —————————————————————————————————————————————
  // Uma elipse não é olho. O que faz a abertura ler como humana são três
  // assimetrias: o canto externo fica mais alto que o interno (inclinação
  // cantal), o ápice da pálpebra superior desloca-se para o lado nasal, e o
  // vale da inferior para o temporal. Simétrico, o olho vira amêndoa genérica.
  const eyelid = (cu: number): Array<[number, number]> => {
    const cv = 0.353
    return [
      [cu - 0.2, cv + 0.0016], // canto interno, mais baixo
      [cu - 0.13, cv - 0.0092],
      [cu - 0.05, cv - 0.0134], // ápice superior, deslocado ao nasal
      [cu + 0.05, cv - 0.0116],
      [cu + 0.14, cv - 0.0068],
      [cu + 0.2, cv - 0.0024], // canto externo, mais alto
      [cu + 0.13, cv + 0.0062],
      [cu + 0.05, cv + 0.0104], // vale inferior, deslocado ao temporal
      [cu - 0.05, cv + 0.01],
      [cu - 0.13, cv + 0.0068],
    ]
  }

  // — Lábios ———————————————————————————————————————————————
  // Um retalho polar só sabe produzir elipse, e elipse não é boca. Os lábios
  // precisam de arco do cupido (dois picos com depressão no meio), lábio
  // inferior mais cheio que o superior e comissuras afiladas — nada disso
  // existe num anel concêntrico.
  const CORNER: [number, number] = [0.3, 0.5125]

  // Borda vermelhão superior, da comissura esquerda à direita.
  const upperBorder: Array<[number, number]> = [
    [-0.3, 0.5125],
    [-0.222, 0.5045],
    [-0.145, 0.4975],
    [-0.072, 0.4935], // pico esquerdo do arco do cupido
    [0.0, 0.4975], // depressão central
    [0.072, 0.4935], // pico direito
    [0.145, 0.4975],
    [0.222, 0.5045],
    CORNER,
  ]

  // Linha de fechamento (stomion), da direita para a esquerda.
  const stomionRL: Array<[number, number]> = [
    [0.21, 0.5145],
    [0.11, 0.5145],
    [0.0, 0.5135],
    [-0.11, 0.5145],
    [-0.21, 0.5145],
  ]

  // Borda inferior, mais alta que a superior: proporção vermelhão ≈ 1 : 1.6.
  const lowerBorderRL: Array<[number, number]> = [
    [0.245, 0.5235],
    [0.17, 0.5325],
    [0.085, 0.5375],
    [0.0, 0.5385],
    [-0.085, 0.5375],
    [-0.17, 0.5325],
    [-0.245, 0.5235],
  ]

  const upperLip = [...upperBorder, ...stomionRL]
  const lowerLip = [...upperBorder.slice(0, 1), ...[...stomionRL].reverse(), CORNER, ...lowerBorderRL]

  const paths: ContourPath[] = [
    { pts: noseLoop, closed: true, region: REGION.SKIN, smooth: true },
    { pts: dorsum, closed: false, region: REGION.SKIN, smooth: true },
    { pts: mirrorPath(dorsum), closed: false, region: REGION.SKIN, smooth: true },
    { pts: brow, closed: false, region: REGION.BROW, smooth: true },
    { pts: mirrorPath(brow), closed: false, region: REGION.BROW, smooth: true },
    { pts: upperLip, closed: true, region: REGION.LIPS, smooth: true },
    { pts: lowerLip, closed: true, region: REGION.LIPS, smooth: true },
    { pts: eyelid(0.44), closed: true, region: REGION.EYELID, smooth: true },
    { pts: mirrorPath(eyelid(0.44)), closed: true, region: REGION.EYELID, smooth: true },
    ...buildSkullCircuits(),
  ]

  return paths.map((p) => ({
    ...p,
    // Anatomia recebe curva; circuito recebe apenas adensamento linear.
    pts: p.smooth ? resamplePath(p.pts, p.closed, 4) : densifyPath(p.pts, 5),
  }))
}

/** Subdivide segmentos retos sem curvá-los. */
function densifyPath(pts: Array<[number, number]>, perSegment: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * Trilhas de circuito sobre o crânio.
 *
 * Duas regras dão a leitura de placa de circuito: os trechos correm apenas em
 * u ou apenas em v, alternando — nunca na diagonal —, e a calota é o único
 * território permitido, então o rosto continua limpo. Somam-se a uma coluna de
 * luz descendo o plano sagital, que é o eixo da referência.
 */
function buildSkullCircuits(): ContourPath[] {
  const paths: ContourPath[] = []
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

  for (let i = 0; i < 16; i++) {
    // Distribui em torno da cabeça, evitando o plano sagital que a coluna ocupa.
    const side = i % 2 === 0 ? 1 : -1
    let u = side * (0.16 + hash2(i, 3) * 1.5)
    let v = 0.05 + hash2(i, 7) * 0.2
    const pts: Array<[number, number]> = [[u, v]]

    const legs = 3 + Math.floor(hash2(i, 11) * 4)
    for (let l = 0; l < legs; l++) {
      if (l % 2 === 0) {
        u += (hash2(i, l + 20) - 0.5) * 0.7
      } else {
        v = clamp(v + (hash2(i, l + 40) - 0.5) * 0.13, 0.035, 0.3)
      }
      pts.push([u, v])
    }

    paths.push({ pts, closed: false, region: REGION.CIRCUIT, smooth: false })
  }

  // Coluna de luz no plano sagital: do alto do crânio à raiz do nariz.
  paths.push({
    pts: [
      [0, 0.035],
      [0, 0.14],
      [0, 0.24],
      [0, 0.31],
      [0, 0.355],
    ],
    closed: false,
    region: REGION.CIRCUIT,
    smooth: false,
  })

  return paths
}

interface Patch {
  points: PatchPoint[]
  rings: Ring[]
}


/**
 * Retalho do olho amostrado em ANÉIS ISOTRÓPICOS.
 *
 * A abertura palpebral é ~2.8× mais larga que alta, então uma grade polar
 * comum distribui os pontos por raio da abertura — e as circunferências do
 * shader, que vivem no raio isotrópico, caem entre as amostras nos lados do
 * olho e desaparecem. Amostrando direto em espaço isotrópico, cada anel é uma
 * circunferência exata no mundo e os pontos caem sempre sobre ela.
 */
function eyePatch(anchor: PatchAnchor, rings: number, isoMax: number): Patch {
  const points: PatchPoint[] = []
  const ringSpans: Ring[] = []
  const dIso = isoMax / rings

  for (let ri = 0; ri < rings; ri++) {
    const rIso = (ri + 0.5) * dIso
    const spokes = Math.max(12, Math.round((TWO_PI * rIso) / dIso))
    const phase = (ri % 2) * 0.5
    ringSpans.push({ start: points.length, count: 0 })

    for (let si = 0; si < spokes; si++) {
      const a = (si + phase) / spokes
      const phi = a * TWO_PI
      // Volta do espaço isotrópico para o da abertura.
      const px = (rIso * Math.cos(phi)) / EYE_ASPECT
      const py = rIso * Math.sin(phi)
      // Fora da fenda palpebral o ponto não existe.
      if (Math.hypot(px, py) > 1.12) continue

      points.push({
        u: anchor.u + px * anchor.su,
        v: anchor.v + py * anchor.sv,
        r: Math.hypot(px, py),
        a,
        detail: rIso,
      })
    }
  }

  return { points, rings: ringSpans }
}

/**
 * Território reservado ao olho, com folga sobre o retalho.
 *
 * Vale tanto para os pontos da grade quanto para as arestas: nada estrutural
 * sobrevive aqui dentro.
 */
function insideEyeAperture(u: number, v: number): boolean {
  const du = (Math.abs(u) - EYE_PATCH.u) / (EYE_PATCH.su * 1.16)
  const dv = (v - EYE_PATCH.v) / (EYE_PATCH.sv * 1.35)
  return du * du + dv * dv < 1
}

function classifyEye(p: PatchPoint): number {
  if (p.detail < 0.42) return REGION.PUPIL
  if (p.detail < 1.34) return REGION.IRIS
  return REGION.SCLERA
}


// ---------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------

export function buildHeadData(): HeadData {
  const gridCount = NU * NV

  // Anéis isotrópicos: a densidade acompanha as circunferências que o shader
  // desenha, senão elas caem entre as amostras.
  const eyeLeft = eyePatch(EYE_PATCH, 20, 1.4)
  const eyeRight = eyePatch({ ...EYE_PATCH, u: -EYE_PATCH.u }, 20, 1.4)
  const patches = [eyeLeft, eyeRight]
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
  const blockedByEye = new Uint8Array(gridCount)
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
      glow[k] = featureGlow(u, v)
      seed[k] = hash2(i + 7, j + 13)

      // A malha estrutural não entra no olho. Ela cruzava a abertura por cima
      // dos anéis, e nenhuma quantidade de brilho no retalho resolve isso — a
      // grade tinha de sair do caminho.
      blockedByEye[k] = insideEyeAperture(u, v) ? 1 : 0
      fade[k] = blockedByEye[k] ? 0 : fadeWeight(v)
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

  // Sem contorno traçado: quem desenha os anéis é o shader, e os laços do
  // retalho ficariam recortados pelo corte da fenda palpebral.
  const noRings = () => false
  writePatch(eyeLeft, classifyEye, 0.9, noRings)
  writePatch(eyeRight, classifyEye, 0.9, noRings)

  // — Partículas soltas ————————————————————————————————————
  // Pontos flutuando ao redor da cabeça, sem nenhuma linha ligando-os a ela.
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
    const n = path.pts.length
    for (let s = 0; s < n; s++) {
      const [u, v] = path.pts[s]
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

      region[k] = path.region
      jaw[k] = jawWeight(u, v)
      fade[k] = fadeWeight(v)
      glow[k] = 1
      area[k] = 0.8
      seed[k] = 0.5
      // detail > 0 marca como retalho: ponto menor, sem cintilação de nó.
      // Nos circuitos ele carrega a posição ao longo da trilha, para o pulso
      // de dado saber por onde viajar.
      detail[k] = path.region === REGION.CIRCUIT ? s / Math.max(1, n - 1) : 0.5
    }

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
    lineIndices: buildLattice(contourRings, contourEdges, blockedByEye),
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
 * referências. As partículas soltas ficam desconectadas — sem linhas ligando-as
 * à cabeça.
 */
function buildLattice(
  contourRings: Ring[],
  contourEdges: number[],
  blockedByEye: Uint8Array,
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

      // Basta uma ponta dentro do olho para a aresta ser descartada.
      if (blockedByEye[here]) continue

      // Malha completa, sem descarte aleatório: com a grade fina, arestas
      // faltando leriam como buracos na superfície, e não como estilo.
      if (!blockedByEye[right]) idx.push(here, right)
      if (!blockedByEye[below]) idx.push(here, below)
      if (!blockedByEye[diag]) idx.push(here, diag)
    }
  }

  return Uint32Array.from(idx)
}
