import type { FastifyInstance } from 'fastify'

import { collect, login, type SearchQuery } from './linkedin.js'
import { inferSeniority } from '../jobs/types.js'
import type { JobStore } from '../jobs/store.js'

/**
 * Rotas de coleta por navegador.
 *
 * O n8n agenda e chama; o Playwright roda aqui, no servidor, porque é onde já
 * existe Node e onde o resultado precisa chegar de qualquer forma. O n8n fica
 * com o papel que é dele — orquestrar — sem precisar de navegador embutido.
 */

/**
 * Buscas padrão, calibradas pelo currículo.
 *
 * Português e inglês juntos: as vagas brasileiras de .NET aparecem nos dois
 * idiomas, e empresa multinacional costuma publicar em inglês mesmo para o
 * Brasil. Termo separado por busca, e não tudo num `OR`, porque o LinkedIn
 * pondera relevância por consulta — juntar dilui todas.
 */
const DEFAULT_QUERIES: SearchQuery[] = [
  { keywords: 'Engenheiro de Software .NET' },
  { keywords: 'Desenvolvedor .NET C#' },
  { keywords: 'Analista de Sistemas .NET' },
  { keywords: '.NET Software Engineer' },
  { keywords: 'C# Backend Engineer' },
  { keywords: 'Software Engineer .NET fintech' },
].map((q) => ({
  ...q,
  // Brasil. Sem isto a busca sai global e volta cheia de CVS Health e Cox
  // Automotive — vagas reais, mas nos Estados Unidos.
  geoId: '106057199',
  // Últimas 24 h: sem isso, cada execução recoleta o mesmo acervo e a
  // deduplicação vira o trabalho principal.
  postedWithin: 'r86400',
  // 3 = pleno-sênior, 4 = sênior. É o filtro que você pediu, aplicado na
  // origem — mais barato que trazer tudo e descartar depois.
  experienceLevels: ['3', '4'],
}))

/** Uma execução por vez: dois navegadores no mesmo perfil corrompem a sessão. */
let running = false

export function registerCollectRoutes(app: FastifyInstance, store: JobStore) {
  /**
   * Abre o navegador para você entrar no LinkedIn.
   *
   * Manual de propósito: o servidor nunca recebe nem guarda sua senha. Ele
   * reaproveita a sessão que você criou, e é só isso.
   */
  app.post('/api/collect/linkedin/login', async (_request, reply) => {
    if (running) return reply.code(409).send({ error: 'Já existe uma coleta em andamento.' })
    running = true
    try {
      const ok = await login()
      return {
        ok,
        note: ok
          ? 'Sessão salva. A coleta já pode rodar sem janela.'
          : 'O login não foi concluído no tempo previsto.',
      }
    } finally {
      running = false
    }
  })

  /**
   * Coleta com progresso em tempo real.
   *
   * SSE e não uma resposta única porque a coleta leva minutos: seis buscas,
   * três páginas cada, com pausa deliberada entre elas. Com resposta única a
   * tela ficava parada o tempo todo, e "trabalhando" era indistinguível de
   * "travado" — que foi exatamente a reclamação.
   *
   * Mesmo formato do `/api/chat`, então o cliente reaproveita o leitor de SSE
   * em vez de ganhar um terceiro parser.
   */
  app.post('/api/collect/linkedin/stream', async (request, reply) => {
    if (running) {
      return reply.code(409).send({ error: 'Já existe uma coleta em andamento.' })
    }

    const body = (request.body ?? {}) as { queries?: unknown }
    const queries = Array.isArray(body.queries) && body.queries.length
      ? (body.queries as SearchQuery[])
      : DEFAULT_QUERIES

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // Cliente desistiu: aborta a coleta. Sem isto o navegador seguiria
    // navegando por minutos para ninguém, gastando páginas no LinkedIn e
    // segurando a trava que bloqueia a próxima tentativa.
    const controller = new AbortController()
    raw.on('close', () => controller.abort())

    running = true
    try {
      const result = await collect(queries, (p) => send('progress', p), controller.signal)

      if (result.needsLogin || result.blocked) {
        send('error', {
          message: result.note ?? 'A coleta foi interrompida.',
          needsLogin: result.needsLogin,
          blocked: result.blocked,
        })
        return
      }

      send('progress', { type: 'saving', total: 0, step: 0 })

      const comSenioridade = result.jobs.map((j) => ({
        ...j,
        seniority: j.seniority ?? inferSeniority(j.title),
      }))
      const filtradas = comSenioridade.filter((j) => j.seniority === 'pleno' || j.seniority === 'senior')
      const saved = await store.collect(filtradas)

      send('done', {
        ...saved,
        paginas: result.pages,
        buscas: queries.length,
        descartadas: result.jobs.length - filtradas.length,
      })
    } catch (error) {
      send('error', {
        message: error instanceof Error ? error.message : 'A coleta falhou.',
      })
    } finally {
      running = false
      raw.end()
    }
  })

  app.post('/api/collect/linkedin', async (request, reply) => {
    if (running) return reply.code(409).send({ error: 'Já existe uma coleta em andamento.' })

    const body = (request.body ?? {}) as { queries?: unknown }
    const queries = Array.isArray(body.queries) && body.queries.length
      ? (body.queries as SearchQuery[])
      : DEFAULT_QUERIES

    running = true
    try {
      const result = await collect(queries)

      // Sessão perdida ou verificação: devolver 409 e não 500 porque não é
      // falha do servidor — é um estado que só você resolve, e o n8n precisa
      // distinguir "tentar de novo depois" de "chamar o humano".
      if (result.needsLogin || result.blocked) {
        return reply.code(409).send({
          needsLogin: result.needsLogin,
          blocked: result.blocked,
          note: result.note,
          coletadas: result.jobs.length,
        })
      }

      const comSenioridade = result.jobs.map((j) => ({
        ...j,
        seniority: j.seniority ?? inferSeniority(j.title),
      }))
      const filtradas = comSenioridade.filter((j) => j.seniority === 'pleno' || j.seniority === 'senior')

      const saved = await store.collect(filtradas)

      return {
        ...saved,
        paginas: result.pages,
        buscas: queries.length,
        descartadas: result.jobs.length - filtradas.length,
      }
    } finally {
      running = false
    }
  })
}
