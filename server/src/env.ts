/**
 * Configuração lida do ambiente.
 *
 * Falhar no boot com uma mensagem clara é muito melhor que falhar na primeira
 * requisição com um stack trace do driver.
 */

import { fileURLToPath } from 'node:url'

import { L2_DEFAULT_TTL_SECONDS } from './conversation/tiers.js'

/**
 * Carrega o `.env` ao lado do servidor.
 *
 * Sem isto nada aqui lê o arquivo: `tsx` não o carrega sozinho e não há
 * `dotenv` no projeto. A ausência passava despercebida porque `PORT` e
 * `OPENAI_MODEL` no arquivo coincidem com os defaults do código — dava a
 * impressão de estar sendo lido enquanto `DATABASE_URL`, `OPENAI_API_KEY` e as
 * variáveis do n8n eram silenciosamente ignoradas.
 *
 * `process.loadEnvFile` é nativo do Node (≥ 20.12) e não sobrescreve variáveis
 * já presentes no ambiente, então o que vem do shell continua vencendo o
 * arquivo — que é a precedência esperada em produção.
 */
function loadEnvFile() {
  // `fileURLToPath`, e não `URL.pathname`: o pathname vem percent-encodado, e
  // este projeto vive num diretório com espaço ("Assistent I.A"). Com
  // `.pathname` o caminho chega como `/Assistent%20I.A/...`, o arquivo não é
  // encontrado e o ENOENT some no catch — o mesmo bug silencioso, de novo.
  const path = fileURLToPath(new URL('../.env', import.meta.url))
  try {
    process.loadEnvFile(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // Sem arquivo é um cenário legítimo: em produção as variáveis vêm do
    // ambiente. Qualquer outra falha (arquivo ilegível, sintaxe inválida)
    // precisa aparecer, senão vira exatamente o bug silencioso de antes.
    if (code !== 'ENOENT') {
      console.warn(`[alan] .env não pôde ser lido: ${(error as Error).message}`)
    }
  }
}

loadEnvFile()

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export const env = {
  port: Number(optional('PORT') ?? 3001),

  /** Ausente = servidor roda em memória, sem persistência. */
  databaseUrl: optional('DATABASE_URL'),

  /** Memória de curto prazo (nível 2). Ausente = nível 2 degrada para stateless. */
  redisUrl: optional('REDIS_URL'),
  redisTtlSeconds: Number(optional('REDIS_TTL') ?? L2_DEFAULT_TTL_SECONDS),

  /** Canal de conversa via n8n. Ausente = conversa direta com o modelo. */
  n8nChatWebhookUrl: optional('N8N_CHAT_WEBHOOK_URL'),
  n8nWebhookSecret: optional('N8N_WEBHOOK_SECRET'),

  /** Classificação de memória (nível 1/2/3) no n8n. Ausente = tudo stateless. */
  n8nClassifyWebhookUrl: optional('N8N_CLASSIFY_WEBHOOK_URL'),

  /**
   * Modelo do canal direto, em qualquer API compatível com a da OpenAI.
   *
   * Os nomes `LLM_*` vieram depois: `OPENAI_*` passou a mentir quando a mesma
   * configuração começou a servir Gemini, Groq e Ollama. Os antigos seguem
   * funcionando como apelido para não quebrar `.env` já escritos.
   */
  llmKey: optional('LLM_API_KEY') ?? optional('OPENAI_API_KEY'),
  llmModel: optional('LLM_MODEL') ?? optional('OPENAI_MODEL') ?? 'gemini-2.5-flash',
  /** Vazio fala com a OpenAI; preenchido, com qualquer outro compatível. */
  llmBaseUrl: optional('LLM_BASE_URL') ?? optional('OPENAI_BASE_URL'),

  /**
   * Transcrição local (whisper.cpp). Ausente = canal de voz desligado e a
   * conversa segue por texto.
   */
  whisperModel: optional('WHISPER_MODEL'),
  whisperPort: Number(optional('WHISPER_PORT') ?? 8188),
  whisperLanguage: optional('WHISPER_LANGUAGE') ?? 'pt',
}

export const hasDatabase = Boolean(env.databaseUrl)
export const hasModel = Boolean(env.llmKey)
export const hasRedis = Boolean(env.redisUrl)
export const hasN8n = Boolean(env.n8nChatWebhookUrl)
export const hasVoice = Boolean(env.whisperModel)
