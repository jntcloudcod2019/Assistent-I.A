import { spawn, type ChildProcess } from 'node:child_process'

import { pcmToWav } from './wav.js'
import { SAMPLE_RATE, type SttProvider } from './types.js'

/**
 * Transcrição local pelo whisper.cpp.
 *
 * Sobe o `whisper-server` como processo filho e conversa com ele por HTTP.
 * Poderia ser mais simples chamar `whisper-cli` a cada frase, mas aí o modelo
 * de 465 MB seria carregado do zero toda vez — 1 a 2 segundos colados na
 * frente de cada resposta, o que numa conversa falada é a diferença entre
 * fluido e travado. Como servidor, o modelo fica residente e a transcrição
 * começa na hora.
 *
 * O áudio nunca sai desta máquina.
 */

const READY_TIMEOUT_MS = 90_000
const READY_POLL_MS = 250

export interface WhisperOptions {
  modelPath: string
  port: number
  language: string
  /** Threads de decodificação. O M2 tem 8 núcleos; 4 deixa folga para o resto. */
  threads?: number
}

export function createWhisperCppProvider(options: WhisperOptions): SttProvider {
  const { modelPath, port, language, threads = 4 } = options
  const baseUrl = `http://127.0.0.1:${port}`

  let child: ChildProcess | null = null
  let ready: Promise<void> | null = null

  const spawnServer = async (): Promise<void> => {
    const proc = spawn(
      'whisper-server',
      [
        '--model', modelPath,
        '--host', '127.0.0.1',
        '--port', String(port),
        '--language', language,
        '--threads', String(threads),
        // Só o texto interessa; marcas de tempo virariam ruído a limpar depois.
        '--no-timestamps',
        // Suprime "(música)", "(risos)" e afins, que o Whisper inventa no
        // silêncio e que chegariam ao modelo como se fossem fala.
        '--suppress-nst',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )

    child = proc

    // O ggml despeja dezenas de linhas de inicialização no stderr. Guardamos
    // só a última, para ter o que mostrar se ele morrer.
    let lastError = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) lastError = line.split('\n').at(-1) ?? line
    })

    proc.on('exit', (code) => {
      // Zerar o estado é o que permite a próxima chamada tentar de novo em vez
      // de falar para sempre com um processo morto.
      child = null
      ready = null
      if (code !== 0 && code !== null) {
        console.warn(`[alan] whisper-server saiu com código ${code}: ${lastError}`)
      }
    })

    // Prontidão medida pela porta, e não por parsing do stdout: a mensagem de
    // boot muda entre versões, a porta não.
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!child) throw new Error(`whisper-server não subiu: ${lastError || 'processo encerrou'}`)
      try {
        await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
      }
    }

    proc.kill()
    throw new Error('whisper-server não respondeu a tempo (o modelo pode ser grande demais)')
  }

  const ensureReady = (): Promise<void> => {
    // Uma promessa compartilhada: várias chamadas durante o carregamento
    // esperam o mesmo boot em vez de subirem processos concorrentes.
    ready ??= spawnServer().catch((error) => {
      ready = null
      throw error
    })
    return ready
  }

  return {
    name: `whisper.cpp (${modelPath.split('/').at(-1)})`,

    async transcribe(pcm, signal) {
      await ensureReady()

      const form = new FormData()
      // `new Uint8Array(...)` e não o Buffer direto: o Blob exige uma view
      // sobre ArrayBuffer, e o Buffer do Node é tipado sobre ArrayBufferLike.
      const wav = new Uint8Array(pcmToWav(pcm, SAMPLE_RATE))
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'fala.wav')
      form.append('response_format', 'json')
      // Sem amostragem: numa transcrição a criatividade só produz erro.
      form.append('temperature', '0')

      const response = await fetch(`${baseUrl}/inference`, {
        method: 'POST',
        body: form,
        signal,
      })

      if (!response.ok) {
        throw new Error(`whisper-server respondeu ${response.status}`)
      }

      const body = (await response.json()) as { text?: unknown }
      return typeof body.text === 'string' ? body.text.trim() : ''
    },

    async close() {
      child?.kill()
      child = null
      ready = null
    },
  }
}
