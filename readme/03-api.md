# 03 · API

[← sumário](README.md)

Base: `http://127.0.0.1:7788`. Tudo é JSON, sem autenticação (só escuta local —
veja [07](07-seguranca.md)).

## Meta

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/_health` | ping: `{ ok, uptime }` |
| GET | `/api/_services` | serviços registrados, rotas, resumos e `root` (raiz do projeto) |

`/api/_services` é a documentação viva: o painel **Serviços** só desenha o que
essa rota devolve. O campo `root` é usado pelo indicador de status para montar o
comando de iniciar (`cd <root> && ./start.sh`).

## Sistema

Controle do próprio processo — usado pelo indicador de status no rodapé
([`server-status`](11-componentes.md#server-statusjs)).

| Método | Rota | O quê |
| --- | --- | --- |
| POST | `/api/_server/stop` | responde `{ ok, stopping }` e encerra o processo |
| POST | `/api/_server/restart` | sobe uma instância nova destacada (assume em ~1s) e encerra a atual |

`restart` herda o ambiente (ex.: `CHAT_ALLOW_FULL_TOOLS`). **Religar de fora** (quando
o servidor está desligado) não é possível pela API — nada está escutando; use o
terminal (`./start.sh`).

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
      "conversationId": "57316179-7a65-49bc-940d-ce557e574dfa"
    }
  ]
}
```

`conversationId` é **palpite**: o `.jsonl` mais recente da pasta do projeto
correspondente ao `cwd`. O Claude não mantém o arquivo aberto num descritor, então
não existe ligação exata processo → conversa. Com duas sessões no mesmo diretório
o palpite pode errar.

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
| POST | `/api/conversations/:id/rename` | renomeia (`{ "name": "..." }`) — o mesmo que `/rename` |
| DELETE | `/api/conversations/:id` | move para a lixeira |
| GET | `/api/conversations/trash` | lista a lixeira |
| POST | `/api/conversations/trash/restore` | restaura (`{ "name": "..." }`) |

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
  "messages": [
    { "index": 90, "role": "user", "text": "…", "at": "2026-…", "human": true },
    { "index": 91, "role": "assistant", "text": "⚙ Bash", "at": "2026-…", "human": false }
  ]
}
```

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
- cada conversa traz `contextTokens` (uso do último turno) e `contextWindow`
  (janela inferida) — base do medidor de contexto na interface. Logo após um
  `/compact`, a CLI grava um turno `<synthetic>` com uso zerado; nesse caso
  `contextTokens` vem `null` e `contextNote` = "compactado — recalcula ao enviar"
  (mostrar `0` enganaria — o tamanho real só é medido no próximo turno);
- as mensagens legíveis ficam em cache por `mtime` (até 8 arquivos), então paginar
  não relê o `.jsonl` a cada rolagem.

Blocos de ferramenta aparecem como `⚙ <nome>`; `thinking` e `tool_result` são
omitidos.

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

## Chat (continuar a conversa)

| Método | Rota | O quê |
| --- | --- | --- |
| POST | `/api/chat` | **inicia** uma conversa nova `{ cwd, text, mode, model, images }` em SSE |
| POST | `/api/chat/:id` | envia `{ text, mode, model, images }` e transmite a resposta em SSE |
| POST | `/api/chat/:id/compact` | compacta o contexto (`/compact`), em SSE |
| POST | `/api/chat/:id/stop` | interrompe a execução em andamento |
| GET | `/api/chat` | execuções em andamento |
| GET | `/api/chat/:id/status` | `{ running }` |

`mode` é o modo de permissão (`none`/`plan`/`auto`/`acceptEdits`); `images` é opcional,
uma lista `[{ media_type, data }]` (base64) anexada à mensagem. Detalhes, eventos do
stream, modos, imagens e custo em [10 · Chat](10-chat.md).

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

## Configurações (`settings`)

Preferências **por conversa** (modo do chat, cor da janela…), gravadas em arquivo
para sobreviver a fechar/reabrir. Uma conversa = um arquivo JSON em
`data/conversas/` (dentro do projeto, ignorado no git). O vínculo arquivo ↔ conversa
é o próprio `:id` da conversa (`<pastaDoProjeto>:<sessionId>`), único; o `:` vira `_`
no nome do arquivo. É chave/valor puro — o serviço **não** interpreta o que cada
chave significa (isso é da interface).

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/settings/:id` | lê a configuração da conversa (`{ id, settings }`) |
| PUT | `/api/settings/:id` | mescla e grava (body: objeto chave/valor) |
| DELETE | `/api/settings/:id` | apaga a config da conversa; devolve `{ id, settings }` (o que existia) |

```bash
ID='-home-fernando:57316179-7a65-49bc-940d-ce557e574dfa'
curl -s "localhost:7788/api/settings/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$ID")"
# { "id": "-home-fernando:5731…", "settings": {} }   (vazio se nunca foi salva)

curl -s -X PUT "localhost:7788/api/settings/$(...)" \
  -H 'content-type: application/json' -d '{"mode":"plan","color":"#3b82f6"}'
# { "id": "…", "settings": { "mode": "plan", "color": "#3b82f6" } }
```

- **semântica PATCH:** o `PUT` mescla — mande só a chave que mudou;
- **voltar ao padrão:** valor `""` ou `null` **remove** a chave (`{"color":""}` apaga a cor);
- chaves são curtas e alfanuméricas (`^[a-zA-Z0-9_-]{1,40}$`); valores só
  texto/número/booleano; o arquivo tem teto de 16 KB — id ou chave inválidos dão 400;
- hoje a interface usa `mode` (modo do chat) e `color` (cor da janela), mas o formato
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
