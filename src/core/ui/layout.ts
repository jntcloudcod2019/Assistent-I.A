/**
 * Medidas compartilhadas entre o DOM e a cena 3D.
 *
 * O anel holográfico é um elemento do DOM, medido em pixels; a esfera vive em
 * unidades de mundo, atrás de uma câmera em perspectiva. Para os dois terem o
 * mesmo tamanho na tela, alguém precisa converter — e a conta só fecha se
 * partirem do mesmo número. Duplicar o 440 nos dois lados faria com que
 * ajustar um deles descolasse silenciosamente do outro.
 */

/** Diâmetro do anel holográfico, em pixels de CSS. */
export const RING_SIZE = 440
