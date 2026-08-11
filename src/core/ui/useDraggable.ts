import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Torna um elemento arrastável pela alça indicada.
 *
 * Usa Pointer Events, e não mouse + touch separados: um único caminho cobre
 * mouse, dedo e caneta. E usa `setPointerCapture`, que é o detalhe que faz o
 * arraste sobreviver quando o ponteiro sai do elemento — sem ele a janela
 * "escapa" da mão assim que o movimento é mais rápido que o re-render.
 */

/** Respiro mínimo entre a janela e a borda da tela. */
const MARGIN = 8

export interface Point {
  x: number
  y: number
}

interface Options {
  /** Onde a janela nasce, dado o tamanho dela e o da viewport. */
  initial: (size: { width: number; height: number }, viewport: { width: number; height: number }) => Point
}

function clamp(position: Point, size: { width: number; height: number }): Point {
  // `Math.max(MARGIN, …)` por último: numa tela menor que a janela o limite
  // superior fica abaixo do inferior, e sem esta ordem o resultado seria
  // negativo — a janela sairia por cima em vez de encostar na borda.
  const maxX = Math.max(MARGIN, window.innerWidth - size.width - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - size.height - MARGIN)
  return {
    x: Math.min(Math.max(MARGIN, position.x), maxX),
    y: Math.min(Math.max(MARGIN, position.y), maxY),
  }
}

export function useDraggable<T extends HTMLElement>({ initial }: Options) {
  const ref = useRef<T>(null)
  const [position, setPosition] = useState<Point | null>(null)
  const [dragging, setDragging] = useState(false)

  // Deslocamento entre o ponteiro e o canto da janela, para ela não saltar
  // até o cursor no primeiro movimento.
  const grabRef = useRef<Point>({ x: 0, y: 0 })

  // Posição inicial depois da medida real: só aqui sabemos a altura, que
  // depende de quantas mensagens existem.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || position) return
    const rect = el.getBoundingClientRect()
    const size = { width: rect.width, height: rect.height }
    setPosition(clamp(initial(size, { width: window.innerWidth, height: window.innerHeight }), size))
  }, [initial, position])

  // Nada pode deixar a janela fora da tela — de lá não haveria alça para
  // trazê-la de volta. Duas coisas a empurram para fora, e as duas contam:
  // encolher o navegador, e a própria janela crescer (uma conversa que ganha
  // mensagens, um menu que abre) enquanto está encostada na borda de baixo.

  // Crescimento vindo de render: medido no commit, sem depender do ciclo de
  // pintura. O `ResizeObserver` sozinho não bastaria — ele entrega callbacks
  // nas etapas de renderização, que o navegador suspende em aba de segundo
  // plano, e a janela ficaria fora da tela até alguém mexer no navegador.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !position) return
    const rect = el.getBoundingClientRect()
    const next = clamp(position, { width: rect.width, height: rect.height })
    // A guarda de igualdade é o que impede isto de virar loop infinito de
    // render: sem ela, todo commit agendaria outro.
    if (next.x !== position.x || next.y !== position.y) setPosition(next)
  })

  // Mudanças de tamanho que não vêm de render — fonte que termina de carregar,
  // imagem que reflui — e o redimensionamento do navegador.
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reclamp = () => {
      const rect = el.getBoundingClientRect()
      setPosition((current) =>
        current ? clamp(current, { width: rect.width, height: rect.height }) : current,
      )
    }

    const observer = new ResizeObserver(reclamp)
    observer.observe(el)
    window.addEventListener('resize', reclamp)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reclamp)
    }
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    // Botões dentro do cabeçalho continuam clicáveis: arrastar a partir de um
    // controle seria um clique perdido a cada tentativa.
    if ((event.target as HTMLElement).closest('button,a,input')) return

    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    grabRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging) return
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPosition(
        clamp(
          { x: event.clientX - grabRef.current.x, y: event.clientY - grabRef.current.y },
          { width: rect.width, height: rect.height },
        ),
      )
    },
    [dragging],
  )

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }, [])

  return {
    ref,
    dragging,
    /** Enquanto a medida não aconteceu, a janela fica invisível em vez de saltar. */
    style: position
      ? { left: position.x, top: position.y }
      : { left: 0, top: 0, visibility: 'hidden' as const },
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      // Sem isto o navegador rola a página em vez de arrastar a janela.
      style: { touchAction: 'none' as const },
    },
  }
}
