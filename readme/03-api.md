# 03 · API

[← sumário](README.md)

Base: `http://127.0.0.1:7788`. Tudo é JSON, sem autenticação (só escuta local —
veja [07](07-seguranca.md)).

## Meta

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/_health` | ping: `{ ok, uptime }` |
| GET | `/api/_services` | serviços registrados, rotas, resumos, `root` (dentro do container) e `hostRoot` (raiz na máquina) |

`/api/_services` é a documentação viva: o painel **Serviços** só desenha o que
essa rota devolve. `root` é a raiz **dentro** do container (`/app`); `hostRoot` é a pasta
do repositório **na máquina** — o indicador de status usa esse para montar o comando de
ligar (`cd <hostRoot> && ./docker-app.sh`), que é o único que faz sentido de fora.

## Sistema

Controle do próprio processo — usado pelo indicador de status no rodapé
([`server-status`](11-componentes.md#server-statusjs)).

| Método | Rota | O quê |
| --- | --- | --- |
| POST | `/api/_server/stop` | responde `{ ok, stopping }` e encerra o processo |
| POST | `/api/_server/restart` | responde `{ ok, restarting }` e encerra com código 1 — o Docker sobe de novo |

`restart` depende da política do container (`restart: on-failure` no compose): sair com
código 1 é o pedido de "me suba de novo", e o ambiente vem do compose outra vez. `stop`
sai com 0 justamente para **não** ser ressuscitado. **Religar de fora** não é possível pela
API — nada está escutando; use `./docker-app.sh`.

## Sessões

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/sessions?q=` | sessões do Claude em execução |
| POST | `/api/sessions/:pid/kill` | encerra uma sessão |

```bash
curl -s localhost:7788/api/sessions | head -20
```

```json
{
  "items": [
    {
      "pid": 30498,
      "ppid": 30455,
      "tty": "pts/2",
      "uptime": "37:12",
      "uptimeSeconds": 2232,
      "cwd": "/home/fernando",
      "command": "claude",
      "kind": "interactive",
      "conversationId": "57316179-7a65-49bc-940d-ce557e574dfa",
      "conversationSource": "guess"
    }
  ]
}
```

`conversationSource` diz **de onde saiu** o `conversationId` — e sem isso quem consome
trata palpite como fato:

| valor | significa | de onde vem |
| --- | --- | --- |
| `args` | **certeza**: é a conversa que aquele processo abriu | o próprio comando: `--resume <id>`, `-r <id>`, `--session-id <id>` |
| `guess` | **palpite**: pode ser outra | o `.jsonl` mais recente da pasta do projeto correspondente ao `cwd` |
| `null` | não se sabe | sem `cwd` legível e sem id no comando |

O Claude **não** mantém o transcript aberto num descritor (conferido em
`/proc/<pid>/fd`: só tty, epoll e `/dev/urandom`), e um `claude` cru do terminal não
declara id nenhum — então para ele não existe ligação exata processo → conversa. Daí a
etiqueta, em vez de fingir precisão.

`kind` separa **`interactive`** (alguém digitando num terminal) de **`headless`**
(`-p`/`--print` — é o que o chat *deste painel* dispara a cada mensagem). Sem isso os
próprios processos do painel apareciam como "sessão aberta num terminal".

> **Por que isso importa.** O aviso "esta conversa está aberta num terminal" era disparado
> pelo palpite. Criar uma conversa pelo navegador torna o `.jsonl` dela o mais recente da
> pasta — então o terminal que estava ali virava "dono" da conversa recém-criada, e a
> interface avisava sobre um conflito que não existia. Hoje **só `args` avisa**: sem
> certeza a interface fica calada, nem com um aviso hedged ("tem um Claude nesta pasta"),
> que foi tentado e removido por ser barulho. Ver [06 · Interface](06-interface.md).
>
> Consequência aceita: um `claude` cru num terminal **nunca** dispara o aviso. Preferimos
> não avisar a avisar errado — quem quiser a proteção abre o terminal com
> `claude --resume <id>`.

`q` filtra por PID, tty, `cwd`, comando e id da conversa, ignorando acentos e
maiúsculas.

```bash
curl -s -X POST localhost:7788/api/sessions/30498/kill \
  -H 'content-type: application/json' -d '{"signal":"SIGTERM"}'
```

```json
{ "pid": 30498, "signal": "SIGTERM", "alive": false, "session": { "...": "..." } }
```

`alive: true` significa que o processo ignorou o sinal — a interface então oferece
`SIGKILL`. Sinais aceitos: `SIGTERM` (padrão), `SIGINT`, `SIGKILL`.

## Conversas

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/conversations?q=` | lista as transcrições |
| GET | `/api/conversations/:id?limit=20&before=` | janela de mensagens (leitura paginada) |
| GET | `/api/conversations/:id/agents/:ref?limit=400` | **os passos de um subagente**: o que ele fez, em blocos |
| POST | `/api/conversations/:id/rename` | renomeia (`{ "name": "..." }`) — o mesmo que `/rename` |
| DELETE | `/api/conversations/:id` | move para a lixeira |
| GET | `/api/conversations/trash` | lista a lixeira |
| POST | `/api/conversations/trash/restore` | restaura (`{ "name": "..." }`) |
| POST | `/api/conversations/trash/purge` | apaga de vez o que é mais velho que a retenção |

O `:id` é composto: `<pastaDoProjeto>:<sessionId>`, por exemplo
`-home-fernando:57316179-7a65-49bc-940d-ce557e574dfa`. Isso evita ambiguidade
quando dois projetos têm arquivos de mesmo nome. Ao usar em URL, passe por
`encodeURIComponent`.

```json
{
  "items": [
    {
      "id": "-home-fernando:1eb08e33-1023-4abf-ac8b-f4fe929089b1",
      "sessionId": "1eb08e33-1023-4abf-ac8b-f4fe929089b1",
      "project": "/home/fernando",
      "projectLabel": "fernando",
      "projectDir": "-home-fernando",
      "name": "Configurar SSH no GitHub",
      "title": "estou no github criei uma chave ssh, como faço…",
      "messages": 19,
      "bytes": 61234,
      "modifiedAt": "2026-08-18T13:36:02.000Z",
      "startedAt": "2026-08-18T13:32:17.043Z",
      "lastAt": "2026-08-18T13:36:01.500Z",
      "model": "claude-opus-5[1m]"
    }
  ]
}
```

- `name` é o nome de exibição do `/rename` (o último `custom-title` do transcript),
  ou `null` se a conversa nunca foi renomeada.
- `title` é a primeira mensagem **humana** da conversa (ignora
  `<system-reminder>`, `Caveat:` e mensagens de ferramenta).
- `messages` conta entradas `user` + `assistant` do arquivo; já a leitura
  (`GET /:id`) devolve `total` só das mensagens legíveis — por isso os dois números
  podem diferir.
- A lista é cacheada por `mtime`: reler é barato, e o cache se invalida sozinho
  quando o arquivo muda.

Leitura paginada (é assim que o leitor do painel funciona):

```bash
ID=$(curl -s localhost:7788/api/conversations | python3 -c 'import json,sys;print(json.load(sys.stdin)["items"][0]["id"])')
curl -s "localhost:7788/api/conversations/$ID"                # últimas 20
curl -s "localhost:7788/api/conversations/$ID?before=90"       # as 20 anteriores à 90
curl -s "localhost:7788/api/conversations/$ID?limit=5&before=5"
```

```json
{
  "meta": { "...": "igual ao item da lista" },
  "total": 110,
  "from": 90,
  "to": 110,
  "hasMore": true,
  "agents": [
    { "id": "toolu_03…", "name": "Lane 2 colisão e tenant", "agentType": "general-purpose",
      "startedAt": "2026-…" }
  ],
  "messages": [
    {
      "index": 90, "role": "user", "at": "2026-…", "human": true, "fromCli": false,
      "blocks": [{ "kind": "text", "text": "solte as três frentes" }]
    },
    {
      "index": 91, "role": "assistant", "at": "2026-…", "human": false, "fromCli": false,
      "blocks": [
        { "kind": "text", "text": "Vou escrever o contrato antes de despachar:" },
        {
          "kind": "tool",
          "id": "toolu_01…", "name": "Bash", "summary": "Listar arquivos",
          "input": "{\n  \"command\": \"ls -la\"\n}", "inputTruncated": false,
          "result": { "text": "total 20\ndrwxrwxr-x …", "truncated": false, "isError": false }
        },
        {
          "kind": "agent",
          "id": "toolu_02…", "name": "Lane 1 resolução do tipo",
          "agentType": "general-purpose", "model": "opus",
          "running": false, "status": "completed",
          "summary": "Agent \"Lane 1\" finished", "report": "Lane 1 fechada. Rubocop limpo.",
          "startedAt": "2026-…", "durationMs": 726000
        }
      ]
    }
  ]
}
```

**Uma mensagem vem em `blocks`, na ordem em que as coisas aconteceram.** Três tipos:

| `kind` | O quê |
| --- | --- |
| `text` | prosa. É o que vai na caixa de mensagem — e **só** isso |
| `tool` | uma chamada de ferramenta: `input` (o pedido, já em texto), `result` (o que voltou, ou `null` se ainda não voltou), `summary` (a frase curta do chip) |

Cada mensagem traz também **quem escreveu**, e os dois campos respondem coisas diferentes:

- `human: true` — a pessoa digitou (o transcript marca `origin.kind === 'human'`). É o que
  escolhe o `title` da conversa;
- `fromCli: true` — o **CLI** escreveu e gravou no turno do usuário: é a saída de um comando
  local (`/context`, `/cost`) ou um prompt que ele injetou (`isMeta` no transcript). Vem em
  **markdown**, e é por isso que a tela o formata mesmo com `role: 'user'` — sem isso, a
  saída do `/context` aparecia com `##` e `|---|` na cara (ver
  [11 · Componentes](11-componentes.md#o-corpo-da-bolha-markdown-para-o-claude-texto-cru-para-você)).

Uma mensagem digitada tem `human: true, fromCli: false`; a resposta do Claude, os dois
`false` (ela é formatada pelo papel, não por marca).

### Os passos de um subagente

O trabalho de um agente **não está** no arquivo da conversa — medido: zero entradas de
sidechain em 923 transcritos. O CLI grava cada subagente num arquivo próprio, ao lado:
`~/.claude/projects/<projeto>/<sessão>/subagents/agent-<agentId>.jsonl`, no mesmo formato.
Por isso a rota devolve **os mesmos blocos** de uma conversa, e a tela os desenha com os
mesmos componentes.

```bash
# `:ref` é o id do DISPARO (o `id` do bloco `agent`) — o servidor traduz para o arquivo
curl -s "localhost:7788/api/conversations/$ID/agents/toolu_013TJf…?limit=5"
# { "ref": "toolu_013TJf…",
#   "meta": { "agentType": "general-purpose", "description": "Por que o /resume não lista", "model": "opus" },
#   "lastActivityAt": "2026-08-25T14:48:44.984Z",   ← última vez que ele escreveu algo
#   "total": 37, "from": 32,                        ← veio cortado: mostra os últimos 5
#   "messages": [ { "role": "assistant", "blocks": [ … ] } ] }
```

O **id estável** do agente nunca vai para a tela (o próprio CLI pede isso), então o pedido
é pelo id do disparo e a tradução acontece no servidor, pelo `toolUseId` que está no
`.meta.json` de cada agente. Agente cujo arquivo o CLI já limpou responde **404** com
"os passos deste agente não estão mais no disco" — e não um 404 genérico de conversa.

| `agent` | um subagente: `name` é o que ele foi fazer, `running` diz se ainda está de pé, `report`/`summary` é o que ele devolveu, `durationMs` quanto levou e `status` como terminou (`completed`, `failed`, `killed`, `stopped` — ou **`unknown`** = sem aviso de fim no arquivo). **Aviso de fim = parou**, qualquer status: só `running` mantém de pé. Sem aviso, quem julga é o transcrito do próprio agente — daí `summary: 'terminou (sem aviso no arquivo)'` com o relatório tirado da última fala dele |

Por que blocos, e não `text` + `tools` como antes: empilhar as ferramentas no pé da
mensagem embrulhava numa caixa o que o terminal mostra separado, **trocava a ordem** (a
chamada que veio antes do parágrafo aparecia depois dele) e enterrava um agente de doze
minutos dentro de uma mensagem já terminada.

- o par chamada/resultado é casado pelo `id` (o `tool_use_id` do CLI): o resultado vive
  numa entrada `user` do `.jsonl`, e a leitura o costura de volta na chamada em vez de
  virar uma mensagem solta;
- **agente não é ferramenta.** O `tool_result` de um agente de segundo plano é só o aceite
  do disparo ("Async agent launched successfully"); o trabalho chega muito depois, num
  `<task-notification>` que casa pelo mesmo `id` — e é dali que saem `report`, `summary` e
  `status`. Tratar o aceite como resultado era o que fazia o agente parecer pronto em 3 s
  ([10 · Chat](10-chat.md#agentes-em-segundo-plano));
- `durationMs` sai dos dois carimbos do próprio transcript (disparo → aviso), não de
  palpite; sem os dois, vem `null`;
- **`agents` (fora de `messages`) é quem está de pé na conversa INTEIRA**, não na página:
  é o que a janela mostra na faixa do rodapé. Sem isso, reabrir uma conversa com quatro
  agentes rodando desde 200 mensagens atrás não mostrava nada — "quem está rodando" não
  pode depender de até onde você rolou;
- teto de 4000 caracteres por lado (`MAX_DETAIL` em `core/claude-blocks.js`), com
  `inputTruncated`/`truncated` avisando quando cortou;
- mensagem que **só** usou ferramenta não é descartada: ela tem bloco, mesmo sem prosa;
- é o mesmo desenho que o chat emite ao vivo ([10](10-chat.md#eventos-do-stream)) — lá em
  eventos (`tool`, `agentStart`, `agentEnd`), aqui em blocos —, então a interface desenha
  conversa ao vivo e conversa relida com as mesmas peças.

A janela é contada **do fim para o começo**, como um feed:

| Parâmetro | Padrão | O quê |
| --- | --- | --- |
| `limit` | 20 | tamanho da janela (mínimo 1, máximo 500) |
| `before` | fim da conversa | devolve as `limit` mensagens imediatamente **anteriores** a esse índice |

- resposta traz `from`/`to` (intervalo `[from, to)`) e `hasMore` — para a próxima
  página, mande `before=from`;
- `before` maior que `total` é tratado como o fim; `before=0` devolve lista vazia
  com `hasMore: false`;
- cada mensagem tem `index` estável dentro do arquivo;
- cada conversa traz `contextTokens` (uso do último turno), `contextWindow` (a
  janela do modelo) e `contextWindowSource` (`"api"` ou `"guess"`) — base do medidor
  de contexto na interface. A janela vem do [catálogo de modelos](#modelos-models);
  `"guess"` significa que o catálogo não estava disponível e o número é palpite, e
  aí a interface **diz** isso em vez de mostrá-lo como fato. Logo após um
  `/compact`, a CLI grava um turno `<synthetic>` com uso zerado; nesse caso
  `contextTokens` vem `null` e `contextNote` = "compactado — recalcula ao enviar"
  (mostrar `0` enganaria — o tamanho real só é medido no próximo turno);
- as mensagens legíveis ficam em cache por `mtime` (até 8 arquivos), então paginar
  não relê o `.jsonl` a cada rolagem.

Bloco `thinking` é omitido. Ferramenta e agente **não** entram no texto: são blocos
próprios (acima), e o `tool_result` é costurado no `result` da chamada em vez de
descartado.

Deletar e restaurar:

```bash
curl -s -X DELETE "localhost:7788/api/conversations/$ID"
# { "id": "...", "trashedAs": "20260818-123312_-home-fernando_bbbb….jsonl", "trashDir": "…" }

curl -s -X POST localhost:7788/api/conversations/trash/restore \
  -H 'content-type: application/json' -d '{"name":"20260818-123312_-home-fernando_bbbb….jsonl"}'
```

Deletar **nunca** apaga: renomeia para `~/.claude/.trash-conversas` com o padrão
`AAAAMMDD-HHMMSS_<projeto>_<sessao>.jsonl` — o mesmo formato usado pelo script de
terminal antigo, então a lixeira é compartilhada entre os dois.

### Expurgo da lixeira (o único jeito de apagar de vez)

A lixeira **não expira sozinha**: nada, em lugar nenhum, remove arquivo dali por
tempo. Quem apaga de vez é esta rota, sempre a pedido.

```bash
# quem IRIA embora, sem apagar nada (é o preview que a confirmação da UI usa)
curl -s -X POST localhost:7788/api/conversations/trash/purge \
  -H 'content-type: application/json' -d '{"value":30,"unit":"days","dryRun":true}'
# { "dryRun": true, "cutoff": "2026-07-25T13:08:54.865Z",
#   "retention": { "value": 30, "unit": "days" },
#   "count": 4, "bytes": 1210304, "items": [ { "name": "…", "projectDir": "…", … } ] }

# de verdade (sem volta): mesma chamada sem dryRun
curl -s -X POST localhost:7788/api/conversations/trash/purge \
  -H 'content-type: application/json' -d '{"value":1,"unit":"days"}'
```

- `unit` é `days`, `months` ou `years`; `value` é inteiro de 1 a 999 — fora disso, 400;
- **meses e anos são calendário de verdade** (`setMonth`/`setFullYear`), não "30 dias":
  1 mês atrás é o mesmo dia do mês anterior;
- a idade sai do `deletedAt` do `GET /trash` (que vem do **nome** do arquivo), então
  lista e expurgo nunca discordam. O `mtime` é do conteúdo original e é ignorado —
  `rename` o preserva, então ele não diz nada sobre quando você deletou;
- `dryRun` existe para a interface confirmar com número e tamanho reais. A regra de
  idade vive **só** aqui — a interface não recalcula corte nenhum;
- a retenção usada é a que o painel manda. Este serviço **não** lê a configuração:
  serviço não conhece serviço ([02](02-arquitetura.md)), quem junta os dois é o painel.

## Chat (continuar a conversa)

| Método | Rota | O quê |
| --- | --- | --- |
| POST | `/api/chat` | **inicia** uma conversa nova `{ cwd, text, mode, model, images }` em SSE |
| POST | `/api/chat/:id` | envia `{ text, mode, model, images }` e transmite a resposta em SSE |
| POST | `/api/chat/:id/compact` | compacta o contexto (`/compact`), em SSE |
| POST | `/api/chat/:id/stop` | interrompe o turno em andamento |
| GET | `/api/chat` | processos de chat vivos |
| GET | `/api/chat/:id/events` | **canal da conversa** em SSE (turnos que o CLI começa sozinho) |
| GET | `/api/chat/:id/status` | `{ running }` |

`mode` é o modo de permissão (`none`/`plan`/`auto`/`acceptEdits`/`bypassPermissions`);
`images` é opcional,
uma lista `[{ media_type, data }]` (base64) anexada à mensagem. Detalhes, eventos do
stream, modos, imagens e custo em [10 · Chat](10-chat.md).

**As rotas não mudaram de forma, mudaram de semântica** quando o chat passou a manter um
processo `claude` vivo por conversa ([10 · Chat](10-chat.md#mandar-mensagem-durante-a-resposta)):

- **`POST /api/chat/:id` durante uma resposta não dá mais 409.** A mensagem vai para o
  stdin do processo na hora e o CLI a enfileira; o SSE do turno que espera recebe
  `queued` (`{ ahead: N }`) e depois `turnStart` quando chega a vez dele. O 409 sobrou
  para trocar de **modo/modelo** com a conversa respondendo e para cruzar chat com
  `/compact` (que é execução única, porque reescreve o transcript);
- **`POST /api/chat/:id/stop` interrompe o turno e preserva a fila.** É um
  `control_request` no stdin, não `SIGTERM`: o turno em voo termina com
  `result` `subtype: 'interrupted'` e o próximo da fila começa. Vale para o turno corrente,
  **inclusive quando ele nasceu no CLI**. A porta é a mesma do `/status` (`working`), então
  o botão que aparece na tela nunca dá 404: sem nada para cortar vem `stopped: false`. Sem
  processo vivo nenhum, 404;
- **`GET /api/chat/:id/status` é "trabalhando agora"**, não "tem processo vivo" nem "tem
  fila". É o `working` do runner: `busy` **ou** uma linha do stdout nos últimos
  `CHAT_QUIET_MS` (30 s). Precisou mudar porque o CLI abre turnos por conta própria — com
  a fila vazia e o Claude trabalhando, o antigo `busy` respondia `false` e o painel
  escondia o **Parar** justamente na hora em que ele era necessário
  ([10 · Chat](10-chat.md#turnos-que-nascem-sozinhos-o-cli-começa-por-conta-própria));
- **`GET /api/chat/:id/events` é o canal da conversa** (SSE que fica aberto): primeiro
  evento `hello`, depois `autoStart` → eventos do turno → `result` → `autoEnd` para cada
  turno que o CLI começa sozinho, mais `busy` (`{ busy, pending }`) quando esse estado
  muda e `gone` quando o processo encerra. No meio vêm os eventos normais do stream
  (`delta`, `message`, `tool`, `toolResult`, `notice`, `system`, `result`) — só os do turno
  espontâneo, porque o que pertence a um turno seu já vai no SSE daquele turno. Fechar a
  conexão apenas desinscreve, **nunca** mata processo; há keep-alive a cada ~25 s.
  **Enquanto este canal está aberto o servidor também segue o `.jsonl` da conversa**, e é
  assim que o que você faz **no terminal** aparece na janela sem fechar e abrir: o turno de
  lá vem como `autoStart { source: 'terminal' }` → eventos → `autoEnd`, e o que você digita
  lá vem como `peer { role, text, at }`
  ([10 · Chat](10-chat.md#seguir-a-conversa-que-roda-no-terminal));
- **`GET /api/chat` lista os processos vivos** e mudou de formato:

```json
{ "items": [ { "id": "-home-fernando:57316179-…", "pid": 45497,
               "startedAt": "2026-08-25T12:00:00.000Z", "kind": "chat",
               "busy": true, "working": true, "auto": false, "pending": 2,
               "lastOutputAt": "2026-08-25T12:03:11.004Z" } ] }
```

| Campo | O quê |
| --- | --- |
| `kind` | `chat` (processo vivo) ou `compact` (execução única) |
| `busy` | tem turno em curso: **fila não vazia OU turno espontâneo rodando** |
| `working` | `busy` ou saída recente (`CHAT_QUIET_MS`) — é o que o `/status` responde |
| `auto` | o turno em curso nasceu no CLI, não numa mensagem sua |
| `pending` | turnos **seus** na fila (contando o em voo) |
| `lastOutputAt` | última linha lida do stdout (`null` no `compact`) |

`busy: false` com `working: false` é um processo quente que vai sair sozinho depois de
`CHAT_IDLE_MS` de silêncio.

## Arquivos (`fs`)

Navegação de pastas do servidor — usada para escolher onde uma conversa nova roda
(painel Nova conversa) e base para o "abrir pasta" do editor no futuro. Só lista
diretórios; nunca lê conteúdo de arquivo nem escreve.

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/fs?path=` | subpastas de `path` (vazio = HOME do servidor) |

```bash
curl -s "localhost:7788/api/fs?path=/home/fernando/www"
# { "path": "/home/fernando/www", "parent": "/home/fernando", "home": "/home/fernando",
#   "entries": [ { "name": "claude-manager-web", "path": "/home/fernando/www/claude-manager-web" }, … ] }
```

Só diretórios, em ordem alfabética; pastas ocultas (começando com `.`) ficam de fora.

## Modelos (`models`)

Catálogo vindo de `GET https://api.anthropic.com/v1/models`, em cache em
`data/models.json`. **É o único ponto do app que faz chamada de rede externa.**

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/models` | catálogo (busca da API se o cache venceu): `{ fetchedAt, models, stale }` |
| POST | `/api/models/refresh` | força a busca e regrava o cache |
| GET | `/api/models/:id` | um modelo pelo id |

```bash
curl -s localhost:7788/api/models | head -20
```

```json
{
  "fetchedAt": "2026-08-24T19:32:15.359Z",
  "source": "api",
  "stale": false,
  "models": [
    { "id": "claude-opus-5", "displayName": "Claude Opus 5",
      "createdAt": "2026-07-24T00:00:00Z",
      "maxInputTokens": 1000000, "maxOutputTokens": 128000 }
  ]
}
```

### Por que isto existe

A janela de contexto **não está no transcript**. Ela era adivinhada pelo nome do
modelo (`/\[1m\]/.test(model) || tokens > 200_000 ? 1M : 200k`), e `claude-opus-5`
não tem sufixo `[1m]` — então o medidor mostrava **200k numa conversa de 1M**, em
praticamente toda conversa. Agora sai de `max_input_tokens` da API.

**O campo é `max_input_tokens`, não `context_window`** — esse campo não existe na
resposta. `max_tokens` é o teto de *saída*, não a janela.

### Detalhes que custaram um teste cada

- **A API responde 404 para alias e para variante.** `GET /v1/models/opus` e
  `GET /v1/models/claude-opus-5[1m]` falham, mas o transcript grava exatamente
  essas formas. Por isso buscamos a **lista** (10 modelos, uma requisição) e o
  casamento acontece no `core/claude-models.js`: sufixo `[…]`/`-fast` é removido, e
  alias (`opus`, `sonnet`, `haiku`, `fable`) resolve para o **mais novo** daquela
  família — que é o que o alias significa;
- `<synthetic>` (o turno que o `/compact` grava) não é modelo e não resolve nada;
- **TTL de 24 h.** O catálogo muda em lançamento, não por hora. Se a busca falhar e
  houver cache, a resposta vem com `stale: true` e o motivo em `error` — dado velho
  e sinalizado é melhor que tela vazia;
- **o caminho de leitura nunca chama a rede.** Listar conversas só lê o cache
  (`readCatalogCache()` no core); quem busca é este serviço. Sem cache, a janela cai
  no palpite antigo e vem marcada como `"guess"`.

### Autenticação

Ordem: `ANTHROPIC_API_KEY` (cabeçalho `x-api-key`) → a credencial do CLI já logado
nesta máquina (`~/.claude/.credentials.json` → `Authorization: Bearer` + o cabeçalho
`anthropic-beta: oauth-2025-04-20`, que o token OAuth exige). Sem nenhuma das duas,
a rota responde 409 dizendo o que fazer, e o resto do app segue funcionando.

## Configurações (`settings`)

Preferências chave/valor gravadas em arquivo, em **dois escopos com a mesma regra**:

| Escopo | Arquivo | Para quê |
| --- | --- | --- |
| **global** | `data/settings.json` (um só) | preferência do app inteiro — hoje a retenção da lixeira |
| **por conversa** | `data/conversas/<id>.json` (um por conversa) | `mode`, `model`, `color`, `suffix`/`suffixOn` (frase fixa do fim da mensagem)… |

Os dois ficam dentro do projeto e são ignorados no git. No escopo por conversa, o
vínculo arquivo ↔ conversa é o próprio `:id` (`<pastaDoProjeto>:<sessionId>`), único;
o `:` vira `_` no nome do arquivo. É chave/valor puro — o serviço **não** interpreta o
que cada chave significa (isso é da interface), e é por isso que serve para qualquer
preferência nova sem tocar no serviço.

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/settings` | lê a configuração global (`{ settings }`) |
| PUT | `/api/settings` | mescla e grava a global (body: objeto chave/valor) |
| GET | `/api/settings/all` | config de **todas** as conversas de uma vez (para listas) |
| GET | `/api/settings/:id` | lê a configuração da conversa (`{ id, settings }`) |
| PUT | `/api/settings/:id` | mescla e grava (body: objeto chave/valor) |
| DELETE | `/api/settings/:id` | apaga a config da conversa; devolve `{ id, settings }` (o que existia) |

### `GET /api/settings/all` — por que existe

Uma lista precisa saber a cor de **dezenas** de conversas para desenhar. Uma
requisição por conversa (57 no meu caso) é inaceitável, e `conversations` não pode
ler `settings` — serviço não conhece serviço ([02](02-arquitetura.md)). Então quem
oferece o lote é o próprio serviço de configuração.

```bash
curl -s localhost:7788/api/settings/all
```

```json
{
  "items": [
    { "id": "-home-fernando-www-hisofi:1007aa54-…", "settings": { "color": "#17c964" } },
    { "id": "-home-fernando:9e934df4-…",            "settings": { "color": "#ff6a45", "mode": "plan" } }
  ]
}
```

- devolve **só quem tem alguma chave gravada** — conversa sem config não aparece;
- a rota é registrada **antes** de `/:id`, senão `all` seria casado como se fosse um
  id (o router casa na ordem de registro);
- o `id` é reconstruído a partir do nome do arquivo: na gravação o `:` virou `_`, e o
  `sessionId` nunca tem `_`, então o **último** `_` é sempre o separador. O resultado
  passa pelo `resolveConversationId`, então arquivo estranho na pasta é ignorado em vez
  de virar um id inventado.

```bash
curl -s localhost:7788/api/settings
# { "settings": { "trashRetentionValue": 30, "trashRetentionUnit": "days" } }

curl -s -X PUT localhost:7788/api/settings \
  -H 'content-type: application/json' -d '{"trashRetentionValue":6,"trashRetentionUnit":"months"}'
```

> Sem `:id` é a global; com `:id` é a da conversa. Não há ambiguidade: o router monta
> `^/api/settings/?$` para uma e `^/api/settings/([^/]+)/?$` para a outra, e o segmento
> exige ao menos um caractere.

Chaves globais em uso pela interface: `trashRetentionValue` (inteiro) e
`trashRetentionUnit` (`days` | `months` | `years`) — a retenção que o painel Lixeira
manda para o `POST /trash/purge`. Se nunca configurada, o painel assume **30 dias**.

```bash
ID='-home-fernando:57316179-7a65-49bc-940d-ce557e574dfa'
curl -s "localhost:7788/api/settings/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$ID")"
# { "id": "-home-fernando:5731…", "settings": {} }   (vazio se nunca foi salva)

curl -s -X PUT "localhost:7788/api/settings/$(...)" \
  -H 'content-type: application/json' -d '{"mode":"plan","color":"#3b82f6"}'
# { "id": "…", "settings": { "mode": "plan", "color": "#3b82f6" } }
```

- **semântica PATCH:** o `PUT` mescla — mande só a chave que mudou;
- **gravação atômica e serializada:** o arquivo é escrito num `.tmp` e renomeado, e as
  gravações do mesmo arquivo entram numa fila. Dois `PUT` ao mesmo tempo (dois campos
  editados em sequência na interface) antes disso truncavam e escreviam um por cima do
  outro: o JSON saía partido e o `GET` seguinte devolvia `{}`, como se a config tivesse
  sido apagada. Arquivo ilegível agora também gera aviso no console do servidor;
- **voltar ao padrão:** valor `""` ou `null` **remove** a chave (`{"color":""}` apaga a cor);
- chaves são curtas e alfanuméricas (`^[a-zA-Z0-9_-]{1,40}$`); valores só
  texto/número/booleano; o arquivo tem teto de 16 KB — id ou chave inválidos dão 400;
- hoje a interface usa `mode` (modo do chat), `model` (modelo escolhido para os
  próximos envios) e `color` (cor da janela), mas o formato
  é genérico: dá para acrescentar chaves sem mexer no serviço.

**Limpeza ao deletar.** Quando uma conversa vai para a lixeira, o painel também chama
`DELETE /api/settings/:id` para não deixar config órfã acumulando. Como os serviços
não se conhecem (o de conversas não fala com o de settings — [02](02-arquitetura.md)),
quem coordena os dois é o painel (a cola). O `DELETE` devolve o que existia, e o
"Desfazer" do toast regrava essa config ao restaurar a conversa — restaurar traz a cor
e o modo de volta.

## Erros

Formato único:

```json
{ "error": "PID 999999 não é uma sessão do Claude ativa", "details": null }
```

| Status | Quando |
| --- | --- |
| 400 | id/nome/sinal inválido, JSON malformado, corpo grande demais |
| 404 | rota inexistente, conversa ou PID não encontrado |
| 405 | rota existe em outro método (o header `Allow` lista quais) |
| 409 | sem permissão para encerrar o processo (`EPERM`) |
| 500 | erro não previsto (aparece com stack no log do servidor) |
