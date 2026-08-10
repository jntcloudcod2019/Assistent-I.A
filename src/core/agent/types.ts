/**
 * A costura entre a interface e o cérebro do ALAN.
 *
 * Toda a UI (chat, timeline, avatar) consome apenas `AgentEvent`. Trocar o
 * agente mockado por um cliente real de LLM significa escrever outra classe
 * que implemente `AgentClient` — nenhum componente precisa mudar.
 */

export type AgentEvent =
  /** Uma etapa do raciocínio, exibida na timeline em tempo real. */
  | { type: 'status'; label: string }
  /** Um pedaço da resposta final, transmitido incrementalmente. */
  | { type: 'token'; text: string }
  /** O turno terminou com sucesso. */
  | { type: 'done' }
  /** Algo falhou; a UI mostra o erro e volta para idle. */
  | { type: 'error'; message: string }

export interface AgentClient {
  /**
   * Processa um comando do usuário e emite eventos conforme progride.
   * Deve parar de emitir e retornar quando `signal` for abortado.
   */
  send(prompt: string, signal: AbortSignal): AsyncIterable<AgentEvent>
}

/** Erro lançado internamente quando o turno é cancelado pelo usuário. */
export class AbortedError extends Error {
  constructor() {
    super('Turno cancelado')
    this.name = 'AbortedError'
  }
}
