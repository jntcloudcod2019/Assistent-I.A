import type { FastifyInstance } from 'fastify'

import { JobStore } from './store.js'
import { inferSeniority, isStage, type JobInput } from './types.js'

/**
 * API da busca de vagas.
 *
 * O n8n coleta e chama `POST /api/jobs`; o painel do ALAN lê e move o funil.
 * As rotas são finas de propósito — a regra de deduplicação e de funil vive no
 * store, que é onde ela pode ser testada sem subir servidor.
 */

interface CollectBody {
  jobs?: unknown
}

/**
 * Aceita só o que dá para usar.
 *
 * Coleta automática traz lixo: anúncio sem título, link quebrado, campo com
 * outro nome. Filtrar aqui evita que uma vaga inútil ocupe espaço no painel e
 * consuma uma chamada de pontuação do modelo.
 */
function parseJob(raw: unknown): JobInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const j = raw as Record<string, unknown>

  const title = typeof j.title === 'string' ? j.title.trim() : ''
  const company = typeof j.company === 'string' ? j.company.trim() : ''
  const url = typeof j.url === 'string' ? j.url.trim() : ''
  const source = typeof j.source === 'string' ? j.source.trim() : ''
  if (!title || !company || !url || !source) return null

  // Sem id na origem, a URL serve: é estável o bastante para deduplicar.
  const sourceId = typeof j.sourceId === 'string' && j.sourceId.trim() ? j.sourceId.trim() : url

  const seniority = typeof j.seniority === 'string' ? j.seniority : inferSeniority(title)

  return {
    source,
    sourceId,
    url,
    title,
    company,
    seniority: seniority as JobInput['seniority'],
    location: typeof j.location === 'string' ? j.location : undefined,
    workMode: typeof j.workMode === 'string' ? j.workMode : undefined,
    salaryText: typeof j.salaryText === 'string' ? j.salaryText : undefined,
    description: typeof j.description === 'string' ? j.description.slice(0, 8_000) : undefined,
    postedAt: typeof j.postedAt === 'string' && !Number.isNaN(Date.parse(j.postedAt))
      ? new Date(j.postedAt)
      : undefined,
  }
}

export function registerJobRoutes(app: FastifyInstance, store: JobStore) {
  // — Coleta ————————————————————————————————————————————————

  app.post('/api/jobs', async (request, reply) => {
    const body = (request.body ?? {}) as CollectBody
    if (!Array.isArray(body.jobs)) {
      return reply.code(400).send({ error: 'Campo "jobs" deve ser uma lista.' })
    }

    const parsed = body.jobs.map(parseJob).filter((j): j is JobInput => j !== null)

    // Júnior e estágio são descartados na porta: o filtro pedido é pleno e
    // sênior, e deixá-los entrar só para filtrar na tela desperdiçaria as
    // chamadas de pontuação, que são a parte cara.
    const wanted = parsed.filter((j) => j.seniority === 'pleno' || j.seniority === 'senior')

    const result = await store.collect(wanted)
    return {
      ...result,
      descartadas: body.jobs.length - wanted.length,
      motivo: 'sem campos obrigatórios ou fora do filtro pleno/sênior',
    }
  })

  app.get('/api/jobs', async (request) => {
    const q = request.query as Record<string, string | undefined>
    return store.listJobs({
      onlyNew: q.onlyNew === 'true',
      minScore: q.minScore ? Number(q.minScore) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    })
  })

  /** Fila de pontuação: o que o ALAN ainda não avaliou. */
  app.get('/api/jobs/unscored', async (request) => {
    const q = request.query as Record<string, string | undefined>
    return store.unscored(q.limit ? Number(q.limit) : 20)
  })

  app.post('/api/jobs/:id/score', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body ?? {}) as { score?: unknown; reason?: unknown }
    if (typeof body.score !== 'number') {
      return reply.code(400).send({ error: 'Campo "score" numérico é obrigatório.' })
    }
    return store.scoreJob(id, body.score, typeof body.reason === 'string' ? body.reason : '')
  })

  // — Candidaturas ——————————————————————————————————————————

  app.post('/api/jobs/:id/apply', async (request) => {
    const { id } = request.params as { id: string }
    return store.openApplication(id)
  })

  app.post('/api/applications/:id/stage', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body ?? {}) as { stage?: unknown; note?: unknown; source?: unknown }
    if (!isStage(body.stage)) {
      return reply.code(400).send({ error: 'Etapa inválida.' })
    }
    return store.advance(
      id,
      body.stage,
      typeof body.source === 'string' ? body.source : 'manual',
      typeof body.note === 'string' ? body.note : undefined,
    )
  })

  app.post('/api/applications/:id/draft', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body ?? {}) as { coverLetter?: unknown; submitted?: unknown }
    if (typeof body.coverLetter !== 'string') {
      return reply.code(400).send({ error: 'Campo "coverLetter" é obrigatório.' })
    }
    return store.saveDraft(
      id,
      body.coverLetter,
      typeof body.submitted === 'object' && body.submitted !== null
        ? (body.submitted as Record<string, unknown>)
        : undefined,
    )
  })

  app.get('/api/applications/funnel', async () => store.funnel())

  // — Perfil ————————————————————————————————————————————————

  app.get('/api/profile', async () => (await store.profile()) ?? null)

  app.put('/api/profile', async (request) => {
    return store.saveProfile((request.body ?? {}) as Record<string, unknown>)
  })
}
