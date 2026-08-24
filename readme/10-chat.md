# 10 · Chat: continuar a conversa pelo navegador

[← sumário](README.md)

Ao abrir uma conversa (botão **Ler**), ela abre numa janela flutuante cujo rodapé traz
uma caixa de escrever.
O que você manda dali **continua a mesma conversa do Claude Code** — não é um chat
paralelo.

## Como funciona

O serviço `chat` executa o próprio CLI em modo headless:

```bash
claude -p "<sua mensagem>" \
  --resume <sessionId> \
  --output-format stream-json --verbose --include-partial-messages \
  <flags do modo de permissão>
```

- roda com `cwd` = a pasta onde a conversa aconteceu (lida do próprio transcript);
- `--resume` **preserva o `session_id`** e grava as mensagens novas no **mesmo
  `.jsonl`** — verificado: 10.454 → 14.900 bytes no mesmo arquivo, contexto intacto;
- a saída `stream-json` é traduzida em eventos SSE simples e o texto aparece
  aparecendo (deltas), como no terminal;
- se você reabrir essa conversa no terminal (`claude --resume <id>`), a troca feita
  pelo navegador está lá.

## Respostas rápidas

Quando a resposta do Claude é uma **pergunta com opções** (ex.: "Qual você prefere?"
seguido de uma lista), o chat mostra as opções como **botões** acima da caixa — clicar
manda aquela opção, e "✎ escrever outra" foca a caixa para uma resposta livre. É pura
interface (lê o texto da resposta) — veja
[`quick-replies`](11-componentes.md#quick-repliesjs). Em headless não há a ferramenta
`AskUserQuestion` nem prompt de permissão interceptável, então essa é a forma honesta
de dar botões sem depender de recurso que a CLI não expõe.

## Imagens (anexar e colar)

A caixa de escrever aceita imagem: o botão **🖼** escolhe um arquivo, ou você **cola
com Ctrl+V** (screenshot na área de transferência, por exemplo). As imagens viram
miniaturas acima da caixa e vão junto com a mensagem.

No back isso muda o jeito de invocar o CLI: sem imagem, o texto vai como `-p "texto"`
(simples); **com imagem**, mandamos a mensagem inteira (texto + blocos `image` em
base64) pelo **stdin** em `--input-format stream-json`, que é como o CLI recebe
conteúdo estruturado:

```bash
echo '{"type":"user","message":{"role":"user","content":[
  {"type":"text","text":"que erro é esse?"},
  {"type":"image","source":{"type":"base64","media_type":"image/png","data":"<...>"}}
]}}' | claude -p --input-format stream-json --resume <sessionId> --output-format stream-json --verbose
```

Aceita PNG, JPEG, GIF e WebP; até 6 por mensagem. Como base64 é grande, o limite de
corpo da requisição sobe para 30 MB (`MAX_BODY_BYTES`). No histórico relido do disco,
um bloco de imagem aparece como `🖼 imagem` (as miniaturas só ficam na hora do envio).
No front, o anexo é o componente reutilizável [`image-tray`](11-componentes.md#image-trayjs).

## Modos de permissão

O seletor **modo** (ao lado do Enviar) escolhe o que o Claude pode fazer — são os
mesmos modos do terminal (`claude --permission-mode`), com nomes claros:

| Opção | O que passa para o CLI | Uso |
| --- | --- | --- |
| **só conversa** (padrão) | `--disallowedTools` com tudo | não lê, não edita, não roda nada |
| **plano** | `--permission-mode plan` | lê o projeto e propõe um plano, sem alterar nada |
| **automático** | `--permission-mode auto` | o Claude decide o que é seguro e edita/roda — o "auto mode" do terminal |
| **aceitar edições** | `--permission-mode acceptEdits` | aplica edições e roda comandos sem perguntar |

**"automático" e "aceitar edições" vêm desligados.** A rota recusa com uma mensagem
explicando, a menos que o servidor tenha sido iniciado com a variável ligada:

```bash
CHAT_ALLOW_FULL_TOOLS=1 npm start
```

O motivo: em modo headless **não existe o "perguntar antes"** do terminal — o modo já
libera ou não. Deixar um modo que edita/executa a um clique numa página web é convite a
acidente, então habilitá-lo é uma decisão consciente na hora de subir o servidor.
("plano" e "só conversa" não alteram nada, então não precisam da variável.)

## Variáveis de ambiente

| Variável | Padrão | O quê |
| --- | --- | --- |
| `CHAT_MAX_USD` | (sem teto) | teto de gasto por mensagem (`--max-budget-usd`) — só se você definir. Numa assinatura não faz sentido; útil só com API paga por token |
| `CHAT_TIMEOUT_MS` | `900000` (15 min) | mata a execução se passar disso |
| `CHAT_ALLOW_FULL_TOOLS` | (desligado) | `1` habilita os modos "automático" e "aceitar edições" |
| `MAX_BODY_BYTES` | `31457280` (30 MB) | limite do corpo da requisição (imagens base64 são grandes) |
| `CLAUDE_BIN` | (auto) | caminho do binário `claude`. Por padrão é resolvido sozinho (PATH + locais conhecidos como `~/.npm-global/bin`); defina só se o servidor não achar o CLI |

## Rotas

| Método | Rota | O quê |
| --- | --- | --- |
| POST | `/api/chat` | **inicia** uma conversa nova `{ cwd, text, mode, model, images }` em SSE |
| POST | `/api/chat/:id` | envia `{ text, mode, model, images }` e devolve a resposta em SSE |
| POST | `/api/chat/:id/compact` | compacta o contexto (`/compact`), também em SSE |
| POST | `/api/chat/:id/stop` | manda `SIGTERM` na execução em andamento |
| GET | `/api/chat` | execuções em andamento (id, pid, início) |
| GET | `/api/chat/:id/status` | `{ running: true|false }` |

`:id` é o mesmo id composto das conversas: `<pastaDoProjeto>:<sessionId>`.

Exemplo:

```bash
curl -sN -X POST "localhost:7788/api/chat/-home-fernando:57316179-…" \
  -H 'content-type: application/json' \
  -d '{"text":"Responda apenas: OK","mode":"none"}'
```

```
data: {"type":"init","sessionId":"…","cwd":"/home/fernando","mode":"none","pid":45497}
data: {"type":"system","model":"claude-opus-5"}
data: {"type":"delta","text":"O"}
data: {"type":"delta","text":"K"}
data: {"type":"message","text":"OK"}
data: {"type":"result","ok":true,"subtype":"success","costUsd":0.0116,"turns":1}
data: {"type":"done","code":0}
```

## Eventos do stream

| `type` | Campos | Significado |
| --- | --- | --- |
| `init` | `sessionId`, `cwd`, `mode`, `kind`, `images`, `pid` | processo iniciado (`images` = quantas imagens; `kind`: `message`/`compact`/`new`) |
| `system` | `model` | modelo escolhido |
| `delta` | `text` | pedaço de texto (streaming) |
| `message` | `text` | bloco de texto completo |
| `tool` | `id`, `name`, `input`, `inputTruncated` | **chamou** uma ferramenta (`input` já em texto) |
| `toolResult` | `id`, `text`, `truncated`, `isError` | o que a ferramenta **devolveu** |
| `compact` | `ok`, `message` | resultado da compactação (só no `/compact`) |
| `notice` | `message` | stderr, aviso de limite de uso |
| `result` | `ok`, `subtype`, `costUsd`, `turns`, `durationMs` | fim da resposta |
| `error` | `message` | falhou (id inválido, modo proibido, timeout) |
| `done` | `code`, `signal` | stream fechado |

### Ferramentas e subagentes: o que dá para ver

O chip de cada ferramenta é clicável ([`tool-call`](11-componentes.md#tool-calljs)) e
abre o **pedido** e o **resultado**. Vale para qualquer ferramenta — `Bash`, `Edit` — e
também para subagente, que no stream é a ferramenta **`Agent`**, com
`subagent_type`, `description` e `prompt` dentro do `input`.

O par `tool` → `toolResult` é casado pelo `id` (o `tool_use_id` do CLI). Dois detalhes
que a interface trata sem inventar:

- **teto de 4000 caracteres** por lado (`MAX_DETAIL` em `services/chat/repo.js`): o
  prompt de um subagente e o retorno de um `Read` são grandes demais para o SSE. Quando
  corta, o evento traz `inputTruncated`/`truncated` e a tela **diz** que cortou;
- **ferramenta que não devolve nada** no stream não fica "executando…" para sempre: ao
  fim da resposta o chip passa a dizer *"sem resultado registrado neste stream"*.

O que **não** dá para mostrar, e não é limitação da interface:

| Existe no stream | Não existe |
| --- | --- |
| a chamada do subagente (tipo, descrição, prompt) | os passos internos dele |
| o retorno final de um subagente **síncrono** | as ferramentas que ele usou por dentro |

Medido nos transcripts desta máquina: **583 chamadas de `Agent`** (396 síncronas, 187
em background) e **zero** linhas com `isSidechain:true` — o CLI não grava os turnos do
subagente no transcript do pai. E em background o `tool_result` é só o recibo
(`"Async agent launched successfully. agentId: …"`), porque o relatório chega depois,
por outro caminho. Então "expandir o subagente ao vivo, aninhado, como no terminal"
não é alcançável por este canal.

## Nova conversa (a tela inicial)

O primeiro painel do menu, **Nova conversa**, começa uma conversa do zero. Numa barra
de configuração você escolhe:

- **modelo** — campo que aceita texto livre e sugere os aliases do `/model`
  (`opus`, `fable`, `sonnet`, `haiku`); dá para digitar um nome completo/antigo, ex.:
  `claude-opus-4-8`. Vazio = padrão do CLI.
- **pasta** — onde a conversa roda. Um botão **📁 Escolher…** abre o
  [seletor de pasta](11-componentes.md#dir-pickerjs), que navega o disco do servidor
  (serviço `fs`, rota `GET /api/fs`).
- **modo** — o modo de permissão (`só conversa`/`plano`/`automático`/`aceitar edições`),
  os mesmos do terminal (veja [Modos de permissão](#modos-de-permissão)).

Escreve a primeira mensagem e ela nasce como uma conversa nova do Claude Code.

O truque: o servidor **gera o `session-id` (um uuid)** e o passa ao CLI com
`--session-id`, então já sabe o id da conversa antes da primeira resposta — sem
`--resume`, um `.jsonl` novo nasce em `~/.claude/projects/<pasta-encodada>/`.

```bash
claude -p "<primeira mensagem>" --session-id <uuid> --model <alias> \
  --output-format stream-json --verbose ...
```

O id composto da conversa (`<pastaEncodada>:<uuid>`) volta no evento `init`. A partir
daí é uma conversa normal: as próximas mensagens usam `/api/chat/:id` (com `--resume`)
e ela aparece em **Conversas**, onde dá para continuar, compactar ou apagar.

No front isso é **só cola**: o painel reaproveita o componente `createChat` inteiro
(feed + composer + streaming + indicador de atividade) e acrescenta uma barra de
configuração (modelo, pasta, modo) acima da caixa; o `send` decide entre
`api.chat.start` (primeira) e `api.chat.send` (seguintes). As sugestões de modelo e
as opções de modo ficam em `public/js/core/chat-fields.js`, compartilhadas com o
painel de Conversas; o seletor de pasta é o componente reutilizável `dir-picker.js`.

## Compactar (o mesmo que `/compact` no terminal)

O botão **Compactar**, acima da caixa de escrever, roda literalmente:

```bash
claude -p "/compact" --resume <sessionId> --output-format stream-json --verbose
```

É o mesmíssimo `/compact` que você digitaria no terminal — o Claude resume o
histórico e grava o marcador de compactação **no próprio transcript**. As mensagens
antigas continuam no arquivo; o que diminui é o contexto que cada turno seguinte
carrega. Depois de compactar, o painel relê o transcript e o medidor cai.

**Não existe "% de progresso" para o compactar** — o `/compact` headless é opaco, não
reporta andamento. Em vez de inventar uma barra falsa, enquanto roda o medidor mostra
o indicador vivo ([`activity.js`](11-componentes.md#activityjs)): bolinha pulsando,
barra indeterminada e **tempo decorrido**. Ao terminar, o toast dá o feedback honesto
que interessa — o antes→depois, ex.: `269k → 41k (−85%)`.

O tamanho do contexto (ex.: `contexto 258k / 1M`) vem do campo `usage` do último
turno do assistant no transcript: `input_tokens + cache_read + cache_creation`. A
janela é inferida (200k, ou 1M quando o uso já passou de 200k) porque o transcript
não a informa. Sem `usage` no arquivo (conversa que nunca teve resposta), mostra `—`.

Esse contrato é o que o componente [`chat.js`](11-componentes.md) consome — outro
serviço que emita os mesmos eventos reaproveita a interface inteira.

## Proteções

- **uma execução por conversa**: pedir outra enquanto uma responde devolve 409;
- **fechar a janela NÃO mata o processo**: cada conversa abre numa
  [janela flutuante](11-componentes.md#floating-windowjs); fechá-la destrói o chat com
  `abort: false`, então a resposta em andamento **termina em segundo plano** (grava no
  `.jsonl`) e você a vê ao reabrir. Para interromper de verdade, use o botão **Parar**
  na caixa, ou encerre o processo em **Sessões** (o `claude -p` aparece lá com seu PID);
- **aba/navegador fechados matam o processo**: aí a conexão cai e o `req.on('close')`
  manda `SIGTERM`, sem deixar órfãos;
- **timeout** vindo das variáveis acima (e **teto de gasto** opcional, se você definir
  `CHAT_MAX_USD` — desligado por padrão);
- **aviso de conflito**: se um terminal parece estar com essa conversa aberta, uma
  faixa amarela avisa antes de você escrever (os dois gravam no mesmo arquivo);
- erros de validação viram evento `error` no stream (o HTTP já respondeu 200 ao
  abrir o SSE), então a interface sempre mostra a razão.

## Custo e limites

**É a mesma conta do terminal.** O chat do navegador roda o mesmo CLI, com a mesma
autenticação — então consome do **mesmo lugar** e esbarra no **mesmo limite** que o
terminal:

- **Assinatura (plano Pro/Max/Team):** você não paga por token; tem limites de uso
  (sessão de ~5h, semanal). Quando bate, o Claude para até resetar — igual ao terminal.
  Aqui **não há custo por mensagem**; o `costUsd` do evento `result` é só uma estimativa
  informativa (não é cobrança real).
- **API (chave paga por token):** aí sim cada mensagem tem um custo em dólar. A primeira
  de uma conversa longa cria cache (mais cara), as seguintes leem do cache. Quem usa
  assim pode pôr um teto por mensagem com `CHAT_MAX_USD` (desligado por padrão).

O `--max-budget-usd` **não** é passado por padrão justamente para o chat se comportar
como o terminal — sem trava artificial de dólar.

## Limitações conhecidas

- **sem confirmação de permissão**: veja a tabela de modos acima;
- **sem entrada interativa**: se o Claude fizer uma pergunta que exigiria escolha no
  terminal, a execução simplesmente segue com o que o modo permite;
- **um turno por envio**: cada mensagem é um `-p` completo; não há sessão persistida
  em memória entre envios (o estado vive no `.jsonl`, o que é justamente o ponto);
- **`--fork-session` não é usado**: continuar sempre grava na mesma conversa. Se
  quiser "ramificar", é um campo novo no composer e a flag no `args` — 3 linhas.
