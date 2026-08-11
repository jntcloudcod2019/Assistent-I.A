import { useMemo, type CSSProperties } from 'react'
import clsx from 'clsx'

import { mulberry32 } from './rand'

/**
 * Anéis holográficos rotativos.
 *
 * A armadilha óbvia aqui seria três `<circle>` com `transform: rotate()`: anéis
 * perfeitamente simétricos giram sem que se perceba movimento algum. Por isso
 * cada anel é montado com assimetria deliberada — arcos de comprimentos
 * irregulares, gaps, marcas radiais e marcadores acesos — e cada um roda com
 * velocidade e sentido próprios, para nunca lerem como um único objeto rígido.
 *
 * A geometria é sorteada por um PRNG semeado: o mesmo anel a cada render, sem
 * cintilar quando o React reconcilia.
 */

export interface HolographicRingsProps {
  /** Diâmetro do componente, em px. */
  size?: number
  /** Cor principal dos anéis. */
  color?: string
  /** Cor secundária — marcadores e feixes. */
  secondaryColor?: string
  /** Quantidade de anéis concêntricos. */
  ringCount?: number
  /** Multiplicador de velocidade. */
  speed?: number
  /** Intensidade do brilho, 0 a 2. */
  intensity?: number
  /** Exibe os feixes de luz verticais. */
  showBeams?: boolean
  /** Inclinação em graus; deita o anel no plano do chão. 0 = de frente. */
  tiltDeg?: number
  className?: string
  style?: CSSProperties
}

// ---------------------------------------------------------------------------
// Geração determinística
// ---------------------------------------------------------------------------

/** Cada anel adota um vocabulário visual diferente. */
type RingKind = 'segments' | 'ticks' | 'dots'
const KINDS: RingKind[] = ['segments', 'ticks', 'dots']

interface RingSpec {
  radius: number
  kind: RingKind
  strokeWidth: number
  opacity: number
  /** Segundos por volta. */
  duration: number
  reverse: boolean
  /** Padrão irregular de traço e vão. */
  dash: string
  /** Ângulos das marcas radiais, em graus. */
  ticks: number[]
  /** Ângulos dos marcadores acesos, em graus. */
  markers: number[]
}

/** Coordenadas num viewBox 200×200 centrado em (100, 100). */
const polar = (deg: number, radius: number): [number, number] => {
  const rad = (deg * Math.PI) / 180
  return [100 + Math.cos(rad) * radius, 100 + Math.sin(rad) * radius]
}

function buildRings(ringCount: number, speed: number): RingSpec[] {
  const rand = mulberry32(0x5eed)
  const specs: RingSpec[] = []

  // Do anel externo para o interno, com folga entre eles.
  const outer = 94
  const inner = 34
  const step = ringCount > 1 ? (outer - inner) / (ringCount - 1) : 0

  for (let i = 0; i < ringCount; i++) {
    const radius = outer - step * i
    const kind = KINDS[i % KINDS.length]

    // Traços de comprimentos desiguais: um dasharray uniforme voltaria a
    // parecer simétrico e mataria a percepção de giro.
    const dashPairs = 3 + Math.floor(rand() * 3)
    const dash: number[] = []
    for (let d = 0; d < dashPairs; d++) {
      dash.push(Math.round(12 + rand() * 60), Math.round(8 + rand() * 34))
    }

    const tickCount = kind === 'ticks' ? 26 + Math.floor(rand() * 18) : 6 + Math.floor(rand() * 8)
    const ticks: number[] = []
    for (let t = 0; t < tickCount; t++) {
      // Passo irregular em vez de distribuição uniforme.
      ticks.push((t * (360 / tickCount) + rand() * 7) % 360)
    }

    const markerCount = 1 + Math.floor(rand() * 3)
    const markers: number[] = []
    for (let m = 0; m < markerCount; m++) markers.push(rand() * 360)

    specs.push({
      radius,
      kind,
      strokeWidth: kind === 'segments' ? 1.6 + rand() * 1.4 : 0.9 + rand() * 0.7,
      opacity: 0.45 + rand() * 0.5,
      // Anéis mais externos giram mais devagar, como um mecanismo real.
      duration: (11 + i * 6 + rand() * 5) / Math.max(0.05, speed),
      reverse: i % 2 === 1,
      dash: dash.join(' '),
      ticks,
      markers,
    })
  }

  return specs
}

// ---------------------------------------------------------------------------
// Camadas
// ---------------------------------------------------------------------------

function RingLayer({
  spec,
  color,
  secondaryColor,
}: {
  spec: RingSpec
  color: string
  secondaryColor: string
}) {
  const tickInner = spec.kind === 'ticks' ? spec.radius - 5 : spec.radius - 3

  return (
    <g
      style={{
        transformBox: 'view-box',
        transformOrigin: '50% 50%',
        animation: `hud-spin ${spec.duration}s linear infinite`,
        animationDirection: spec.reverse ? 'reverse' : 'normal',
        opacity: spec.opacity,
      }}
    >
      {spec.kind !== 'dots' && (
        <circle
          cx={100}
          cy={100}
          r={spec.radius}
          fill="none"
          stroke={color}
          strokeWidth={spec.strokeWidth}
          strokeDasharray={spec.dash}
          strokeLinecap="round"
        />
      )}

      {spec.ticks.map((angle, i) => {
        const [x1, y1] = polar(angle, tickInner)
        const [x2, y2] = polar(angle, spec.radius)
        return spec.kind === 'dots' ? (
          <circle key={i} cx={x2} cy={y2} r={0.9} fill={color} />
        ) : (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={0.8}
            strokeLinecap="round"
          />
        )
      })}

      {spec.markers.map((angle, i) => {
        const [mx, my] = polar(angle, spec.radius)
        return (
          <g key={i}>
            <circle cx={mx} cy={my} r={2.1} fill={secondaryColor} />
            <path
              d={describeArc(spec.radius, angle - 7, angle + 7)}
              fill="none"
              stroke={secondaryColor}
              strokeWidth={spec.strokeWidth + 1.1}
              strokeLinecap="round"
            />
          </g>
        )
      })}
    </g>
  )
}

/** Arco curto entre dois ângulos, para os marcadores acesos. */
function describeArc(radius: number, startDeg: number, endDeg: number): string {
  const [sx, sy] = polar(startDeg, radius)
  const [ex, ey] = polar(endDeg, radius)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey}`
}

function BeamLayer({
  size,
  color,
  secondaryColor,
  intensity,
  speed,
}: {
  size: number
  color: string
  secondaryColor: string
  intensity: number
  speed: number
}) {
  // Posições e alturas irregulares; feixes idênticos leriam como um pente.
  const beams = useMemo(() => {
    const rand = mulberry32(0xbea3)
    return Array.from({ length: 7 }, (_, i) => ({
      // -1..1 relativo ao centro
      offset: (i / 6) * 2 - 1,
      height: 0.16 + rand() * 0.26,
      delay: rand() * 3,
      duration: (2.6 + rand() * 2.4) / Math.max(0.05, speed),
      width: 1.5 + rand() * 3.5,
    }))
  }, [speed])

  return (
    <div className="pointer-events-none absolute inset-0 flex items-end justify-center">
      {beams.map((beam, i) => (
        <span
          key={i}
          className="absolute bottom-1/2 origin-bottom rounded-full"
          style={{
            width: beam.width,
            height: size * beam.height,
            // Aproxima o encurtamento da elipse projetada perto das bordas.
            left: `calc(50% + ${beam.offset * size * 0.4}px)`,
            background: `linear-gradient(to top, ${secondaryColor}, ${color}00)`,
            filter: `blur(${1.5 + intensity}px)`,
            opacity: 0.5 * intensity,
            animation: `hud-beam ${beam.duration}s ease-in-out ${beam.delay}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function HolographicRings({
  size = 300,
  color = 'var(--color-ai-primary)',
  secondaryColor = 'var(--color-ai-soft)',
  ringCount = 3,
  speed = 1,
  intensity = 1,
  showBeams = true,
  tiltDeg = 0,
  className,
  style,
}: HolographicRingsProps) {
  const rings = useMemo(() => buildRings(ringCount, speed), [ringCount, speed])
  const glow = Math.max(0, intensity)

  return (
    <div
      className={clsx('relative select-none', className)}
      style={{ width: size, height: size, ...style }}
      aria-hidden
    >
      {showBeams && (
        <BeamLayer
          size={size}
          color={color}
          secondaryColor={secondaryColor}
          intensity={glow}
          speed={speed}
        />
      )}

      <div className="h-full w-full" style={{ perspective: size * 2.2 }}>
        <div
          className="h-full w-full"
          style={{ transform: `rotateX(${tiltDeg}deg)`, transformStyle: 'preserve-3d' }}
        >
          <svg
            viewBox="0 0 200 200"
            className="h-full w-full overflow-visible"
            style={{
              filter: `drop-shadow(0 0 ${3 * glow}px ${color}) drop-shadow(0 0 ${12 * glow}px ${color}aa)`,
            }}
          >
            {/* Halo central */}
            <circle
              cx={100}
              cy={100}
              r={26}
              fill={`url(#hud-core)`}
              style={{ animation: 'hud-breathe 3.4s ease-in-out infinite' }}
            />
            <defs>
              <radialGradient id="hud-core">
                <stop offset="0%" stopColor={secondaryColor} stopOpacity={0.5 * glow} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </radialGradient>
            </defs>

            {rings.map((spec, i) => (
              <RingLayer key={i} spec={spec} color={color} secondaryColor={secondaryColor} />
            ))}
          </svg>
        </div>
      </div>
    </div>
  )
}
