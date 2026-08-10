/**
 * Sinais contínuos que mudam a 60 fps.
 *
 * Estes valores NUNCA passam por state do React — seriam ~60 re-renders por
 * segundo da árvore inteira. Ficam neste objeto mutável, escritos pelos hooks
 * de áudio e lidos dentro de `useFrame` para alimentar os uniforms do shader.
 */
export const audioSignal = {
  /** Amplitude RMS do microfone, 0..1 */
  level: 0,
  /** Abertura da mandíbula durante a fala, 0..1 */
  jaw: 0,
  /** Intensidade da turbulência de "raciocínio", 0..1 */
  thinking: 0,
  /** Energia geral do sistema — sobe em qualquer atividade, 0..1 */
  energy: 0,
}

export type AudioSignal = typeof audioSignal

/** Interpolação exponencial estável em qualquer frame rate. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

export function resetAudioSignal() {
  audioSignal.level = 0
  audioSignal.jaw = 0
  audioSignal.thinking = 0
  audioSignal.energy = 0
}
