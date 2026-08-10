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
} as const

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
  { v: 0.0, y: 0.5, a: 0.01, bFront: 0.01, bBack: 0.01, cz: -0.03 },
  { v: 0.05, y: 0.435, a: 0.15, bFront: 0.155, bBack: 0.17, cz: -0.03 },
  { v: 0.12, y: 0.335, a: 0.245, bFront: 0.25, bBack: 0.29, cz: -0.03 },
  { v: 0.2, y: 0.225, a: 0.295, bFront: 0.29, bBack: 0.34, cz: -0.025 },
  { v: 0.28, y: 0.11, a: 0.31, bFront: 0.305, bBack: 0.355, cz: -0.015 },
  { v: 0.35, y: 0.008, a: 0.308, bFront: 0.31, bBack: 0.35, cz: -0.005 }, // olhos
  { v: 0.42, y: -0.095, a: 0.295, bFront: 0.31, bBack: 0.335, cz: 0.0 },
  { v: 0.48, y: -0.185, a: 0.272, bFront: 0.3, bBack: 0.315, cz: 0.0 },
  { v: 0.55, y: -0.29, a: 0.235, bFront: 0.285, bBack: 0.29, cz: -0.005 },
  { v: 0.62, y: -0.4, a: 0.18, bFront: 0.255, bBack: 0.25, cz: -0.015 }, // queixo
  { v: 0.67, y: -0.47, a: 0.14, bFront: 0.2, bBack: 0.205, cz: -0.03 },
  { v: 0.72, y: -0.545, a: 0.125, bFront: 0.15, bBack: 0.165, cz: -0.045 },
  { v: 0.8, y: -0.66, a: 0.12, bFront: 0.13, bBack: 0.145, cz: -0.055 },
  { v: 1.0, y: -0.95, a: 0.128, bFront: 0.135, bBack: 0.15, cz: -0.06 },
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
  { id: 'brow', parent: 'eye', u: 0.005, v: -0.035, su: 0.2, sv: 0.026, theta: 0.12, amp: 0.018, mirror: true },
  { id: 'glabella', u: 0, v: 0.32, su: 0.16, sv: 0.026, amp: 0.009 },

  // — Nariz ————————————————————————————————————————————————
  { id: 'noseBridge', u: 0, v: 0.36, su: 0.075, sv: 0.055, amp: 0.026 },
  { id: 'noseDorsum', parent: 'noseBridge', u: 0, v: 0.042, su: 0.065, sv: 0.04, amp: 0.044 },
  { id: 'noseTip', parent: 'noseBridge', u: 0, v: 0.076, su: 0.07, sv: 0.024, amp: 0.07 },
  { id: 'noseWing', parent: 'noseTip', u: 0.115, v: 0.01, su: 0.052, sv: 0.019, amp: 0.042, mirror: true },
  { id: 'nostril', parent: 'noseTip', u: 0.076, v: 0.02, su: 0.026, sv: 0.01, amp: -0.032, mirror: true },
  { id: 'noseBase', parent: 'noseTip', u: 0, v: 0.03, su: 0.09, sv: 0.012, amp: -0.02 },

  // — Boca —————————————————————————————————————————————————
  { id: 'philtrum', u: 0, v: 0.478, su: 0.03, sv: 0.014, amp: -0.01 },
  { id: 'lipUpper', u: 0, v: 0.497, su: 0.155, sv: 0.014, amp: 0.022 },
  { id: 'cupid', parent: 'lipUpper', u: 0.048, v: -0.004, su: 0.045, sv: 0.01, amp: 0.01, mirror: true },
  { id: 'mouthLine', parent: 'lipUpper', u: 0, v: 0.011, su: 0.175, sv: 0.006, amp: -0.019 },
  { id: 'lipLower', parent: 'lipUpper', u: 0, v: 0.025, su: 0.145, sv: 0.017, amp: 0.026 },
  { id: 'mouthCorner', parent: 'lipUpper', u: 0.2, v: 0.01, su: 0.05, sv: 0.014, amp: -0.011, mirror: true },
  { id: 'mentolabial', parent: 'lipUpper', u: 0, v: 0.051, su: 0.13, sv: 0.016, amp: -0.016 },
  { id: 'chin', u: 0, v: 0.585, su: 0.14, sv: 0.035, amp: 0.028 },

  // — Estrutura ————————————————————————————————————————————
  { id: 'cheekbone', u: 0.66, v: 0.395, su: 0.22, sv: 0.045, theta: -0.2, amp: 0.02, mirror: true },
  { id: 'cheekHollow', u: 0.55, v: 0.47, su: 0.16, sv: 0.045, amp: -0.014, mirror: true },
  { id: 'nasolabial', u: 0.24, v: 0.487, su: 0.055, sv: 0.035, theta: 0.3, amp: -0.012, mirror: true },
  { id: 'jawAngle', u: 0.95, v: 0.575, su: 0.22, sv: 0.045, amp: 0.016, mirror: true },
  { id: 'temple', u: 0.8, v: 0.255, su: 0.2, sv: 0.055, amp: -0.014, mirror: true },

  // — Orelhas ——————————————————————————————————————————————
  { id: 'ear', u: 1.52, v: 0.375, su: 0.11, sv: 0.055, amp: 0.055, mirror: true },
  { id: 'earInner', parent: 'ear', u: 0.03, v: 0, su: 0.05, sv: 0.03, amp: -0.032, mirror: true },

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

  if (ellipse(au - 0.44, v - 0.318, 0.2, 0.013) < 1) return REGION.BROW
  if (ellipse(au - 0.076, v - 0.456, 0.028, 0.011) < 1) return REGION.NOSTRIL

  if (ellipse(u, v - 0.508, 0.19, 0.03) < 1) {
    return Math.abs(v - 0.508) < 0.0045 ? REGION.MOUTH_LINE : REGION.LIPS
  }

  // A orelha cai dentro da linha do cabelo; precisa sair antes do teste.
  if (ellipse(au - 1.52, v - 0.375, 0.14, 0.065) < 1) return REGION.SKIN

  return v < hairlineV(au) ? REGION.HAIR : REGION.SKIN
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

/** Peso de participação na rotação da mandíbula. */
export function jawWeight(u: number, v: number): number {
  return (
    smoothstep(0.44, 0.62, v) *
    (1 - smoothstep(0.7, 0.8, v)) *
    smoothstep(1.95, 1.25, Math.abs(u))
  )
}

/** Opacidade base — dissolve o pescoço na luz do pedestal. */
export function fadeWeight(v: number): number {
  return 1 - smoothstep(0.72, 0.96, v)
}
