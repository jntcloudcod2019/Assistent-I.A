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

3. **Credencial da Anthropic.** Abra o nó *Anthropic Chat Model* → campo
   **Credential to connect with** → **Create new** → cole a chave `sk-ant-…`.

   > Sua chave é da **Anthropic**, não da OpenAI — por isso o workflow usa o nó
   > *Anthropic Chat Model*. Uma `sk-ant-…` em `OPENAI_API_KEY` daria 401.
   >
   > Ela também foi colada em texto puro no chat. **Rotacione depois que
   > funcionar.**

4. **Escolha o modelo** no dropdown (a lista vem da sua conta). O JSON já vem
   com um valor; se a sua chave não tiver acesso a ele, o dropdown mostra os
   que tem.

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
