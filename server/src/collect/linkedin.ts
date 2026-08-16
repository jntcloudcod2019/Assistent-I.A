import { getContext, humanPause, openForLogin } from './browser.js'
import type { JobInput } from '../jobs/types.js'

/**
 * Coleta de vagas no LinkedIn, usando a sua sessão.
 *
 * Navega a busca de vagas logado como você e lê a lista de resultados. Não
 * cria conta, não resolve desafio e não esconde o que é — se o LinkedIn pedir
 * verificação, a coleta para e avisa, porque contornar isso seria exatamente
 * a linha que não cruzamos.
 *
 * O ritmo é lento de propósito: poucas páginas por execução, pausa entre elas.
 * Uma varredura agressiva derruba o servidor do outro lado e é detectada por
 * ser mal-educada, não por ser automação.
 */

/** Teto por execução. Mais que isso vira varredura, e varredura chama atenção. */
const MAX_PAGES = 3
const PER_PAGE = 25

export interface SearchQuery {
  /** Termo da busca, ex.: "Engenheiro de Software .NET". */
  keywords: string
  /** Código de local do LinkedIn; vazio = qualquer lugar. */
  geoId?: string
  /** `r86400` = últimas 24 h. É o que evita recoletar o mesmo acervo todo dia. */
  postedWithin?: string
  /** `2` = pleno-sênior, `3` = sênior, `4` = diretor. */
  experienceLevels?: string[]
  /** `2` = remoto, `3` = híbrido. */
  workplaceTypes?: string[]
}

export interface CollectResult {
  jobs: JobInput[]
  pages: number
  needsLogin: boolean
  blocked: boolean
  note?: string
}

/**
 * Extrai o id numérico da vaga a partir do link.
 *
 * O formato não é `/jobs/view/12345` como parece: é
 * `/jobs/view/titulo-da-vaga-na-empresa-4454810996?position=46&trackingId=…`
 * — o id fica **no fim do slug**, e a query traz parâmetros de rastreio que
 * mudam a cada cartão.
 *
 * Errar isso não quebra nada de forma visível: a extração falha, cai para a
 * URL inteira, e como o rastreio difere, a MESMA vaga entra várias vezes. Foi
 * o que aconteceu — Cox, BlackLine e CVS triplicados na primeira coleta.
 */
function extractJobId(href: string): string | null {
  const path = href.split('?')[0]
  const id = /(\d{6,})\/?$/.exec(path)?.[1]
  return id ?? null
}

function buildUrl(q: SearchQuery, start: number): string {
  const params = new URLSearchParams({ keywords: q.keywords, start: String(start) })
  if (q.geoId) params.set('geoId', q.geoId)
  if (q.postedWithin) params.set('f_TPR', q.postedWithin)
  if (q.experienceLevels?.length) params.set('f_E', q.experienceLevels.join(','))
  if (q.workplaceTypes?.length) params.set('f_WT', q.workplaceTypes.join(','))
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`
}

/** Login manual: abre a janela e espera você entrar. */
export async function login(): Promise<boolean> {
  return openForLogin('https://www.linkedin.com/login', /linkedin\.com\/(feed|in|jobs)/, 300_000)
}

export async function collect(queries: SearchQuery[]): Promise<CollectResult> {
  const context = await getContext({ headless: true })
  const page = context.pages()[0] ?? (await context.newPage())

  const jobs: JobInput[] = []
  const vistos = new Set<string>()
  let pages = 0

  for (const query of queries) {
    for (let p = 0; p < MAX_PAGES; p++) {
      try {
        await page.goto(buildUrl(query, p * PER_PAGE), { waitUntil: 'domcontentloaded', timeout: 45_000 })
      } catch (error) {
        // O redirecionamento para o authwall INTERROMPE a navegação em curso,
        // então ele chega como exceção e não como uma URL para conferir
        // depois. Sem tratar aqui, o bloqueio virava HTTP 500 e parecia
        // defeito do servidor — quando é o LinkedIn dizendo não.
        const message = error instanceof Error ? error.message : String(error)
        if (/authwall|checkpoint|interrupted by another navigation/i.test(message)) {
          return {
            jobs,
            pages,
            needsLogin: true,
            blocked: true,
            note: 'O LinkedIn interrompeu a navegação e exigiu autenticação (authwall).',
          }
        }
        throw error
      }
      pages++

      const url = page.url()

      // Redirecionado para login: a sessão expirou. Parar aqui e avisar é o
      // certo — insistir sem sessão é o que gera bloqueio de verdade.
      if (/\/(login|uas\/login|checkpoint)/.test(url)) {
        return { jobs, pages, needsLogin: true, blocked: false, note: 'Sessão expirou. Rode o login de novo.' }
      }
      if (/authwall|challenge/.test(url)) {
        return {
          jobs,
          pages,
          needsLogin: false,
          blocked: true,
          note: 'O LinkedIn pediu verificação. A coleta parou — resolva no navegador antes de repetir.',
        }
      }

      // A lista tem dois formatos conforme a sessão; aceitar os dois evita a
      // coleta voltar vazia quando o LinkedIn muda o layout de um lado só.
      const cards = await page
        .locator('div.job-card-container, li.jobs-search-results__list-item, div.base-card')
        .all()

      if (cards.length === 0) {
        // Zero cartões tem duas causas MUITO diferentes, e confundi-las produz
        // o pior tipo de erro: "coletei 0 vagas" quando na verdade fomos
        // barrados. O LinkedIn passou a servir o muro de cadastro mantendo a
        // MESMA URL — então só o conteúdo denuncia.
        const temFormularioDeLogin = await page
          .locator('input[name="session_password"], input[name="password"], form.login__form')
          .count()

        if (temFormularioDeLogin > 0) {
          return {
            jobs,
            pages,
            needsLogin: true,
            blocked: true,
            note: 'O LinkedIn substituiu os resultados por um muro de cadastro. O acesso sem sessão foi cortado.',
          }
        }
        break
      }

      for (const card of cards) {
        try {
          const href = await card.locator('a[href*="/jobs/view/"]').first().getAttribute('href')
          if (!href) continue

          const sourceId = extractJobId(href)
          // Sem id numérico não dá para deduplicar, e sem deduplicar a mesma
          // vaga vira três candidaturas. Descartar é melhor que duplicar.
          if (!sourceId || vistos.has(sourceId)) continue
          vistos.add(sourceId)

          const title = (await card.locator('a[href*="/jobs/view/"]').first().innerText()).trim()
          const company = (
            await card
              .locator('.job-card-container__primary-description, .base-search-card__subtitle, .artdeco-entity-lockup__subtitle')
              .first()
              .innerText()
              .catch(() => '')
          ).trim()
          const location = (
            await card
              .locator('.job-card-container__metadata-item, .job-search-card__location')
              .first()
              .innerText()
              .catch(() => '')
          ).trim()

          if (!title || !company) continue

          jobs.push({
            source: 'linkedin',
            sourceId,
            url: `https://www.linkedin.com/jobs/view/${sourceId}`,
            title,
            company,
            location: location || undefined,
          })
        } catch {
          // Cartão com layout inesperado: pular um é melhor que perder a página.
        }
      }

      await humanPause()
    }
  }

  return { jobs, pages, needsLogin: false, blocked: false }
}
