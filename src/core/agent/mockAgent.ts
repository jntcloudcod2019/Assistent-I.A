import type { AgentClient, AgentEvent } from './types'

/**
 * Agente mockado — nenhum LLM envolvido.
 *
 * Reproduz a *forma* de um turno real (etapas de raciocínio, depois resposta em
 * streaming) com atrasos plausíveis, para que a interface possa ser construída e
 * avaliada antes do cérebro existir. Ver `types.ts` para a costura de troca.
 */

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

const rand = (min: number, max: number) => min + Math.random() * (max - min)

interface Scenario {
  /** Palavras que ativam este cenário. */
  match: RegExp
  steps: string[]
  reply: string
}

const SCENARIOS: Scenario[] = [
  {
    match: /\b(tarefa|tarefas|agenda|compromisso|hoje|hoj[eê])\b/i,
    steps: [
      'Interpretando intenção do comando',
      'Consultando agenda local',
      'Cruzando com prazos pendentes',
      'Ordenando por prioridade',
    ],
    reply:
      'Você tem três compromissos hoje. Às nove e trinta, revisão de arquitetura do HyperLedger. Ao meio-dia, almoço com a equipe de produto. Às dezesseis horas, entrega da versão beta do portfólio. Há também duas tarefas atrasadas de ontem que sugiro reagendar para amanhã de manhã.',
  },
  {
    match: /\b(github|reposit[óo]rio|commit|pull request|pr)\b/i,
    steps: [
      'Interpretando intenção do comando',
      'Autenticando no GitHub',
      'Varrendo repositórios ativos',
      'Resumindo atividade recente',
    ],
    reply:
      'Módulo GitHub ainda não conectado nesta build. Quando as credenciais forem configuradas, eu poderei listar seus repositórios, revisar pull requests abertos e resumir os commits da semana. Por ora, opero apenas com conhecimento local.',
  },
  {
    match: /\b(email|e-mail|gmail|caixa de entrada|mensagens)\b/i,
    steps: [
      'Interpretando intenção do comando',
      'Solicitando acesso ao Gmail',
      'Verificando permissões',
    ],
    reply:
      'Não tenho acesso à sua caixa de entrada nesta build. O conector de e-mail está desligado por padrão até que você autorize explicitamente o escopo de leitura.',
  },
  {
    match: /\b(relat[óo]rio|resumo|documento|pdf|planilha)\b/i,
    steps: [
      'Interpretando intenção do comando',
      'Coletando fontes de dados',
      'Estruturando seções do documento',
      'Gerando prévia do relatório',
    ],
    reply:
      'Rascunho estruturado em quatro seções: sumário executivo, metodologia, resultados e recomendações. Estimo doze páginas com os dados disponíveis. Quer que eu priorize profundidade técnica ou clareza para leitores não técnicos?',
  },
  {
    match: /\b(pesquis|busca|procur|navegar|internet|web)\w*\b/i,
    steps: [
      'Interpretando intenção do comando',
      'Formulando consultas de busca',
      'Navegando resultados',
      'Verificando confiabilidade das fontes',
      'Sintetizando achados',
    ],
    reply:
      'A navegação web está desativada nesta build de interface. Assim que o módulo for habilitado, eu poderei abrir páginas, extrair conteúdo e cruzar múltiplas fontes antes de responder, sempre citando de onde veio cada afirmação.',
  },
  {
    match: /\b(c[óo]digo|programa|fun[çc][ãa]o|bug|erro|compil)\w*\b/i,
    steps: [
      'Interpretando intenção do comando',
      'Analisando contexto do código',
      'Verificando padrões conhecidos',
      'Formulando correção',
    ],
    reply:
      'Posso analisar o trecho e propor uma correção. Envie o código junto com a mensagem de erro completa e, se possível, o que você esperava que acontecesse. Comparo o comportamento esperado com o observado antes de sugerir mudanças.',
  },
  {
    match: /\b(quem [ée] voc[êe]|seu nome|o que voc[êe] [ée]|se apresent)\w*\b/i,
    steps: ['Interpretando intenção do comando', 'Recuperando identidade do sistema'],
    reply:
      'Sou o ALAN — Assistente Linguístico e Analítico Neurodigital. Fui modelado em homenagem a Alan Turing, que em mil novecentos e cinquenta perguntou se máquinas podiam pensar. Eu não penso, mas processo linguagem e executo tarefas para você. No momento estou rodando em modo de interface, com o cérebro simulado.',
  },
  {
    match: /\b(turing|teste de turing|hist[óo]ria)\b/i,
    steps: ['Interpretando intenção do comando', 'Consultando base de conhecimento'],
    reply:
      'Alan Turing formalizou a noção de computação com a máquina que leva seu nome, ajudou a quebrar a cifra Enigma durante a guerra e propôs o jogo da imitação como critério prático para inteligência de máquina. Morreu em mil novecentos e cinquenta e quatro, aos quarenta e um anos.',
  },
  {
    match: /\b(status|sistema|diagn[óo]stico|como voc[êe] est[áa])\b/i,
    steps: ['Interpretando intenção do comando', 'Executando diagnóstico dos módulos'],
    reply:
      'Núcleo cognitivo online. Síntese de voz operacional. Reconhecimento de fala depende do navegador. Conectores externos — GitHub, Gmail, Cloud e navegação web — estão desligados nesta build. Renderização holográfica estável.',
  },
]

const FALLBACK: Omit<Scenario, 'match'> = {
  steps: [
    'Interpretando intenção do comando',
    'Buscando contexto relevante',
    'Formulando resposta',
  ],
  reply:
    'Registrei seu comando. Nesta build eu opero com um cérebro simulado, então respondo de forma genérica — a camada de linguagem real ainda não está conectada. A interface, o reconhecimento de voz e a síntese de fala já são reais e funcionais.',
}

function pickScenario(prompt: string): Omit<Scenario, 'match'> {
  return SCENARIOS.find((s) => s.match.test(prompt)) ?? FALLBACK
}

/**
 * Fatia o texto em pedaços de tamanho irregular, imitando a chegada de tokens.
 * Quebra em limites de palavra para o chat nunca exibir uma palavra partida.
 */
function* chunkText(text: string): Generator<string> {
  const words = text.split(/(\s+)/)
  let buffer = ''
  let target = Math.floor(rand(1, 4))
  let count = 0

  for (const word of words) {
    buffer += word
    if (word.trim()) count++
    if (count >= target) {
      yield buffer
      buffer = ''
      count = 0
      target = Math.floor(rand(1, 4))
    }
  }
  if (buffer) yield buffer
}

export class MockAgent implements AgentClient {
  async *send(prompt: string, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const scenario = pickScenario(prompt)

    // Fase de "raciocínio": etapas aparecendo uma a uma na timeline.
    for (const label of scenario.steps) {
      yield { type: 'status', label }
      await sleep(rand(280, 620), signal)
    }

    await sleep(rand(150, 320), signal)

    // Fase de resposta: tokens em streaming.
    for (const chunk of chunkText(scenario.reply)) {
      yield { type: 'token', text: chunk }
      await sleep(rand(18, 55), signal)
    }

    yield { type: 'done' }
  }
}

export const mockAgent = new MockAgent()
