import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Probe } from '../health/probes.js'
import type { JobStore } from './store.js'

/**
 * Sondas do módulo de vagas.
 *
 * Separadas de `probes.ts` porque o módulo inteiro é opcional — só existe com
 * MongoDB. Misturá-las lá obrigaria aquele arquivo a conhecer `JobStore` para
 * nada quando não há banco.
 */

/** Onde `browser.ts` guarda o perfil persistente do Chromium. */
const PROFILE_DIR = join(homedir(), '.cache', 'alan', 'browser')

/**
 * A sessão do LinkedIn ainda vale?
 *
 * Lê o arquivo de cookies do perfil **sem abrir navegador** — abrir custaria
 * segundos e um processo, e um health check que faz isso a cada consulta é um
 * health check que ninguém deixa aberto.
 *
 * O que se pode afirmar daqui é limitado, e o rótulo reflete isso: a presença
 * do cookie `li_at` com validade futura significa "provavelmente logado", não
 * "logado". Só uma requisição real confirmaria — e ela custa uma página no
 * LinkedIn, que é justamente o recurso escasso.
 */
function linkedinSession(): Probe {
  const cookies = join(PROFILE_DIR, 'Default', 'Network', 'Cookies')

  if (!existsSync(PROFILE_DIR)) {
    return {
      id: 'linkedin',
      label: 'Sessão do LinkedIn',
      status: 'disabled',
      detail: 'Nenhum perfil de navegador ainda. Use "Entrar no LinkedIn" no painel.',
    }
  }

  if (!existsSync(cookies)) {
    return {
      id: 'linkedin',
      label: 'Sessão do LinkedIn',
      status: 'offline',
      detail: 'Perfil existe mas sem cookies gravados — o login não foi concluído.',
    }
  }

  // O arquivo é um SQLite com os valores cifrados pelo sistema; não dá para
  // ler a validade sem descriptografar. O nome do cookie, porém, aparece em
  // texto claro — e a data de modificação diz quando a sessão foi tocada.
  let temLiAt = false
  try {
    temLiAt = readFileSync(cookies).includes('li_at')
  } catch {
    // Arquivo travado pelo navegador aberto: não é falha, só indeterminado.
  }

  const idadeDias = Math.floor((Date.now() - statSync(cookies).mtimeMs) / 86_400_000)

  if (!temLiAt) {
    return {
      id: 'linkedin',
      label: 'Sessão do LinkedIn',
      status: 'offline',
      detail: 'Sem cookie de sessão do LinkedIn. Entre de novo pelo painel.',
    }
  }

  return {
    id: 'linkedin',
    label: 'Sessão do LinkedIn',
    // `unknown` e não `online`: o cookie existe, mas só uma requisição real
    // provaria que ainda vale. Afirmar "no ar" aqui seria a mesma mentira que
    // o health antigo contava sobre o Redis.
    status: 'unknown',
    detail:
      idadeDias === 0
        ? 'Cookie de sessão presente, gravado hoje.'
        : `Cookie de sessão presente, com ${idadeDias} dia${idadeDias === 1 ? '' : 's'}. Só a próxima busca confirma se ainda vale.`,
  }
}

export async function jobProbes(store: JobStore): Promise<Probe[]> {
  const probes: Probe[] = []

  const [jobs, perfil, semNota] = await Promise.all([
    store.listJobs({ limit: 500 }),
    store.profile(),
    store.unscored(500),
  ])

  const ultima = jobs
    .map((j) => new Date(j.collectedAt).getTime())
    .reduce((a, b) => Math.max(a, b), 0)
  const horas = ultima ? Math.floor((Date.now() - ultima) / 3_600_000) : null

  probes.push({
    id: 'jobs',
    label: 'Vagas coletadas',
    // Zero vagas não é defeito: é um módulo que ainda não rodou.
    status: jobs.length > 0 ? 'online' : 'unknown',
    detail:
      jobs.length === 0
        ? 'Nenhuma vaga ainda. Use "Buscar vagas" no painel de processos seletivos.'
        : `${jobs.length} no banco, última coleta ${horas === 0 ? 'há menos de uma hora' : `há ${horas} h`}.`,
  })

  probes.push({
    id: 'jobs-scoring',
    label: 'Fila de pontuação',
    status: semNota.length === 0 ? 'online' : 'unknown',
    detail:
      semNota.length === 0
        ? 'Nenhuma vaga esperando nota.'
        : `${semNota.length} vaga${semNota.length === 1 ? '' : 's'} sem nota — a pontuação ainda não tem quem a dispare.`,
  })

  probes.push(
    perfil?.fullName && perfil.email
      ? {
          id: 'candidate-profile',
          label: 'Perfil do candidato',
          status: 'online',
          detail: `Preenchido para ${perfil.fullName}.`,
        }
      : {
          id: 'candidate-profile',
          label: 'Perfil do candidato',
          status: 'offline',
          // `offline` e não `disabled`: sem perfil a pontuação não tem contra
          // o que comparar e a carta não pode ser escrita. É falta, não escolha.
          detail: 'Vazio. Sem ele não dá para pontuar vaga nem gerar carta.',
        },
  )

  probes.push(linkedinSession())

  return probes
}
