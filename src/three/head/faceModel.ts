/**
 * Modelo paramétrico do rosto do ALAN.
 *
 * Substitui a abordagem anterior (SDF + ray-march a partir do centro do crânio),
 * que tinha uma falha estrutural: o marcher para no PRIMEIRO cruzamento de
 * superfície, então qualquer concavidade — órbita ocular, fenda da boca, narina,
 * concha da orelha — ou some, ou pior: uma subtração funda desconecta o globo
 * ocular do rosto e o cria como casca solta que nenhum raio alcança. Foi
 * exatamente isso que deixou os olhos como crateras vazias.
 *
 * Aqui a superfície é uma carta paramétrica (u, v) → R³, então TODO ponto do
 * domínio produz exatamente um ponto da superfície. Concavidades são apenas
 * deslocamento negativo: não existe topologia para quebrar.
 *
 *   P(u, v) = B(u, v) + [ Σₖ aₖ · exp(−½ · dₖᵀ Σₖ⁻¹ dₖ) ] · n̂(u, v)
 *
 *   B  superfície-base: seções transversais superelípticas empilhadas ao longo
 *      de um perfil interpolado por Catmull-Rom
 *   Σₖ⁻¹ inversa da covariância de cada feature — uma forma quadrática 2×2 que
 *      dá anisotropia e rotação à influência (álgebra linear)
 *   aₖ amplitude com sinal: positiva incha, negativa escava
 *
 * As features formam um GRAFO: cada nó pode pendurar-se num pai por
 * deslocamento relativo, e nós espelhados geram o par bilateral sozinhos. Mover
 * `noseBridge` arrasta dorso, ponta, asas e narinas de forma coerente — é isso
 * que torna a geração do personagem tratável.
 *
 * Convenção: u ∈ [−π, π) contorna a cabeça, u = 0 é o plano sagital de frente
 * (+Z). v ∈ (0, 1) desce do alto do crânio à base do pescoço.
 */

// ---------------------------------------------------------------------------
// Regiões — compartilhadas com o shader
// ---------------------------------------------------------------------------

export const REGION = {
  SKIN: 0,
  SCLERA: 1,
  LIPS: 2,
  HAIR: 3,
  IRIS: 4,
  PUPIL: 5,
  MOUTH_LINE: 6,
  BROW: 7,
  NOSTRIL: 8,
  EYELID: 9,
} as const

/**
 * Âncoras dos retalhos de detalhe. Olhos e boca ocupam uma fração ínfima do
 * domínio (a elipse do olho é ~0,1% da área total), então uma grade uniforme
 * lhes daria algumas dezenas de pontos. Estes centros são reamostrados à parte,
 * em coordenadas polares locais.
 */
export const EYE_PATCH = { u: 0.44, v: 0.353, su: 0.19, sv: 0.0155 } as const

/**
 * Quanto a fenda palpebral é mais larga que alta, já em unidades de mundo.
 *
 * su e sv vivem em espaços diferentes — radianos ao redor da cabeça e altura do
 * perfil — e por acaso davam quase o mesmo comprimento, o que produzia olhos
 * perfeitamente circulares. A íris precisa deste fator para voltar a ser um
 * círculo dentro de uma abertura amendoada.
 */
export const EYE_ASPECT = 2.8
export const MOUTH_PATCH = { u: 0, v: 0.508, su: 0.32, sv: 0.032 } as const

// ---------------------------------------------------------------------------
// Perfil: seções transversais empilhadas
// ---------------------------------------------------------------------------

interface ProfileKey {
  v: number
  /** altura da seção */
  y: number
  /** semi-largura (eixo X) */
  a: number
  /** semi-profundidade à frente do eixo da seção */
  bFront: number
  /** semi-profundidade atrás — a nuca é mais funda que o rosto */
  bBack: number
  /** deslocamento do centro da seção em Z */
  cz: number
}

const PROFILE: ProfileKey[] = [
  // Larguras derivadas de medidas antropométricas, normalizadas pela altura
  // vértice→mento (H = 0.938 aqui):
  //   largura máxima (parietal) 15.5/23 = 0.674 H  → meia-largura 0.316
  //   bizigomática              13.7/23 = 0.596 H  → 0.280
  //   bigonial (mandíbula)      10.5/23 = 0.457 H  → 0.214
  //   mento                      4.5/23 = 0.196 H  → 0.092
  // A versão anterior estava em 0.80 H de largura — 19% acima do cânone, o que
  // dava uma cabeça larga demais. y(v) desce com inclinação quase constante
  // para as linhas não se amontoarem em nenhuma faixa.
  { v: 0.0, y: 0.5, a: 0.01, bFront: 0.01, bBack: 0.01, cz: -0.03 },
  { v: 0.03, y: 0.458, a: 0.15, bFront: 0.16, bBack: 0.18, cz: -0.03 },
  { v: 0.08, y: 0.388, a: 0.238, bFront: 0.25, bBack: 0.29, cz: -0.03 },
  { v: 0.15, y: 0.29, a: 0.29, bFront: 0.298, bBack: 0.352, cz: -0.03 },
  { v: 0.22, y: 0.192, a: 0.31, bFront: 0.32, bBack: 0.382, cz: -0.025 },
  { v: 0.28, y: 0.108, a: 0.316, bFront: 0.332, bBack: 0.395, cz: -0.018 }, // parietal
  { v: 0.35, y: 0.01, a: 0.312, bFront: 0.338, bBack: 0.392, cz: -0.008 }, // olhos
  { v: 0.42, y: -0.088, a: 0.292, bFront: 0.338, bBack: 0.378, cz: 0.0 }, // zigomático
  { v: 0.48, y: -0.172, a: 0.268, bFront: 0.328, bBack: 0.355, cz: 0.0 },
  { v: 0.55, y: -0.27, a: 0.238, bFront: 0.308, bBack: 0.325, cz: -0.005 },
  { v: 0.62, y: -0.368, a: 0.196, bFront: 0.275, bBack: 0.282, cz: -0.015 }, // bigonial
  { v: 0.67, y: -0.438, a: 0.118, bFront: 0.23, bBack: 0.23, cz: -0.028 }, // mento
  { v: 0.72, y: -0.5, a: 0.132, bFront: 0.172, bBack: 0.188, cz: -0.045 },
  // O pescoço abre em trapézio e ombros: terminar num tubo cilíndrico era o que
  // fazia a silhueta inteira ler como lâmpada.
  { v: 0.82, y: -0.615, a: 0.15, bFront: 0.178, bBack: 0.198, cz: -0.055 },
  { v: 0.91, y: -0.72, a: 0.21, bFront: 0.198, bBack: 0.228, cz: -0.06 },
  { v: 1.0, y: -0.84, a: 0.33, bFront: 0.228, bBack: 0.262, cz: -0.06 },
]

/** Expoente da superelipse: 2 seria uma elipse pura e deixaria a cabeça ovoide. */
const SUPERELLIPSE_N = 2.3

export interface Profile {
  y: number
  a: number
  bFront: number
  bBack: number
  cz: number
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/**
 * Perfil interpolado. Catmull-Rom em vez de linear: interpolação linear deixaria
 * a derivada descontínua nos nós e as normais mostrariam anéis nítidos.
 */
export function evalProfile(v: number, out: Profile): Profile {
  const n = PROFILE.length
  let i = 1
  while (i < n - 2 && PROFILE[i + 1].v < v) i++

  const k0 = PROFILE[Math.max(0, i - 1)]
  const k1 = PROFILE[i]
  const k2 = PROFILE[Math.min(n - 1, i + 1)]
  const k3 = PROFILE[Math.min(n - 1, i + 2)]

  const span = k2.v - k1.v
  const t = span > 1e-6 ? Math.min(1, Math.max(0, (v - k1.v) / span)) : 0

  out.y = catmullRom(k0.y, k1.y, k2.y, k3.y, t)
  out.a = Math.max(1e-4, catmullRom(k0.a, k1.a, k2.a, k3.a, t))
  out.bFront = Math.max(1e-4, catmullRom(k0.bFront, k1.bFront, k2.bFront, k3.bFront, t))
  out.bBack = Math.max(1e-4, catmullRom(k0.bBack, k1.bBack, k2.bBack, k3.bBack, t))
  out.cz = catmullRom(k0.cz, k1.cz, k2.cz, k3.cz, t)
  return out
}

export function makeProfile(): Profile {
  return { y: 0, a: 0, bFront: 0, bBack: 0, cz: 0 }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Ponto da superfície-base, sem features. A seção é uma superelipse resolvida em
 * forma polar, com profundidade frontal e traseira misturadas suavemente.
 */
export function basePoint(u: number, prof: Profile, out: Float32Array, offset: number) {
  const dx = Math.sin(u)
  const dz = Math.cos(u)

  const b = prof.bBack + (prof.bFront - prof.bBack) * smoothstep(-0.35, 0.35, dz)
  const n = SUPERELLIPSE_N
  const r =
    1 / Math.pow(Math.pow(Math.abs(dx) / prof.a, n) + Math.pow(Math.abs(dz) / b, n), 1 / n)

  out[offset] = r * dx
  out[offset + 1] = prof.y
  out[offset + 2] = prof.cz + r * dz
}

// ---------------------------------------------------------------------------
// Grafo de features
// ---------------------------------------------------------------------------

interface FeatureNode {
  id: string
  /** Se presente, (u, v) são deslocamentos relativos a este nó. */
  parent?: string
  u: number
  v: number
  /** Desvios ao longo dos eixos principais da influência. */
  su: number
  sv: number
  /** Rotação dos eixos principais, em radianos. */
  theta?: number
  /** Amplitude ao longo da normal: positiva incha, negativa escava. */
  amp: number
  /** Gera automaticamente o par espelhado em −u. */
  mirror?: boolean
}

const FEATURES: FeatureNode[] = [
  // — Olhos ————————————————————————————————————————————————
  { id: 'eye', u: 0.44, v: 0.352, su: 0.115, sv: 0.022, amp: 0.03, mirror: true },
  { id: 'eyeSocket', parent: 'eye', u: 0, v: 0, su: 0.2, sv: 0.032, amp: -0.02, mirror: true },
  { id: 'lidUpper', parent: 'eye', u: 0, v: -0.019, su: 0.135, sv: 0.011, amp: 0.011, mirror: true },
  { id: 'lidLower', parent: 'eye', u: 0, v: 0.02, su: 0.135, sv: 0.01, amp: 0.008, mirror: true },
  { id: 'brow', parent: 'eye', u: 0.005, v: -0.035, su: 0.21, sv: 0.028, theta: 0.12, amp: 0.024, mirror: true },
  { id: 'glabella', u: 0, v: 0.32, su: 0.16, sv: 0.026, amp: 0.011 },

  // — Nariz ————————————————————————————————————————————————
  { id: 'noseBridge', u: 0, v: 0.36, su: 0.078, sv: 0.055, amp: 0.03 },
  { id: 'noseDorsum', parent: 'noseBridge', u: 0, v: 0.042, su: 0.068, sv: 0.04, amp: 0.06 },
  { id: 'noseTip', parent: 'noseBridge', u: 0, v: 0.076, su: 0.074, sv: 0.024, amp: 0.098 },
  { id: 'noseWing', parent: 'noseTip', u: 0.12, v: 0.01, su: 0.055, sv: 0.019, amp: 0.05, mirror: true },
  { id: 'nostril', parent: 'noseTip', u: 0.08, v: 0.02, su: 0.028, sv: 0.01, amp: -0.038, mirror: true },
  { id: 'noseBase', parent: 'noseTip', u: 0, v: 0.03, su: 0.095, sv: 0.012, amp: -0.024 },

  // — Boca —————————————————————————————————————————————————
  // Larguras acompanham a boca da referência: ~26% da largura do rosto.
  { id: 'philtrum', u: 0, v: 0.478, su: 0.034, sv: 0.014, amp: -0.012 },
  { id: 'lipUpper', u: 0, v: 0.497, su: 0.24, sv: 0.014, amp: 0.026 },
  { id: 'cupid', parent: 'lipUpper', u: 0.055, v: -0.004, su: 0.05, sv: 0.01, amp: 0.012, mirror: true },
  { id: 'mouthLine', parent: 'lipUpper', u: 0, v: 0.011, su: 0.27, sv: 0.006, amp: -0.022 },
  { id: 'lipLower', parent: 'lipUpper', u: 0, v: 0.025, su: 0.22, sv: 0.017, amp: 0.03 },
  { id: 'mouthCorner', parent: 'lipUpper', u: 0.3, v: 0.01, su: 0.06, sv: 0.014, amp: -0.013, mirror: true },
  { id: 'mentolabial', parent: 'lipUpper', u: 0, v: 0.051, su: 0.16, sv: 0.016, amp: -0.019 },
  { id: 'chin', u: 0, v: 0.585, su: 0.17, sv: 0.035, amp: 0.034 },

  // — Estrutura ————————————————————————————————————————————
  { id: 'cheekbone', u: 0.66, v: 0.395, su: 0.24, sv: 0.045, theta: -0.2, amp: 0.026, mirror: true },
  { id: 'cheekHollow', u: 0.55, v: 0.47, su: 0.17, sv: 0.045, amp: -0.017, mirror: true },
  { id: 'nasolabial', u: 0.26, v: 0.487, su: 0.06, sv: 0.035, theta: 0.3, amp: -0.014, mirror: true },
  { id: 'temple', u: 0.8, v: 0.255, su: 0.2, sv: 0.055, amp: -0.016, mirror: true },

  // — Linha da mandíbula ———————————————————————————————————
  // A referência tem uma aresta contínua da orelha ao queixo. Uma gaussiana só
  // não a percorre, então três nós cobrem o ramo, o corpo e o ângulo.
  { id: 'jawAngle', u: 1.0, v: 0.6, su: 0.24, sv: 0.04, amp: 0.022, mirror: true },
  { id: 'jawRamus', u: 0.66, v: 0.622, su: 0.24, sv: 0.032, theta: 0.18, amp: 0.02, mirror: true },
  { id: 'jawBody', u: 0.32, v: 0.638, su: 0.22, sv: 0.03, amp: 0.017, mirror: true },
  // Sombra sob o maxilar: sem ela a mandíbula não descola do pescoço.
  { id: 'subMandible', u: 0.6, v: 0.678, su: 0.34, sv: 0.032, amp: -0.022, mirror: true },

  // — Orelhas ——————————————————————————————————————————————
  { id: 'ear', u: 1.52, v: 0.375, su: 0.12, sv: 0.065, amp: 0.078, mirror: true },
  { id: 'earInner', parent: 'ear', u: 0.032, v: 0, su: 0.055, sv: 0.034, amp: -0.045, mirror: true },
  { id: 'earLobe', parent: 'ear', u: 0.0, v: 0.062, su: 0.075, sv: 0.022, amp: 0.042, mirror: true },

  // — Cabelo ———————————————————————————————————————————————
  // su enorme = influência independente de u, uma calota em torno de toda a cabeça.
  { id: 'hairTop', u: 0, v: 0.1, su: 10, sv: 0.1, amp: 0.026 },
  { id: 'hairBack', u: Math.PI, v: 0.3, su: 0.55, sv: 0.11, amp: 0.014 },
  { id: 'hairline', u: 0, v: 0.285, su: 0.55, sv: 0.05, amp: -0.022 },
]

/** Gaussiana resolvida: posição absoluta + forma quadrática Σ⁻¹ pré-computada. */
interface Gaussian {
  u: number
  v: number
  amp: number
  /** Σ⁻¹ = [[qa, qb], [qb, qc]] */
  qa: number
  qb: number
  qc: number
}

const TWO_PI = Math.PI * 2

/** Menor diferença angular, respeitando o fecho do domínio em u. */
function wrapAngle(d: number): number {
  let x = d
  while (x > Math.PI) x -= TWO_PI
  while (x < -Math.PI) x += TWO_PI
  return x
}

/**
 * Resolve o grafo: acumula deslocamentos pai→filho, expande os espelhos e
 * pré-computa a inversa da covariância de cada nó.
 *
 *   Σ⁻¹ = R · diag(1/σu², 1/σv²) · Rᵀ
 */
function resolveFeatures(): Gaussian[] {
  const byId = new Map(FEATURES.map((f) => [f.id, f]))
  const absolute = new Map<string, { u: number; v: number }>()

  const resolve = (node: FeatureNode, seen: Set<string>): { u: number; v: number } => {
    const cached = absolute.get(node.id)
    if (cached) return cached
    if (seen.has(node.id)) throw new Error(`Ciclo no grafo de features em "${node.id}"`)
    seen.add(node.id)

    let pos = { u: node.u, v: node.v }
    if (node.parent) {
      const parent = byId.get(node.parent)
      if (!parent) throw new Error(`Feature "${node.id}" referencia pai inexistente "${node.parent}"`)
      const base = resolve(parent, seen)
      pos = { u: base.u + node.u, v: base.v + node.v }
    }
    absolute.set(node.id, pos)
    return pos
  }

  const out: Gaussian[] = []

  for (const node of FEATURES) {
    const pos = resolve(node, new Set())
    const theta = node.theta ?? 0
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    const iu = 1 / (node.su * node.su)
    const iv = 1 / (node.sv * node.sv)

    const qa = c * c * iu + s * s * iv
    const qb = c * s * (iu - iv)
    const qc = s * s * iu + c * c * iv

    out.push({ u: pos.u, v: pos.v, amp: node.amp, qa, qb, qc })
    if (node.mirror) {
      // O espelho reflete em u e inverte o termo cruzado junto com o eixo.
      out.push({ u: -pos.u, v: pos.v, amp: node.amp, qa, qb: -qb, qc })
    }
  }

  return out
}

const GAUSSIANS = resolveFeatures()

/** Deslocamento total ao longo da normal, no ponto (u, v). */
export function featureDisplacement(u: number, v: number): number {
  let sum = 0
  for (let i = 0; i < GAUSSIANS.length; i++) {
    const g = GAUSSIANS[i]
    const du = wrapAngle(u - g.u)
    const dv = v - g.v
    const m = g.qa * du * du + 2 * g.qb * du * dv + g.qc * dv * dv
    // exp() domina o custo; abaixo de ~4.6 sigmas a contribuição é < 1e-5.
    if (m < 42) sum += g.amp * Math.exp(-0.5 * m)
  }
  return sum
}

// ---------------------------------------------------------------------------
// Regiões — elipses no mesmo domínio (u, v)
// ---------------------------------------------------------------------------

/** Distância de Mahalanobis ao quadrado, eixos alinhados. */
function ellipse(du: number, dv: number, su: number, sv: number): number {
  const a = du / su
  const b = dv / sv
  return a * a + b * b
}

/** Linha do cabelo: desce da testa para as têmporas e mergulha na nuca. */
function hairlineV(au: number): number {
  if (au < 0.9) return 0.248 + (au / 0.9) * 0.048
  if (au < 1.6) return 0.296 + ((au - 0.9) / 0.7) * 0.098
  return 0.394 + ((Math.min(au, Math.PI) - 1.6) / (Math.PI - 1.6)) * 0.13
}

/**
 * Classifica um ponto do domínio.
 *
 * Fazer isso em (u, v) — e não por distância 3D a um centro anatômico — é o que
 * permite pupila, íris e esclera concêntricas: elas são apenas três limiares do
 * mesmo raio elíptico.
 */
export function classifyRegion(u: number, v: number): number {
  const au = Math.abs(u)

  const eyeM = ellipse(au - 0.44, v - 0.353, 0.105, 0.019)
  if (eyeM < 1) {
    const r = Math.sqrt(eyeM)
    if (r < 0.4) return REGION.PUPIL
    if (r < 0.72) return REGION.IRIS
    return REGION.SCLERA
  }

  if (ellipse(au - 0.44, v - 0.315, 0.21, 0.019) < 1) return REGION.BROW
  if (ellipse(au - 0.076, v - 0.456, 0.028, 0.011) < 1) return REGION.NOSTRIL

  if (ellipse(u, v - 0.508, 0.32, 0.032) < 1) {
    return Math.abs(v - 0.508) < 0.0045 ? REGION.MOUTH_LINE : REGION.LIPS
  }

  // A orelha cai dentro da linha do cabelo; precisa sair antes do teste.
  if (ellipse(au - 1.52, v - 0.375, 0.14, 0.065) < 1) return REGION.SKIN

  return v < hairlineV(au) ? REGION.HAIR : REGION.SKIN
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

/**
 * Concentração de luz por região do rosto.
 *
 * Nas referências low-poly o crânio é quase invisível e o brilho se acumula em
 * sobrancelhas, olhos, nariz e boca. Este campo é o que reproduz essa
 * hierarquia: soma de gaussianas nos pontos que devem acender.
 */
// Os sigmas acompanham de perto a extensão real de cada feição. Antes eram
// ~3× maiores, e o halo resultante acendia bochecha e testa junto — era esse
// entorno, não as feições, que dominava o rosto.
const GLOW_SOURCES: Array<[u: number, v: number, su: number, sv: number, w: number]> = [
  [0.44, 0.315, 0.2, 0.016, 1.0], // sobrancelhas
  [0.44, 0.353, 0.15, 0.014, 0.95], // olhos
  [0.0, 0.375, 0.06, 0.03, 0.55], // raiz do nariz
  [0.0, 0.436, 0.07, 0.02, 0.9], // ponta do nariz
  [0.09, 0.456, 0.045, 0.013, 0.85], // narinas
  [0.0, 0.508, 0.24, 0.016, 0.9], // boca
  [0.0, 0.6, 0.15, 0.025, 0.3], // queixo
  [1.52, 0.375, 0.12, 0.05, 0.45], // orelhas
  [0.75, 0.62, 0.24, 0.022, 0.28], // mandíbula
]

export function featureGlow(u: number, v: number): number {
  const au = Math.abs(u)
  let sum = 0
  for (const [gu, gv, su, sv, w] of GLOW_SOURCES) {
    // Fontes fora do plano sagital são bilaterais por construção.
    const du = gu === 0 ? u : au - gu
    const dv = v - gv
    const m = (du / su) * (du / su) + (dv / sv) * (dv / sv)
    if (m < 24) sum += w * Math.exp(-0.5 * m)
  }
  return Math.min(1, sum)
}

/** Peso de participação na rotação da mandíbula. */
export function jawWeight(u: number, v: number): number {
  return (
    smoothstep(0.44, 0.62, v) *
    (1 - smoothstep(0.7, 0.8, v)) *
    smoothstep(1.95, 1.25, Math.abs(u))
  )
}

/**
 * Opacidade base. O busto dissolve cedo na luz do pedestal: mantido opaco até
 * embaixo, o encontro do pescoço com os ombros virava a região mais densa e
 * brilhante da cena e roubava a atenção do rosto.
 */
export function fadeWeight(v: number): number {
  return 1 - smoothstep(0.72, 0.94, v)
}

// ---------------------------------------------------------------------------
// Avaliação avulsa da superfície
// ---------------------------------------------------------------------------

const H = 1e-3
const profA = makeProfile()
const profB = makeProfile()
const tmp = {
  p: new Float32Array(3),
  uPrev: new Float32Array(3),
  uNext: new Float32Array(3),
  vPrev: new Float32Array(3),
  vNext: new Float32Array(3),
}

/**
 * P(u, v) num ponto arbitrário do domínio, fora da grade principal.
 *
 * A grade tira as normais dos vizinhos de graça; os retalhos polares não têm
 * essa vizinhança, então aqui a normal-base sai de diferenças centrais
 * calculadas na hora.
 */
export function evalSurface(u: number, v: number, out: Float32Array, offset: number) {
  evalProfile(v, profA)
  basePoint(u, profA, tmp.p, 0)
  basePoint(u - H, profA, tmp.uPrev, 0)
  basePoint(u + H, profA, tmp.uNext, 0)
  basePoint(u, evalProfile(v - H, profB), tmp.vPrev, 0)
  basePoint(u, evalProfile(v + H, profB), tmp.vNext, 0)

  const ux = tmp.uNext[0] - tmp.uPrev[0]
  const uy = tmp.uNext[1] - tmp.uPrev[1]
  const uz = tmp.uNext[2] - tmp.uPrev[2]
  const vx = tmp.vNext[0] - tmp.vPrev[0]
  const vy = tmp.vNext[1] - tmp.vPrev[1]
  const vz = tmp.vNext[2] - tmp.vPrev[2]

  let nx = vy * uz - vz * uy
  let ny = vz * ux - vx * uz
  let nz = vx * uy - vy * ux
  const len = Math.hypot(nx, ny, nz) || 1
  nx /= len
  ny /= len
  nz /= len

  const d = featureDisplacement(u, v)
  out[offset] = tmp.p[0] + nx * d
  out[offset + 1] = tmp.p[1] + ny * d
  out[offset + 2] = tmp.p[2] + nz * d
}
