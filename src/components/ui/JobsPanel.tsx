import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'

import {
  useJobs, STAGE_LABEL, STAGE_ORDER,
  type CollectStep, type Job, type LogLine, type Stage,
} from '@/core/state/useJobs'

/**
 * Relatório dos processos seletivos.
 *
 * Duas visões, porque são duas perguntas diferentes: **o funil** responde "em
 * que pé estão as candidaturas que já existem", e **as vagas novas** respondem
 * "no que devo me candidatar agora". Misturar as duas numa lista só faria a
 * segunda sumir sob o volume da primeira.
 */
export function JobsPanel({ onClose }: { onClose: () => void }) {
  const {
    jobs, error, loading, collecting, progress, log,
    refresh, advance, apply, collect, linkedinLogin,
  } = useJobs(true)
  const [view, setView] = useState<'funil' | 'novas'>('funil')
  const [openId, setOpenId] = useState<string | null>(null)
  /** Resultado da última coleta — some ao iniciar outra. */
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { emAndamento, novas, porEtapa } = useMemo(() => {
    const list = jobs ?? []
    const comCandidatura = list.filter((j) => j.application)
    const porEtapa: Record<string, Job[]> = {}
    for (const job of comCandidatura) {
      const stage = job.application!.stage
      ;(porEtapa[stage] ??= []).push(job)
    }
    return {
      emAndamento: comCandidatura.length,
      novas: list.filter((j) => !j.application),
      porEtapa,
    }
  }, [jobs])

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-void/70 p-4 backdrop-blur-sm"
      onPointerDown={onClose}
      role="presentation"
    >
      <section
        onPointerDown={(e) => e.stopPropagation()}
        className="hud-panel flex max-h-[88vh] w-[min(760px,100%)] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Processos seletivos"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
          <span className="min-w-0">
            <span className="hud-label block">Processos seletivos</span>
            <span className="mt-0.5 block text-[13px] text-holo-50">
              {emAndamento} em andamento · {novas.length} vaga{novas.length === 1 ? '' : 's'} nova
              {novas.length === 1 ? '' : 's'}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              // O rótulo diz o que ele faz de verdade. "Atualizar" sozinho
              // sugeria que ele sairia procurando vagas — não sai.
              aria-label="Recarregar a lista"
              title="Recarrega a lista do banco. Para procurar vagas novas, use Buscar vagas."
              className={clsx(
                'grid h-6 w-6 place-items-center rounded-sm text-holo-700 transition-colors hover:text-holo-100',
                loading && 'animate-pulse-soft',
              )}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4}>
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
                <path d="M13.5 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid h-6 w-6 place-items-center rounded-sm text-holo-700 transition-colors hover:text-holo-100"
            >
              <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={1.5}>
                <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/5 px-3 py-2">
          {(['funil', 'novas'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={clsx(
                'hud-label rounded-sm px-2.5 py-1 transition-colors',
                view === v ? 'bg-holo-400/10 text-holo-200' : 'hover:text-holo-200',
              )}
            >
              {v === 'funil' ? 'Funil' : `Vagas novas (${novas.length})`}
            </button>
          ))}

          {/* Separado das abas e do "atualizar": este é o único que sai
              procurando. Confundir os dois foi o que fez o painel parecer
              quebrado — o de atualizar relê o banco em milissegundos, este
              abre um navegador e navega por minutos. */}
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={collecting}
              onClick={async () => {
                setAviso(null)
                setAviso(await collect())
              }}
              className={clsx(
                'rounded-sm border px-2.5 py-1 text-[10px] tracking-[0.18em] uppercase transition-colors',
                collecting
                  ? 'animate-pulse-soft border-white/10 text-holo-700'
                  : 'border-holo-400/40 text-holo-200 hover:bg-holo-400/10',
              )}
            >
              {collecting ? 'Buscando…' : 'Buscar vagas'}
            </button>
            <button
              type="button"
              disabled={collecting}
              onClick={async () => setAviso(await linkedinLogin())}
              title="Abre o navegador para você entrar no LinkedIn. A senha não passa pelo servidor."
              className="hud-label rounded-sm border border-white/10 px-2 py-1 transition-colors hover:border-holo-400/40 hover:text-holo-200"
            >
              Entrar no LinkedIn
            </button>
          </span>
        </div>

        {aviso && !collecting && (
          <p className="hud-label shrink-0 border-b border-white/5 px-3 py-1.5 text-holo-300">{aviso}</p>
        )}

        {(collecting || log.length > 0) && <Progresso progress={progress} log={log} ativo={collecting} />}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error && <p className="text-[13px] leading-relaxed text-alert">{error}</p>}
          {!error && !jobs && <p className="hud-label animate-pulse-soft">Carregando…</p>}

          {jobs && view === 'funil' && (
            <Funil porEtapa={porEtapa} openId={openId} onToggle={setOpenId} onAdvance={advance} />
          )}
          {jobs && view === 'novas' && <Novas jobs={novas} onApply={apply} />}
        </div>
      </section>
    </div>
  )
}

// — Camadas ————————————————————————————————————————————————

/**
 * Barra de progresso e registro da coleta.
 *
 * Três informações, e cada uma responde uma pergunta diferente de quem espera:
 * a barra diz **quanto falta**, o rótulo diz **o que está acontecendo agora**,
 * e o log diz **o que já aconteceu** — que é o único que sobrevive ao fim e
 * permite entender depois por que veio pouca vaga.
 *
 * O log permanece visível após terminar, de propósito. Sumir junto com a barra
 * apagaria justamente o registro que explica o resultado.
 */
function Progresso({
  progress,
  log,
  ativo,
}: {
  progress: CollectStep | null
  log: LogLine[]
  ativo: boolean
}) {
  const pct = progress && progress.total > 0 ? (progress.step / progress.total) * 100 : null

  return (
    <section className="shrink-0 border-b border-white/5 px-3 py-2">
      <span className="flex items-baseline justify-between gap-2">
        <span className={clsx('hud-label', ativo && 'animate-pulse-soft')}>
          {progress?.label ?? 'Coleta encerrada'}
        </span>
        {progress && progress.total > 0 && (
          <span className="hud-label shrink-0">
            {progress.step}/{progress.total}
          </span>
        )}
      </span>

      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className={clsx(
            'h-full rounded-full bg-holo-400 transition-[width] duration-500',
            // Sem total conhecido a barra não pode fingir precisão: vira uma
            // faixa pulsando, que comunica "trabalhando" sem inventar um
            // percentual.
            pct === null && 'w-1/4 animate-pulse-soft',
          )}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>

      {log.length > 0 && (
        <ol className="mt-2 max-h-24 space-y-0.5 overflow-y-auto">
          {log.map((linha) => (
            <li key={`${linha.at}-${linha.text}`} className="flex gap-2 text-[11px] leading-relaxed">
              <span className="hud-label w-12 shrink-0">{hora(linha.at)}</span>
              <span className="min-w-0 text-holo-700">{linha.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function hora(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function Funil({
  porEtapa,
  openId,
  onToggle,
  onAdvance,
}: {
  porEtapa: Record<string, Job[]>
  openId: string | null
  onToggle: (id: string | null) => void
  onAdvance: (applicationId: string, stage: Stage, note?: string) => Promise<void>
}) {
  const etapasComVaga = STAGE_ORDER.filter((s) => (porEtapa[s]?.length ?? 0) > 0)

  if (etapasComVaga.length === 0) {
    return (
      <p className="py-6 text-center text-[12px] leading-relaxed text-holo-700">
        Nenhuma candidatura ainda. Veja as vagas novas e abra a primeira.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {etapasComVaga.map((stage) => (
        <section key={stage}>
          <h3 className="hud-label mb-1.5 flex items-center gap-2">
            {/* O encerrado fica apagado: ainda é consultável, mas não compete
                por atenção com o que ainda pode dar em alguma coisa. */}
            <span
              className={clsx(
                'h-1.5 w-1.5 rounded-full',
                stage === 'recusada' || stage === 'desistiu' ? 'bg-holo-700' : 'bg-holo-300',
              )}
            />
            {STAGE_LABEL[stage]} · {porEtapa[stage].length}
          </h3>
          <ul className="space-y-1.5">
            {porEtapa[stage].map((job) => (
              <ProcessoCard
                key={job.id}
                job={job}
                open={openId === job.id}
                onToggle={() => onToggle(openId === job.id ? null : job.id)}
                onAdvance={onAdvance}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ProcessoCard({
  job,
  open,
  onToggle,
  onAdvance,
}: {
  job: Job
  open: boolean
  onToggle: () => void
  onAdvance: (applicationId: string, stage: Stage, note?: string) => Promise<void>
}) {
  const app = job.application!
  const encerrado = app.stage === 'recusada' || app.stage === 'desistiu'

  return (
    <li className={clsx('rounded-sm border', encerrado ? 'border-white/5' : 'border-white/10')}>
      <button type="button" onClick={onToggle} className="w-full px-3 py-2 text-left">
        <span className="flex items-baseline justify-between gap-2">
          <span className={clsx('truncate text-[13px]', encerrado ? 'text-holo-700' : 'text-holo-50')}>
            {job.title}
          </span>
          <span className="hud-label shrink-0">{diasDesde(app.updatedAt)}</span>
        </span>
        <span className="hud-label mt-0.5 block truncate">
          {job.company}
          {job.location ? ` · ${job.location}` : ''}
          {job.workMode ? ` · ${job.workMode}` : ''}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/5 px-3 py-2">
          {/* A linha do tempo é o que responde "faz quanto tempo que estou
              esperando esta empresa" — a pergunta real de quem procura vaga. */}
          <ol className="space-y-1">
            {app.events.map((e) => (
              <li key={e.id} className="flex gap-2 text-[11px] leading-relaxed">
                <span className="hud-label w-20 shrink-0">{formatarData(e.at)}</span>
                <span className="min-w-0">
                  <span className="text-holo-100">{STAGE_LABEL[e.stage] ?? e.stage}</span>
                  <span className="text-holo-700"> · via {e.source}</span>
                  {e.note && <span className="block text-holo-700">{e.note}</span>}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-2 flex flex-wrap gap-1 border-t border-white/5 pt-2">
            {STAGE_ORDER.filter((s) => s !== app.stage).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void onAdvance(app.id, s)}
                className="hud-label rounded-sm border border-white/10 px-1.5 py-1 transition-colors hover:border-holo-400/40 hover:text-holo-200"
              >
                {STAGE_LABEL[s]}
              </button>
            ))}
          </div>

          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className="hud-label mt-2 inline-block text-holo-300 hover:text-holo-100"
          >
            Abrir a vaga ↗
          </a>
        </div>
      )}
    </li>
  )
}

function Novas({ jobs, onApply }: { jobs: Job[]; onApply: (jobId: string) => Promise<void> }) {
  if (jobs.length === 0) {
    return (
      <p className="py-6 text-center text-[12px] leading-relaxed text-holo-700">
        Nenhuma vaga nova. A coleta escreve aqui assim que encontrar.
      </p>
    )
  }

  return (
    <ul className="space-y-1.5">
      {jobs.map((job) => (
        <li key={job.id} className="rounded-sm border border-white/10 px-3 py-2">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] text-holo-50">{job.title}</span>
            {job.score !== null && (
              <span
                className={clsx(
                  'hud-label shrink-0',
                  job.score >= 70 ? 'text-holo-300' : job.score >= 40 ? 'text-amber' : 'text-holo-700',
                )}
              >
                {job.score}
              </span>
            )}
          </span>
          <span className="hud-label mt-0.5 block truncate">
            {job.company}
            {job.seniority ? ` · ${job.seniority}` : ''}
            {job.salaryText ? ` · ${job.salaryText}` : ''}
          </span>
          {job.scoreReason && (
            <p className="mt-1 text-[11px] leading-relaxed text-holo-700">{job.scoreReason}</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void onApply(job.id)}
              className="rounded-sm border border-holo-400/40 px-2.5 py-1 text-[10px] tracking-[0.18em] text-holo-200 uppercase transition-colors hover:bg-holo-400/10"
            >
              Abrir processo
            </button>
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="hud-label self-center text-holo-300 hover:text-holo-100"
            >
              ver a vaga ↗
            </a>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** "há 3 d" — em processo seletivo, o que importa é o silêncio acumulado. */
function diasDesde(iso: string): string {
  const dias = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} d`
}

function formatarData(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
