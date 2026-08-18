/**
 * Leitor de Server-Sent Events.
 *
 * Extraído porque já havia dois parsers idênticos no front — um no
 * `httpAgent`, outro prestes a nascer na coleta de vagas. Duas cópias são
 * toleráveis entre projetos independentes; três dentro do mesmo pacote são
 * três lugares para corrigir quando o buffer estiver errado.
 *
 * O buffer é o ponto inteiro: um chunk da rede não respeita a fronteira das
 * mensagens — pode trazer meio evento, ou dois e meio. Sem acumular, o parse
 * quebra de forma intermitente, no meio de respostas longas, que é o pior
 * modo de falhar porque não reproduz.
 */

export interface SseFrame {
  event: string
  data: string
}

export async function* readSse(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<SseFrame> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')

        let event = 'message'
        const dataLines: string[] = []
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length) yield { event, data: dataLines.join('\n') }
      }
    }
  } finally {
    // Cancelar solta a conexão quando quem consome desiste no meio; sem isso o
    // servidor continua produzindo para ninguém.
    reader.cancel().catch(() => {})
  }
}

/** Lê o `data` como JSON, devolvendo `null` em quadro malformado. */
export function parseFrame<T>(frame: SseFrame): T | null {
  try {
    return JSON.parse(frame.data) as T
  } catch {
    return null
  }
}
