/**
 * Mapa de visemas para português brasileiro.
 *
 * Um visema é a forma visível da boca; vários fonemas compartilham a mesma.
 * O que importa aqui não é precisão fonética — é que os extremos existam: se
 * `p`, `b` e `m` não fecharem a boca por completo, o rosto lê como boneco de
 * ventríloquo por mais suave que seja o resto da animação.
 */

export interface Viseme {
  /** Abertura da mandíbula, 0..1 */
  jaw: number
  /** Largura da boca, 0..1 — distingue "a" de "o" */
  wide: number
}

const CLOSED: Viseme = { jaw: 0, wide: 0.2 }
const NEUTRAL: Viseme = { jaw: 0.22, wide: 0.4 }

const TABLE: Record<string, Viseme> = {
  // Vogais abertas — mandíbula baixa, boca larga
  a: { jaw: 0.92, wide: 0.85 },
  á: { jaw: 0.95, wide: 0.85 },
  à: { jaw: 0.92, wide: 0.85 },
  â: { jaw: 0.8, wide: 0.7 },
  ã: { jaw: 0.78, wide: 0.6 },

  // Vogais médias
  e: { jaw: 0.55, wide: 0.8 },
  é: { jaw: 0.68, wide: 0.85 },
  ê: { jaw: 0.5, wide: 0.72 },
  o: { jaw: 0.6, wide: 0.15 },
  ó: { jaw: 0.72, wide: 0.2 },
  ô: { jaw: 0.5, wide: 0.12 },
  õ: { jaw: 0.5, wide: 0.14 },

  // Vogais fechadas — arredondadas ou estreitas
  i: { jaw: 0.26, wide: 0.9 },
  í: { jaw: 0.3, wide: 0.92 },
  u: { jaw: 0.3, wide: 0.06 },
  ú: { jaw: 0.34, wide: 0.06 },

  // Bilabiais — fecham por completo
  p: CLOSED,
  b: CLOSED,
  m: CLOSED,

  // Labiodentais — lábio inferior nos dentes
  f: { jaw: 0.16, wide: 0.55 },
  v: { jaw: 0.16, wide: 0.55 },

  // Linguodentais e alveolares
  t: { jaw: 0.24, wide: 0.6 },
  d: { jaw: 0.26, wide: 0.6 },
  n: { jaw: 0.2, wide: 0.5 },
  l: { jaw: 0.3, wide: 0.55 },
  s: { jaw: 0.16, wide: 0.7 },
  z: { jaw: 0.18, wide: 0.68 },
  r: { jaw: 0.32, wide: 0.45 },

  // Pós-alveolares — boca projetada
  j: { jaw: 0.28, wide: 0.2 },
  x: { jaw: 0.26, wide: 0.22 },
  c: { jaw: 0.26, wide: 0.55 },
  g: { jaw: 0.32, wide: 0.45 },
  q: { jaw: 0.3, wide: 0.15 },
  k: { jaw: 0.28, wide: 0.5 },
  h: { jaw: 0.2, wide: 0.4 },
  w: { jaw: 0.24, wide: 0.1 },
  y: { jaw: 0.26, wide: 0.8 },
}

/** Silêncio: a boca descansa fechada entre frases. */
export const REST: Viseme = { jaw: 0.04, wide: 0.3 }

export function visemeFor(char: string): Viseme {
  const c = char.toLowerCase()
  if (/\s/.test(c)) return REST
  if (/[.,;:!?…]/.test(c)) return REST
  return TABLE[c] ?? NEUTRAL
}

/**
 * Converte um texto na sequência de visemas correspondente.
 *
 * Dígrafos importam: em "nh", "lh" e "ch" a boca não faz as duas consoantes em
 * sequência, faz uma só. Tratá-los caractere a caractere produziria um tremor
 * que não existe na fala.
 */
export function textToVisemes(text: string): Viseme[] {
  const out: Viseme[] = []
  const lower = text.toLowerCase()

  for (let i = 0; i < lower.length; i++) {
    const pair = lower.slice(i, i + 2)

    if (pair === 'nh' || pair === 'lh') {
      out.push({ jaw: 0.26, wide: 0.45 }, { jaw: 0.26, wide: 0.45 })
      i++
      continue
    }
    if (pair === 'ch') {
      out.push({ jaw: 0.24, wide: 0.2 }, { jaw: 0.24, wide: 0.2 })
      i++
      continue
    }
    if (pair === 'rr' || pair === 'ss') {
      out.push(visemeFor(lower[i]), visemeFor(lower[i]))
      i++
      continue
    }

    out.push(visemeFor(lower[i]))
  }

  return out
}
