# Workflow `alan/chat` no n8n

Passos para criar e ativar o workflow que o servidor chama quando
`N8N_CHAT_WEBHOOK_URL` está definida no `.env`.

Verificado contra a instância local: **n8n 2.34.4**.

---

## O ponto que quase deu errado — leia antes

O servidor espera SSE (`event:` / `data:`), mas **o n8n não fala SSE em
streaming.** No modo `responseMode: streaming` ele emite **NDJSON** — um objeto
JSON por linha (`active-executions.js`):

```js
httpResponse.write(JSON.stringify(chunk) + '\n')
```

Cada linha tem esta forma:

```json
{ "type": "item", "content": "Olá", "metadata": { "nodeName": "ALAN", "runIndex": 0, "itemIndex": 0 } }
```

com `type` ∈ `begin` | `item` | `end` | `error`.

Isso era um bug silencioso do pior tipo: sem fronteira `\n\n` o parser antigo
não renderia quadro nenhum, o turno terminaria com **resposta vazia e sem erro**
— e como nada era lançado, nem o fallback para o canal direto entraria.

Já corrigido em [`src/gateway/n8nChat.ts`](../src/gateway/n8nChat.ts): o parser
agora é orientado a linha e aceita os dois formatos, traduzindo o vocabulário
nativo do n8n para o nosso:

| n8n     | ALAN    |
| ------- | ------- |
| `begin` | ignorado (ruído de controle) |
| `item`  | `token` — `content` vira `text` |
| `end`   | `done`  |
| `error` | `error` — `content` vira `message` |

**Não é preciso um nó "Respond to Webhook".** Em `streaming` o n8n liga a
resposta HTTP direto no runtime (`webhook-helpers.js:567`) e o AI Agent
transmite nela.

---

## Caminho rápido — importar

1. **Crie a conta de dono.** Esta instância ainda está em primeira execução
   (`showSetupOnFirstLoad: true`). Abra <http://localhost:5678>, crie o
   e-mail/senha do owner e conclua o onboarding. Sem isso nada é salvo.

2. **Importe** [`alan-chat.workflow.json`](alan-chat.workflow.json):
   menu `⋯` no canto superior direito → **Import from File**.

3. **Credencial do Google Gemini.** Abra o nó *Google Gemini Chat Model* →
   **Credential to connect with** → **Create new** → cole a chave obtida em
   <https://aistudio.google.com/apikey>.

   > **Grátis e sem cartão.** No plano gratuito: 250 requisições/dia no Flash,
   > 250 mil tokens/min e contexto de 1M.
   >
   > Duas ressalvas que valem saber: no plano gratuito o Google pode usar as
   > conversas para treinar seus modelos, e **ligar o faturamento no projeto
   > apaga o plano gratuito** — a partir daí tudo passa a ser cobrado.

4. **Escolha o modelo** no campo *Model*. O JSON já vem com
   `models/gemini-2.5-flash`, que é o equilíbrio certo de qualidade e limite.

### Trocando de provedor

O workflow não depende do Gemini: apague o nó de modelo, adicione outro
(*Groq*, *Ollama*, *OpenRouter*, *Mistral*, *DeepSeek*…) e ligue-o na entrada
`ai_languageModel` do Agent. O resto do workflow não muda.

> Se você já importou a versão com Anthropic, **não precisa reimportar** —
> reimportar registraria o webhook de novo. Apague só o nó *Anthropic Chat
> Model*, adicione o *Google Gemini Chat Model*, ligue no Agent e publique.

5. **Ative** no toggle *Inactive → Active*, canto superior direito. É o toggle
   que registra a URL de produção `/webhook/…`; sem ele só existe a de teste.

---

## Caminho manual — criando os nós

Se preferir montar à mão em vez de importar:

### 1. Nó **Webhook**

| Campo             | Valor         |
| ----------------- | ------------- |
| HTTP Method       | `POST`        |
| Path              | `alan/chat`   |
| **Respond**       | **`Streaming`** ← sem isto não há token a token |

O caminho **não** leva `/webhook` na frente: o n8n prefixa sozinho, e a URL de
produção sai `http://127.0.0.1:5678/webhook/alan/chat` — exatamente o que está
no `.env`.

### 2. Nó **AI Agent**

- **Source for Prompt** → `Define below`
- **Prompt** — o histórico vem no corpo, então renderize-o junto:

  ```
  {{ ($json.body.history || []).map(m => (m.role === 'user' ? 'Usuário' : 'ALAN') + ': ' + m.content).join('\n') }}

  Usuário: {{ $json.body.userText }}
  ```

- **Options → System Message** — vale escrever para *ser ouvido*, já que a
  resposta vira áudio e anima o rosto: frases curtas, sem markdown, sem emoji,
  sem listas com marcadores.
- **Options → Enable Streaming** — já vem `true`; só confirme que não foi
  desligada.

### 3. Nó **Anthropic Chat Model**

Conecte na entrada `ai_languageModel` do Agent (o conector de baixo) e
configure a credencial.

### 4. Ative o workflow.

---

## O segundo workflow: `alan/classify`

Sem ele **toda conversa é nível 1** e o Redis nunca recebe nada, por mais que
esteja no ar — foi exatamente o que aconteceu aqui: Redis subiu saudável e
`DBSIZE` continuou `0` depois de um turno inteiro.

Importe [`alan-classify.workflow.json`](alan-classify.workflow.json) do mesmo
jeito e ative. Ele **não precisa de credencial**: é um nó Code com heurística,
determinístico e sem custo, que roda uma vez por conversa nova dentro de um
timeout de 10s.

| Sinal no texto | Nível | Onde mora |
| -------------- | ----- | --------- |
| `lembre`, `me chamo`, `de agora em diante`, `prefiro` | 3 | MongoDB |
| saudação/agradecimento solto (`oi`, `obrigado`, `tchau`) | 1 | lugar nenhum |
| o resto | 2 | Redis, TTL de 24h |

Responde `{ "tier": 1 \| 2 \| 3 }` em `responseMode: lastNode` — síncrono, não
streaming. Troque o nó Code por um de LLM quando a classificação precisar de
nuance; o contrato de resposta é o mesmo.

> Detalhe que custou um teste: em regex JS, `\b` depois de `é` **nunca casa** —
> acentuada não é caractere de palavra, então não existe fronteira entre `é` e o
> espaço, e `"meu nome é Jonathan"` escapava para o nível 2. Palavras soltas
> levam `\b`; frases, não.

---

## O workflow de vagas: `alan/jobs-collect`

[alan-jobs-collect.workflow.json](alan-jobs-collect.workflow.json) — agenda a
cada 3 h, busca em Remotive e Arbeitnow, normaliza, pontua por heurística e
manda para `POST /api/jobs`. Importe e publique do mesmo jeito que os outros.

**Leia isto antes de contar com ele.** Ele funciona, mas **não encontra vagas
.NET**: essas duas APIs concentram startups de JS/Python e mercado alemão.
Medido — 191 vagas, **zero** menções a .NET ou C#, nem em descrição. O mesmo
vale para Jobicy, Himalayas, Greenhouse e Lever, testados depois.

Ele fica no repositório por dois motivos: serve se você buscar Node/TypeScript
um dia, e o nó de normalização é reaproveitável — trocar os dois nós de HTTP
por um de Gmail mantém o resto igual.

**Para vaga .NET brasileira**, a fonte é o LinkedIn, coletado pelo próprio
servidor com Playwright (`POST /api/collect/linkedin`), não por este workflow.
Ele exige sessão: use **Entrar no LinkedIn** no painel de processos seletivos.

Uma armadilha que custou uma depuração: `preScore` é calculado no nó Code e
**descartado** — nem `parseJob` o persiste, nem o schema tem o campo. A ideia
era filtrar barato antes de gastar o modelo; falta ligar as pontas.

---

## Por que o workflow de chat é stateless

O corpo que o servidor envia é:

```json
{ "conversationId": "…|null", "tier": 1, "userText": "…", "history": [ { "role": "user", "content": "…" } ] }
```

A memória é do **servidor**, não do n8n — é ele que decide o nível (1 stateless,
2 Redis, 3 MongoDB) e manda o histórico pronto. Por isso o workflow **não** leva
nó de Memory: se levasse, haveria duas fontes de verdade divergindo.

---

## Verificação

Direto no n8n, sem passar pelo ALAN:

```bash
curl -N -X POST http://127.0.0.1:5678/webhook/alan/chat -H 'Content-Type: application/json' -d '{"conversationId":null,"tier":null,"userText":"Diga olá em cinco palavras.","history":[]}'
```

Esperado — uma linha JSON por vez, chegando aos poucos:

```
{"type":"begin","metadata":{…}}
{"type":"item","content":"Olá","metadata":{…}}
{"type":"end","metadata":{…}}
```

Se vier `{"message":"Workflow could not be started!"}`, falta a credencial.
Se vier 404 com *"not registered"*, falta **ativar** o toggle.

Depois, ponta a ponta:

```bash
curl -s http://127.0.0.1:3001/api/health
```

`"channel"` deve ser `"n8n"`. Então mande uma mensagem pelo chat em
<http://localhost:5173> e confirme que a resposta **não** é o eco.

O teste que separa conversa de frases soltas: pergunte algo, depois **"e o que
falta?"** — a segunda resposta precisa mostrar que o histórico chegou ao modelo.
Isso só funciona a partir do nível 2, que hoje está degradado (sem `REDIS_URL`).
