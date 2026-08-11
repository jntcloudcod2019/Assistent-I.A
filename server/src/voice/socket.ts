import type { FastifyInstance } from 'fastify'

import { Vad } from './vad.js'
import type { SttProvider } from '../stt/types.js'

/**
 * Canal de voz: áudio sobe, texto desce.
 *
 * WebSocket e não SSE porque aqui o fluxo é de mão dupla — os frames do
 * microfone sobem continuamente enquanto os eventos descem. O restante do
 * turno (texto → resposta) continua em `/api/chat` por SSE, sem mudança: este
 * canal resolve só a metade que faltava.
 *
 * Protocolo — o cliente envia:
 *   · quadros binários  PCM mono 16 kHz int16 LE, direto do microfone
 *   · {"type":"stop"}   encerra o enunciado em curso sem esperar o silêncio
 *
 * e recebe:
 *   · {"type":"ready"}                 modelo carregado, pode falar
 *   · {"type":"speech-start"}          voz detectada
 *   · {"type":"transcript","text":""}  enunciado transcrito
 *   · {"type":"error","message":""}    falha digna de aparecer na tela
 */

export function registerVoiceRoute(app: FastifyInstance, stt: SttProvider) {
  app.get('/api/voice', { websocket: true }, (socket) => {
    const vad = new Vad()
    const controller = new AbortController()

    // Transcrições em fila: dois enunciados seguidos não podem chegar
    // trocados, e o Whisper não ganha nada rodando dois de uma vez num M2.
    let queue: Promise<void> = Promise.resolve()

    const send = (payload: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
    }

    // Um buffer vazio só percorre o caminho até o modelo estar carregado — o
    // aquecimento e o aviso de prontidão são a mesma chamada. Assim o modelo
    // sobe enquanto a pessoa fala a primeira frase, e não depois do silêncio.
    void stt
      .transcribe(Buffer.alloc(0), controller.signal)
      .then(() => send({ type: 'ready' }))
      .catch(() => {})

    const transcribe = (pcm: Buffer) => {
      queue = queue.then(async () => {
        if (controller.signal.aborted) return
        try {
          const text = await stt.transcribe(pcm, controller.signal)
          if (text) send({ type: 'transcript', text })
        } catch (error) {
          if (controller.signal.aborted) return
          app.log.warn({ err: error }, 'transcrição falhou')
          send({
            type: 'error',
            message:
              error instanceof Error
                ? `Não consegui transcrever: ${error.message}`
                : 'Não consegui transcrever o áudio.',
          })
        }
      })
    }

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        for (const event of vad.push(data)) {
          if (event.type === 'speech-start') send({ type: 'speech-start' })
          else transcribe(event.pcm)
        }
        return
      }

      try {
        const message = JSON.parse(data.toString()) as { type?: string }
        if (message.type === 'stop') {
          const pcm = vad.flush()
          if (pcm) transcribe(pcm)
        }
      } catch {
        // Quadro de texto malformado não derruba a conexão de áudio.
      }
    })

    socket.on('close', () => controller.abort())
    socket.on('error', () => controller.abort())
  })
}
