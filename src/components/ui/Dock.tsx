import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import clsx from 'clsx'

/**
 * Dock com magnificação por proximidade, no estilo do macOS.
 *
 * O tamanho de cada ícone segue a distância horizontal até o ponteiro, e isso
 * muda a cada movimento do mouse — 60 vezes por segundo. Por isso a escala
 * **não** passa por state do React: seria a árvore inteira re-renderizando a
 * cada pixel. O valor vai direto no `transform` de cada elemento, pelo mesmo
 * motivo que `audioSignal` existe do lado do áudio.
 *
 * Sem dependência de animação: a curva de queda é uma conta, e `transform`
 * com `will-change` já roda na GPU.
 */

export interface DockItem {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  active?: boolean
}

/** Quanto o ícone sob o ponteiro cresce. */
const MAX_SCALE = 1.6

/** Alcance da influência, em pixels. Além disto o ícone fica no tamanho base. */
const RANGE = 110

export function Dock({ items, className }: { items: DockItem[]; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const pointerX = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)

  const render = useCallback(() => {
    frameRef.current = null
    const x = pointerX.current

    itemRefs.current.forEach((el) => {
      if (!el) return
      let scale = 1
      if (x !== null) {
        const rect = el.getBoundingClientRect()
        const center = rect.left + rect.width / 2
        const distance = Math.abs(x - center)
        // Queda quadrática: perto do ponteiro a variação é suave, e some de
        // vez na borda do alcance em vez de cortar num degrau.
        const falloff = Math.max(0, 1 - (distance / RANGE) ** 2)
        scale = 1 + (MAX_SCALE - 1) * falloff
      }
      // Sobe junto com o crescimento para o ícone não invadir a borda de
      // baixo — é o que dá a sensação de que ele salta em direção à pessoa.
      el.style.transform = `translateY(${-(scale - 1) * 14}px) scale(${scale})`
    })
  }, [])

  const schedule = useCallback(() => {
    // Um quadro por vez: `pointermove` dispara mais rápido que a tela pinta, e
    // recalcular a cada evento seria trabalho jogado fora.
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(render)
  }, [render])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      onPointerMove={(e) => {
        pointerX.current = e.clientX
        schedule()
      }}
      onPointerLeave={() => {
        pointerX.current = null
        schedule()
      }}
      className={clsx(
        'hud-panel flex items-end gap-1 px-2 py-1.5',
        // `items-end` para o crescimento empurrar para cima, com a base
        // alinhada — se crescessem pelo centro, o dock inteiro tremeria.
        className,
      )}
      role="toolbar"
      aria-label="Ações do ALAN"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(el) => {
            itemRefs.current[index] = el
          }}
          type="button"
          onClick={item.onClick}
          title={item.label}
          aria-label={item.label}
          aria-pressed={item.active}
          style={{ willChange: 'transform' }}
          className={clsx(
            'group relative grid h-10 w-10 shrink-0 origin-bottom place-items-center rounded-md border transition-colors',
            item.active
              ? 'border-holo-400/50 bg-holo-400/10 text-holo-100'
              : 'border-white/10 text-holo-300 hover:border-holo-400/40 hover:text-holo-100',
          )}
        >
          {item.icon}

          {/* Rótulo só no hover: um dock com seis legendas fixas vira uma
              barra de menu, e a graça do dock é o ícone. */}
          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-sm border border-white/10 bg-void/90 px-1.5 py-0.5 text-[9px] tracking-[0.14em] whitespace-nowrap text-holo-200 uppercase opacity-0 transition-opacity group-hover:opacity-100">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  )
}
