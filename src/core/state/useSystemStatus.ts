import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Estado das dependências do servidor.
 *
 * Espelha o que `GET /api/health` mede — sondas reais, não configuração. O
 * tipo é redigitado aqui em vez de importado do servidor porque os dois
 * pacotes são independentes: o front não compila contra o `server/`.
 */

export type ProbeStatus = 'online' | 'offline' | 'disabled' | 'unknown'

export interface Probe {
  id: string
  label: string
  status: ProbeStatus
  detail: string
  latencyMs?: number
}

export interface SystemStatus {
  ok: boolean
  store: string
  channel: string
  probes: Probe[]
  warnings: string[]
}

/**
 * Intervalo de atualização enquanto o painel está aberto.
 *
 * O servidor já guarda as sondas em cache por ~5 s, então consultar a cada 6 s
 * não gera carga sobre Redis nem Mongo — a maior parte das respostas vem do
 * cache. O `poll` só existe enquanto alguém está olhando: sem isso o
 * aplicativo consultaria o servidor para sempre, sem ninguém ler.
 */
const POLL_MS = 6_000

export function useSystemStatus(active: boolean) {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Evita escrever estado depois que o componente saiu, o que dispararia um
  // aviso do React e um render inútil.
  const aliveRef = useRef(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/health')
      if (!response.ok) throw new Error(`servidor respondeu ${response.status}`)
      const body = (await response.json()) as SystemStatus
      if (!aliveRef.current) return
      setStatus(body)
      setError(null)
    } catch (cause) {
      if (!aliveRef.current) return
      // Servidor fora do ar também é diagnóstico — e o mais importante deles.
      setStatus(null)
      setError(
        cause instanceof Error && cause.message.startsWith('servidor')
          ? cause.message
          : 'O servidor não respondeu. Ele está rodando na porta 3001?',
      )
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    if (!active) return

    void refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => {
      aliveRef.current = false
      clearInterval(timer)
    }
  }, [active, refresh])

  return { status, error, loading, refresh }
}
