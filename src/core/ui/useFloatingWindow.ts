import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Posição e tamanho de uma janela flutuante.
 *
 * Os dois andam juntos porque são o mesmo problema: manter a janela alcançável.
 * Mover pode empurrá-la para fora da tela; redimensionar também. Separar em
 * dois hooks faria cada um clampar sem saber do outro, e a conta sairia errada
 * exatamente nos cantos.
 *
 * Usa Pointer Events (um caminho para mouse, dedo e caneta) e
 * `setPointerCapture` — o detalhe que faz o gesto sobreviver quando o ponteiro
 * sai do elemento. Sem ele a janela escapa da mão em movimentos rápidos.
 */

/** Respiro mínimo entre a janela e a borda da tela. */
const MARGIN = 8

/** Abaixo disto a janela deixa de ser usável: o cabeçalho e o campo somem. */
const MIN_WIDTH = 260
const MIN_HEIGHT = 140

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

interface Options {
  /** Largura inicial; a altura começa automática, seguindo o conteúdo. */
  initialWidth: number
  /** Onde a janela nasce, dado o tamanho medido e o da viewport. */
  initial: (size: Size, viewport: Size) => Point
}

function clampPosition(position: Point, size: Size): Point {
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

export function useFloatingWindow<T extends HTMLElement>({ initialWidth, initial }: Options) {
  const ref = useRef<T>(null)
  const [position, setPosition] = useState<Point | null>(null)
  const [width, setWidth] = useState(initialWidth)
  // `null` = altura automática, acompanhando o conteúdo. Vira número no
  // primeiro redimensionamento vertical e não volta atrás: a partir daí quem
  // manda no tamanho é quem arrastou, não a conversa.
  const [height, setHeight] = useState<number | null>(null)

  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)

  const grabRef = useRef<Point>({ x: 0, y: 0 })
  const resizeRef = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 0, y: 0, width: 0, height: 0,
  })

  // Posição inicial depois da medida real: só aqui sabemos a altura, que
  // depende de quantas mensagens existem.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || position) return
    const rect = el.getBoundingClientRect()
    const size = { width: rect.width, height: rect.height }
    setPosition(clampPosition(initial(size, { width: window.innerWidth, height: window.innerHeight }), size))
  }, [initial, position])

  // Nada pode deixar a janela fora da tela — de lá não haveria alça para
  // trazê-la de volta. Medido no commit do React, e não só por
  // `ResizeObserver`: aquele entrega callbacks nas etapas de renderização, que
  // o navegador suspende em aba de segundo plano.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !position || dragging || resizing) return
    const rect = el.getBoundingClientRect()
    const next = clampPosition(position, { width: rect.width, height: rect.height })
    // A guarda de igualdade impede isto de virar loop infinito de render.
    if (next.x !== position.x || next.y !== position.y) setPosition(next)
  })

  // Mudanças que não vêm de render — fonte carregando, imagem refluindo — e o
  // redimensionamento do navegador.
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reclamp = () => {
      const rect = el.getBoundingClientRect()
      setWidth((w) => Math.min(w, Math.max(MIN_WIDTH, window.innerWidth - 2 * MARGIN)))
      setPosition((current) =>
        current ? clampPosition(current, { width: rect.width, height: rect.height }) : current,
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

  // — Arrastar ————————————————————————————————————————————

  const onDragStart = useCallback((event: React.PointerEvent) => {
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

  const onDragMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging) return
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPosition(
        clampPosition(
          { x: event.clientX - grabRef.current.x, y: event.clientY - grabRef.current.y },
          { width: rect.width, height: rect.height },
        ),
      )
    },
    [dragging],
  )

  const onDragEnd = useCallback((event: React.PointerEvent) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }, [])

  // — Redimensionar ————————————————————————————————————————

  const onResizeStart = useCallback((event: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // A medida atual vira o ponto de partida — é o que permite a altura sair
    // de "automática" para explícita sem a janela dar um salto.
    resizeRef.current = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    setResizing(true)
  }, [])

  const onResizeMove = useCallback(
    (event: React.PointerEvent) => {
      if (!resizing || !position) return
      const start = resizeRef.current
      // O teto é a distância até a borda: redimensionar não pode empurrar a
      // janela para fora, e como o canto de origem está fixo, o limite é o
      // espaço que sobra à direita e abaixo dele.
      const maxWidth = window.innerWidth - position.x - MARGIN
      const maxHeight = window.innerHeight - position.y - MARGIN
      setWidth(Math.min(Math.max(MIN_WIDTH, start.width + (event.clientX - start.x)), maxWidth))
      setHeight(Math.min(Math.max(MIN_HEIGHT, start.height + (event.clientY - start.y)), maxHeight))
    },
    [resizing, position],
  )

  const onResizeEnd = useCallback((event: React.PointerEvent) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    setResizing(false)
  }, [])

  return {
    ref,
    dragging,
    resizing,
    /** Volta a altura para automática — usado ao minimizar. */
    releaseHeight: useCallback(() => setHeight(null), []),
    style: position
      ? { left: position.x, top: position.y, width, ...(height !== null ? { height } : {}) }
      : // Enquanto a medida não aconteceu, fica invisível em vez de saltar.
        { left: 0, top: 0, width, visibility: 'hidden' as const },
    handleProps: {
      onPointerDown: onDragStart,
      onPointerMove: onDragMove,
      onPointerUp: onDragEnd,
      onPointerCancel: onDragEnd,
      // Sem isto o navegador rola a página em vez de arrastar a janela.
      style: { touchAction: 'none' as const },
    },
    resizeHandleProps: {
      onPointerDown: onResizeStart,
      onPointerMove: onResizeMove,
      onPointerUp: onResizeEnd,
      onPointerCancel: onResizeEnd,
      style: { touchAction: 'none' as const },
    },
  }
}
