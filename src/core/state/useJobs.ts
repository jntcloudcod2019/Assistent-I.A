import { useCallback, useEffect, useRef, useState } from 'react'

import { parseFrame, readSse } from '@/core/net/sse'

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

/**
 * Ordem do funil na tela — do começo ao desfecho, e os encerrados por último.
 *
 * `rascunho` PRECISA estar aqui. `openApplication` cria a candidatura nesse
 * estágio, e o funil só desenha as etapas desta lista — sem ela, clicar em
 * "Abrir processo" fazia a vaga sair de *Vagas novas* (porque passa a ter
 * candidatura) e não aparecer em lugar nenhum. Sumia.
 *
 * Mantida visível em vez de pular direto para `aguardando_envio` porque é no
 * rascunho que a carta de apresentação e a revisão vão viver.
 */
export const STAGE_ORDER: Stage[] = [
  'rascunho',
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


/** Progresso vindo do servidor, espelhando `CollectProgress` do coletor. */
interface CollectProgress {
  type: 'start' | 'query' | 'page' | 'pause' | 'blocked' | 'saving'
  step?: number
  total?: number
  queries?: number
  keywords?: string
  page?: number
  found?: number
  acumulado?: number
  note?: string
}

export interface CollectStep {
  step: number
  total: number
  label: string
}

export interface LogLine {
  at: number
  text: string
}

/**
 * Traduz o evento em uma frase.
 *
 * Fica aqui, e não no servidor, porque é texto de interface: o servidor
 * relata o fato, o cliente decide como contá-lo.
 */
function describe(p: CollectProgress): string {
  switch (p.type) {
    case 'start':
      return `Iniciando ${p.queries} busca${p.queries === 1 ? '' : 's'}…`
    case 'query':
      return `Buscando "${p.keywords}"`
    case 'page':
      return `Página ${p.page}: ${p.found} anúncio${p.found === 1 ? '' : 's'} · ${p.acumulado} acumulada${p.acumulado === 1 ? '' : 's'}`
    case 'pause':
      return 'Pausa entre páginas…'
    case 'saving':
      return 'Gravando no banco…'
    case 'blocked':
      return p.note ?? 'Bloqueado pelo LinkedIn.'
    default:
      return 'Trabalhando…'
  }
}

export function useJobs(active: boolean) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /** Coleta é lenta (abre navegador); precisa de estado próprio. */
  const [collecting, setCollecting] = useState(false)
  const [progress, setProgress] = useState<CollectStep | null>(null)
  const [log, setLog] = useState<LogLine[]>([])
  const aliveRef = useRef(true)

  /**
   * Traduz a resposta em erro legível, ou devolve o corpo.
   *
   * Cada código significa uma coisa diferente para quem está olhando a tela, e
   * tratá-los como "deu erro" desperdiça a informação mais útil: 404 é módulo
   * inexistente, 409 é estado que só você resolve, 5xx é defeito de verdade.
   */
  const parse = useCallback(async (response: Response): Promise<unknown> => {
    if (response.ok) return response.json()

    if (response.status === 404) {
      throw new Error('A busca de vagas exige o MongoDB configurado no servidor.')
    }

    if (response.status === 409) {
      // O servidor manda o motivo em `note` — coleta em andamento, sessão
      // caída, LinkedIn bloqueado. Repassar isso é o ponto inteiro.
      const body = (await response.json().catch(() => null)) as { note?: string; error?: string } | null
      throw new Error(body?.note ?? body?.error ?? 'A operação não pôde ser feita agora.')
    }

    throw new Error(`O servidor respondeu ${response.status}.`)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const body = (await parse(await fetch('/api/jobs?limit=200'))) as Job[]
      if (!aliveRef.current) return
      setJobs(body)
      setError(null)
    } catch (cause) {
      if (!aliveRef.current) return
      setError(cause instanceof Error ? cause.message : 'Não consegui carregar as vagas.')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [parse])

  const advance = useCallback(
    async (applicationId: string, stage: Stage, note?: string) => {
      try {
        await parse(
          await fetch(`/api/applications/${applicationId}/stage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage, source: 'manual', note }),
          }),
        )
        setError(null)
      } catch (cause) {
        // Antes esta falha era engolida: o `refresh` rodava, nada mudava na
        // tela, e parecia que o clique não tinha registrado.
        setError(cause instanceof Error ? cause.message : 'Não consegui mudar a etapa.')
        return
      }
      await refresh()
    },
    [parse, refresh],
  )

  const apply = useCallback(
    async (jobId: string) => {
      try {
        await parse(await fetch(`/api/jobs/${jobId}/apply`, { method: 'POST' }))
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não consegui abrir o processo.')
        return
      }
      await refresh()
    },
    [parse, refresh],
  )

  /**
   * Dispara a coleta no LinkedIn.
   *
   * Separada do `refresh` de propósito: uma relê o banco em milissegundos, a
   * outra abre um navegador e navega por minutos. Confundir as duas foi o que
   * fez o botão de atualizar parecer quebrado.
   */
  const collect = useCallback(async (): Promise<string | null> => {
    setCollecting(true)
    setError(null)
    setProgress({ step: 0, total: 0, label: 'Abrindo o navegador…' })
    setLog([])
    const anotar = (linha: string) =>
      // Mais recente no topo, e teto de 60: um log que cresce sem limite vira
      // rolagem infinita justamente quando se quer olhar o começo.
      setLog((atual) => [{ at: Date.now(), text: linha }, ...atual].slice(0, 60))

    try {
      const response = await fetch('/api/collect/linkedin/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) await parse(response) // lança com a mensagem certa

      let resultado: { inserted?: number; received?: number; descartadas?: number } | null = null

      for await (const frame of readSse(response)) {
        if (frame.event === 'progress') {
          const p = parseFrame<CollectProgress>(frame)
          if (!p) continue
          setProgress({ step: p.step ?? 0, total: p.total ?? 0, label: describe(p) })
          // Pausa não vira linha de log: são dezenas delas, e afogariam os
          // eventos que dizem algo.
          if (p.type !== 'pause') anotar(describe(p))
          continue
        }

        if (frame.event === 'done') {
          resultado = parseFrame(frame)
          continue
        }

        if (frame.event === 'error') {
          const e = parseFrame<{ message?: string }>(frame)
          throw new Error(e?.message ?? 'A coleta foi interrompida.')
        }
      }

      await refresh()

      const inseridas = resultado?.inserted ?? 0
      anotar(`Concluído: ${inseridas} nova${inseridas === 1 ? '' : 's'}.`)
      if (inseridas === 0) {
        return `Nenhuma vaga nova. ${resultado?.received ?? 0} vistas, ${resultado?.descartadas ?? 0} fora do filtro.`
      }
      return `${inseridas} vaga${inseridas === 1 ? '' : 's'} nova${inseridas === 1 ? '' : 's'}.`
    } catch (cause) {
      // Só `error`, e não também o retorno: a falha tem um canal só. Gravar
      // nos dois fazia a mesma frase aparecer duas vezes na tela.
      const message = cause instanceof Error ? cause.message : 'A busca falhou.'
      setError(message)
      anotar(message)
      return null
    } finally {
      setCollecting(false)
      setProgress(null)
    }
  }, [parse, refresh])

  /** Abre o navegador para o login manual no LinkedIn. */
  const linkedinLogin = useCallback(async (): Promise<string | null> => {
    setCollecting(true)
    setError(null)
    try {
      const body = (await parse(
        await fetch('/api/collect/linkedin/login', { method: 'POST' }),
      )) as { ok?: boolean; note?: string }
      return body.note ?? (body.ok ? 'Sessão salva.' : 'O login não foi concluído.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não consegui abrir o login.')
      return null
    } finally {
      setCollecting(false)
    }
  }, [parse])

  useEffect(() => {
    aliveRef.current = true
    if (!active) return
    void refresh()
    return () => {
      aliveRef.current = false
    }
  }, [active, refresh])

  return {
    jobs, error, loading, collecting, progress, log,
    refresh, advance, apply, collect, linkedinLogin,
  }
}
