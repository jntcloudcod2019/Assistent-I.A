import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Vagas e processos seletivos vindos do servidor.
 *
 * Diferente das sessões e dos planos, isto **não** vive no `localStorage`: uma
 * candidatura é registro, não preferência, e o dono dela é o MongoDB. Guardar
 * cópia no navegador criaria duas versões do funil divergindo assim que o n8n
 * escrevesse do outro lado.
 */

export type Stage =
  | 'rascunho'
  | 'aguardando_envio'
  | 'enviada'
  | 'triagem'
  | 'teste'
  | 'entrevista'
  | 'proposta'
  | 'recusada'
  | 'desistiu'

export const STAGE_LABEL: Record<Stage, string> = {
  rascunho: 'Rascunho',
  aguardando_envio: 'Aguardando envio',
  enviada: 'Enviada',
  triagem: 'Em triagem',
  teste: 'Teste técnico',
  entrevista: 'Entrevista',
  proposta: 'Proposta',
  recusada: 'Recusada',
  desistiu: 'Desisti',
}

/** Ordem do funil na tela — do começo ao desfecho, e os encerrados por último. */
export const STAGE_ORDER: Stage[] = [
  'aguardando_envio',
  'enviada',
  'triagem',
  'teste',
  'entrevista',
  'proposta',
  'recusada',
  'desistiu',
]

export interface StageEvent {
  id: string
  stage: Stage
  note: string | null
  source: string
  at: string
}

export interface Application {
  id: string
  stage: Stage
  coverLetter: string | null
  appliedAt: string | null
  updatedAt: string
  events: StageEvent[]
}

export interface Job {
  id: string
  source: string
  url: string
  title: string
  company: string
  location: string | null
  workMode: string | null
  seniority: string | null
  salaryText: string | null
  score: number | null
  scoreReason: string | null
  collectedAt: string
  application: Application | null
}

export function useJobs(active: boolean) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const aliveRef = useRef(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/jobs?limit=200')
      if (response.status === 404) {
        // A rota só existe com banco configurado. 404 aqui não é falha de
        // rede: é o servidor rodando sem MongoDB, e dizer isso evita uma caça
        // ao erro errado.
        throw new Error('A busca de vagas exige o MongoDB configurado no servidor.')
      }
      if (!response.ok) throw new Error(`O servidor respondeu ${response.status}.`)
      const body = (await response.json()) as Job[]
      if (!aliveRef.current) return
      setJobs(body)
      setError(null)
    } catch (cause) {
      if (!aliveRef.current) return
      setError(cause instanceof Error ? cause.message : 'Não consegui carregar as vagas.')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [])

  const advance = useCallback(
    async (applicationId: string, stage: Stage, note?: string) => {
      await fetch(`/api/applications/${applicationId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, source: 'manual', note }),
      })
      await refresh()
    },
    [refresh],
  )

  const apply = useCallback(
    async (jobId: string) => {
      await fetch(`/api/jobs/${jobId}/apply`, { method: 'POST' })
      await refresh()
    },
    [refresh],
  )

  useEffect(() => {
    aliveRef.current = true
    if (!active) return
    void refresh()
    return () => {
      aliveRef.current = false
    }
  }, [active, refresh])

  return { jobs, error, loading, refresh, advance, apply }
}
