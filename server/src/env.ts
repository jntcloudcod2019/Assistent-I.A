/**
 * Configuração lida do ambiente.
 *
 * Falhar no boot com uma mensagem clara é muito melhor que falhar na primeira
 * requisição com um stack trace do driver.
 */

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export const env = {
  port: Number(optional('PORT') ?? 3001),

  /** Ausente = servidor roda em memória, sem persistência. */
  databaseUrl: optional('DATABASE_URL'),

  openaiKey: optional('OPENAI_API_KEY'),
  openaiModel: optional('OPENAI_MODEL') ?? 'gpt-4o-mini',
}

export const hasDatabase = Boolean(env.databaseUrl)
export const hasModel = Boolean(env.openaiKey)
