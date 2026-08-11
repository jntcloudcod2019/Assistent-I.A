import { SAMPLE_RATE } from './types.js'

/**
 * Embrulha PCM cru num contêiner WAV.
 *
 * O `whisper-server` aceita áudio comprimido, mas só com `--convert`, que
 * chama ffmpeg — e ffmpeg não está instalado nesta máquina. Como nós mesmos
 * escolhemos o formato na captura (int16 mono 16 kHz), basta um cabeçalho de
 * 44 bytes para o arquivo virar WAV válido. Sai uma dependência inteira do
 * caminho crítico por causa de vinte linhas.
 *
 * Layout: RIFF/WAVE com um bloco `fmt ` PCM e um bloco `data`.
 */

const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const CHANNELS = 1

export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(HEADER_BYTES)
  const bytesPerSample = BITS_PER_SAMPLE / 8
  const blockAlign = CHANNELS * bytesPerSample

  header.write('RIFF', 0)
  // Tamanho do arquivo menos os 8 bytes de 'RIFF' + este próprio campo.
  header.writeUInt32LE(HEADER_BYTES - 8 + pcm.length, 4)
  header.write('WAVE', 8)

  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // tamanho do bloco fmt para PCM
  header.writeUInt16LE(1, 20) // 1 = PCM sem compressão
  header.writeUInt16LE(CHANNELS, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28) // bytes por segundo
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)

  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}
