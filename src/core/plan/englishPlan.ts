import type { Plan } from './types'

/**
 * Cronograma de inglês do zero funcional à fluência profissional.
 *
 * Calibrado para nível básico, 4 h por dia, 6 dias por semana — 44 semanas,
 * cerca de 1.050 horas. A referência do FSI para um falante de português é de
 * 600 a 750 horas de aula até proficiência de trabalho; partindo do básico e
 * em autoestudo, a margem maior cobre os platôs, que são certos.
 *
 * Três decisões que definem o formato:
 *
 * 1. **O dia é fatiado em seis blocos**, não em quatro horas de uma coisa só.
 *    Quatro horas da mesma modalidade no nível básico é o caminho mais curto
 *    para desistir na terceira semana — a fadiga chega antes do progresso.
 *
 * 2. **A produção oral começa na semana 1**, não depois de "aprender o
 *    suficiente". Quem adia falar até se sentir pronto nunca se sente pronto;
 *    o travamento vira hábito e leva mais tempo para desfazer do que o erro.
 *
 * 3. **O conteúdo técnico entra só na fase 2.** Ser engenheiro é vantagem real
 *    — conhecer o assunto tira metade da carga, sobra decodificar a língua —
 *    mas no básico a documentação usa estruturas que ainda não existem para
 *    você, e frustra em vez de acelerar.
 */
export const ENGLISH_PLAN: Plan = {
  id: 'english-fluency',
  title: 'Inglês até a fluência',
  why: 'Trabalhar, entrevistar e discutir arquitetura em inglês sem traduzir mentalmente.',
  startedAt: Date.now(),
  hoursPerDay: 4,
  daysPerWeek: 6,

  reminder: {
    enabled: true,
    at: '18:30',
    message: 'Jonathan, daqui a alguns minutos comece o seu estudo de inglês.',
    lastFiredOn: null,
  },

  dailyBlocks: [
    {
      minutes: 45,
      label: 'Leitura',
      detail:
        'Texto em que você entende ~95% sem dicionário. Acima disso é decifração, não leitura, e o ganho despenca. Volume importa mais que dificuldade.',
    },
    {
      minutes: 40,
      label: 'Vídeo',
      detail:
        'Legenda em INGLÊS, nunca em português — ler a tradução desliga o processamento da língua. A progressão é: com legenda, depois sem, depois assunto que você não domina.',
    },
    {
      minutes: 35,
      label: 'Escuta (áudio)',
      detail:
        'Sem apoio visual, que é mais difícil que vídeo: sem lábios nem contexto de imagem, sobra só o som. Ouvir, ler a transcrição, ouvir de novo sem ela.',
    },
    {
      minutes: 55,
      label: 'Fala',
      detail: '25 min de shadowing (repetir por cima do áudio, sem pausar) + 30 min de conversa ou monólogo gravado.',
    },
    {
      minutes: 35,
      label: 'Vocabulário',
      detail: 'Anki com repetição espaçada. Cartões com a frase inteira de onde a palavra veio, nunca a palavra solta.',
    },
    {
      minutes: 30,
      label: 'Escrita com gramática',
      detail:
        'Escrever usando a estrutura da semana. Gramática treinada na produção gruda; estudada em exercício isolado, evapora.',
    },
  ],

  phases: [
    {
      id: 'f1',
      title: 'Fundação',
      goal: 'Entender fala lenta sem legenda e formar frases próprias sem montar em português primeiro.',
      weeks: [1, 8],
      steps: [
        {
          id: 'f1s1',
          title: 'Os sons que o português não tem',
          detail:
            'Os pares que mudam sentido: ship/sheep, bad/bed, think/sink. Sem isso, os anos seguintes reforçam a pronúncia errada.',
          doneAt: null,
        },
        {
          id: 'f1s2',
          title: 'Matar a vogal de apoio',
          detail:
            'Português não termina sílaba em consoante, então sai "helpi", "facebooki", "aboutchi". Gravar-se lendo 20 palavras terminadas em consoante e comparar.',
          doneAt: null,
        },
        {
          id: 'f1s3',
          title: '500 palavras mais frequentes',
          detail: 'Cobrem cerca de 70% do inglês falado do dia a dia. Em frases, no Anki.',
          doneAt: null,
        },
        {
          id: 'f1s4',
          title: 'Presente simples e contínuo',
          detail: 'A diferença entre "I work" e "I am working" — o erro mais visível de brasileiro.',
          doneAt: null,
        },
        {
          id: 'f1s5',
          title: '100 verbos irregulares no passado',
          detail: 'Não decorar lista: usar cada um numa frase sobre a própria semana.',
          doneAt: null,
        },
        {
          id: 'f1s6',
          title: '30 horas de escuta graduada',
          detail: 'Material para aprendiz, com transcrição. Ainda não conteúdo nativo — seria ruído.',
          doneAt: null,
        },
        {
          id: 'f1s6a',
          title: 'Ler 8 graded readers (A1–A2)',
          detail:
            'Livros escritos com vocabulário controlado. Ler algo fácil e inteiro constrói mais que travar num texto nativo — e no básico é a única leitura que não vira tradução palavra a palavra.',
          doneAt: null,
        },
        {
          id: 'f1s6b',
          title: '25 horas de vídeo com legenda em inglês',
          detail:
            'Desenho infantil e séries simples funcionam melhor que conteúdo adulto: fala devagar, contexto visual forte, vocabulário repetitivo. Legenda em inglês sempre.',
          doneAt: null,
        },
        {
          id: 'f1s7',
          title: 'Primeira gravação de 2 minutos',
          detail: 'Falar sobre o próprio trabalho. Guardar o arquivo: é a régua para a semana 44.',
          doneAt: null,
        },
        {
          id: 'f1s8',
          title: 'Teste de nivelamento A2',
          detail: 'Confirmar a base antes de avançar. Reprovar aqui e seguir é construir sobre areia.',
          doneAt: null,
        },
      ],
    },
    {
      id: 'f2',
      title: 'Compreensão',
      goal: 'Acompanhar fala em ritmo natural sobre assunto conhecido e ler documentação técnica sem tradutor.',
      weeks: [9, 18],
      steps: [
        {
          id: 'f2s1',
          title: '2.000 palavras no núcleo ativo',
          detail: 'Chega a ~85% da fala cotidiana. O salto mais rentável de todo o plano.',
          doneAt: null,
        },
        {
          id: 'f2s2',
          title: 'Shadowing diário, 30 min',
          detail:
            'Repetir por cima do áudio, no mesmo ritmo, sem pausar. Treina ouvido e boca juntos — é o que mais acelera a fala.',
          doneAt: null,
        },
        {
          id: 'f2s3',
          title: 'Trocar a documentação para inglês',
          detail:
            'Aqui a vantagem de engenheiro entra: você já sabe o que o texto diz, então só decodifica a língua.',
          doneAt: null,
        },
        {
          id: 'f2s4',
          title: 'Tempos perfeitos',
          detail: '"I have worked" vs "I worked" — não existe equivalente direto em português, e por isso não se aprende por intuição.',
          doneAt: null,
        },
        {
          id: 'f2s5',
          title: '30 tech talks com legenda em inglês',
          detail:
            'Conferências reais. Você já entende o assunto, então a carga fica toda na língua — é o melhor custo-benefício de vídeo que existe para um engenheiro.',
          doneAt: null,
        },
        {
          id: 'f2s5a',
          title: 'Primeiro livro completo em inglês',
          detail:
            'Cerca de 200 páginas, ficção simples. Terminar um livro inteiro muda a relação com a língua: deixa de ser matéria de estudo e vira meio de acesso a algo que você queria.',
          doneAt: null,
        },
        {
          id: 'f2s5b',
          title: '20 horas de vídeo sem legenda',
          detail:
            'Reassistir o que já viu com legenda, agora sem. Perder detalhe é esperado — o objetivo é o ouvido parar de depender do texto.',
          doneAt: null,
        },
        {
          id: 'f2s6',
          title: 'Primeiras 10 sessões com tutor',
          detail: 'Duas por semana, 30 min. Falar com humano que corrige é insubstituível — é o item mais caro e o mais decisivo.',
          doneAt: null,
        },
        {
          id: 'f2s7',
          title: 'Commits e PRs em inglês',
          detail: 'Escrita real com público real. Erro em PR ensina mais que exercício corrigido.',
          doneAt: null,
        },
        { id: 'f2s8', title: 'Teste B1', detail: 'Confirmar antes de entrar na fase de produção.', doneAt: null },
      ],
    },
    {
      id: 'f3',
      title: 'Produção',
      goal: 'Conversar em tempo real sem montar as frases antes — inclusive quando não sabe a palavra exata.',
      weeks: [19, 30],
      steps: [
        {
          id: 'f3s1',
          title: 'Tutor 4× por semana',
          detail: 'Aumentar de 2 para 4. Esta fase é sobre volume de fala, não sobre estudar mais.',
          doneAt: null,
        },
        {
          id: 'f3s2',
          title: 'Contornar a palavra que falta',
          detail:
            'Explicar "chave de fenda" sem saber "screwdriver". É o que separa quem conversa de quem trava — e treina-se de propósito.',
          doneAt: null,
        },
        {
          id: 'f3s3',
          title: 'Daily em inglês',
          detail: 'Três minutos por dia, em pé, sem anotação. Se o time é em português, gravar sozinho.',
          doneAt: null,
        },
        {
          id: 'f3s4',
          title: 'Vocabulário técnico de code review',
          detail: '"nitpick", "edge case", "refactor", "trade-off", "blocker" — o inglês do seu dia real.',
          doneAt: null,
        },
        {
          id: 'f3s5',
          title: '3.000 palavras no núcleo',
          detail: 'A partir daqui o ganho por palavra cai; o esforço migra para uso, não para volume.',
          doneAt: null,
        },
        {
          id: 'f3s6',
          title: 'Apresentação técnica de 10 minutos',
          detail: 'Gravada. Explicar uma decisão de arquitetura, com perguntas ao final.',
          doneAt: null,
        },
        {
          id: 'f3s6a',
          title: 'Dois livros completos, um deles técnico',
          detail:
            'Um de ficção pelo prazer, um da sua área pelo vocabulário. Ler técnico em inglês é o que faz a documentação parar de ser obstáculo.',
          doneAt: null,
        },
        {
          id: 'f3s6b',
          title: 'Uma série inteira sem legenda',
          detail:
            'Temporada completa, mesmo elenco. A repetição de vozes e vocabulário ao longo dos episódios é o que faz o ouvido assentar — trocar de série toda semana desperdiça esse efeito.',
          doneAt: null,
        },
        {
          id: 'f3s7',
          title: 'Sotaques variados',
          detail: 'Indiano, britânico, australiano. Time distribuído não fala com locução de curso.',
          doneAt: null,
        },
        { id: 'f3s8', title: 'Teste B2', detail: 'O ponto em que o inglês vira ferramenta de trabalho.', doneAt: null },
      ],
    },
    {
      id: 'f4',
      title: 'Fluência profissional',
      goal: 'Trabalhar em inglês sem tradução mental, incluindo discordar, negociar e fazer humor.',
      weeks: [31, 44],
      steps: [
        {
          id: 'f4s1',
          title: 'Imersão nas ferramentas',
          detail: 'Sistema, telefone, buscas — tudo em inglês. Remove o retorno constante ao português.',
          doneAt: null,
        },
        {
          id: 'f4s2',
          title: 'Discordar sem ofender',
          detail:
            '"I see it differently", "have we considered". Registro profissional: tradução literal do português soa agressiva em inglês.',
          doneAt: null,
        },
        {
          id: 'f4s3',
          title: '5 entrevistas técnicas simuladas',
          detail: 'System design em inglês, com pressão de tempo. É o teste mais duro da fluência real.',
          doneAt: null,
        },
        {
          id: 'f4s4',
          title: 'Expressões idiomáticas de trabalho',
          detail: '"circle back", "low-hanging fruit", "ballpark". Não se deduzem — só se aprendem por exposição.',
          doneAt: null,
        },
        {
          id: 'f4s5',
          title: 'Escrita longa: RFC ou ADR',
          detail: 'Documento de decisão técnica em inglês, revisado por um nativo ou por um C1.',
          doneAt: null,
        },
        {
          id: 'f4s6',
          title: 'Escuta sem legenda',
          detail: 'Podcast nativo, velocidade normal, assunto fora da tecnologia. Sem apoio visual.',
          doneAt: null,
        },
        {
          id: 'f4s6a',
          title: 'Livro técnico completo da sua área',
          detail:
            'Um clássico de engenharia em inglês, lido inteiro. Vocabulário de arquitetura e argumentação técnica em texto denso — é a leitura que sustenta discutir decisão de projeto.',
          doneAt: null,
        },
        {
          id: 'f4s6b',
          title: 'Vídeo sobre assunto que você não domina',
          detail:
            'Documentário, esporte, culinária — sem legenda. Enquanto o conteúdo é técnico, o conhecimento prévio disfarça a lacuna de língua; fora dele não há como se apoiar.',
          doneAt: null,
        },
        {
          id: 'f4s7',
          title: 'Regravar os 2 minutos da semana 1',
          detail: 'Mesmo tema, mesma duração. Comparar com o original é a única prova incontestável.',
          doneAt: null,
        },
        {
          id: 'f4s8',
          title: 'Simulado C1',
          detail: 'Fecha o plano com uma medida externa, não com a própria impressão.',
          doneAt: null,
        },
      ],
    },
  ],
}
