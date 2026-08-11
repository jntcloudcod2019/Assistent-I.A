/**
 * PRNG semeado, compartilhado pelos componentes decorativos.
 *
 * Toda a geometria ornamental (trilhas, nós, partículas, marcadores) é sorteada
 * uma vez em `useMemo`. Usar `Math.random` faria o desenho mudar a cada
 * reconciliação do React e a interface cintilaria sem motivo.
 */
export function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Sorteio uniforme em [min, max). */
export const between = (rand: () => number, min: number, max: number): number =>
  min + rand() * (max - min)

/** Sorteio inteiro em [min, max]. */
export const intBetween = (rand: () => number, min: number, max: number): number =>
  Math.floor(between(rand, min, max + 1))

/** Escolhe um item do array. */
export const pick = <T,>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length) % items.length]
