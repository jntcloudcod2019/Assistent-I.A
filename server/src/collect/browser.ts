import { chromium, type BrowserContext } from 'playwright'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Navegador com sessão persistente.
 *
 * Usa `launchPersistentContext` e não um navegador limpo a cada execução: o
 * login é feito **uma vez, por você, à mão**, e o perfil no disco mantém os
 * cookies. Isso evita ter que guardar senha em lugar nenhum — o servidor nunca
 * vê credencial, só reaproveita a sessão que já existe.
 *
 * O que este módulo deliberadamente **não** faz: mascarar fingerprint,
 * rotacionar proxy ou resolver CAPTCHA. Sem essas peças, a automação se
 * comporta como um navegador comum operado devagar — que é o único modo em que
 * ela é defensável.
 */

/** Perfil fora do projeto: sessão não é código e não pode ir para o git. */
const PROFILE_DIR = join(homedir(), '.cache', 'alan', 'browser')

let context: BrowserContext | null = null

export interface BrowserOptions {
  /** `false` abre a janela — necessário no login manual. */
  headless?: boolean
}

export async function getContext(options: BrowserOptions = {}): Promise<BrowserContext> {
  if (context) return context

  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: options.headless ?? true,
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // Sem `args` de furtividade de propósito. O que está aqui é só o que
    // qualquer navegador real teria.
  })

  return context
}

export async function closeContext(): Promise<void> {
  await context?.close()
  context = null
}

/**
 * Pausa aleatória entre ações.
 *
 * Não é disfarce: é ritmo. Uma automação que dispara vinte requisições por
 * segundo derruba o servidor do outro lado e é detectada — não por ser um bot,
 * mas por ser um bot mal-educado. Navegar no ritmo de leitura é o que torna a
 * coleta sustentável, e é o que um humano faria de fato.
 */
export function humanPause(minMs = 1_200, maxMs = 3_500): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Abre a janela para o login manual e espera você terminar.
 *
 * Retorna quando a URL sair da tela de autenticação — ou estoura o prazo, que
 * é generoso porque pode haver verificação em duas etapas no caminho.
 */
export async function openForLogin(url: string, doneWhen: RegExp, timeoutMs = 300_000): Promise<boolean> {
  await closeContext()
  const ctx = await getContext({ headless: false })
  const page = ctx.pages()[0] ?? (await ctx.newPage())

  await page.goto(url, { waitUntil: 'domcontentloaded' })

  try {
    await page.waitForURL(doneWhen, { timeout: timeoutMs })
    return true
  } catch {
    return false
  } finally {
    // O contexto NÃO é fechado: o perfil precisa continuar aberto para os
    // cookies serem gravados no disco antes da próxima execução.
  }
}
