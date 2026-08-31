# 10 · Chat: continuar a conversa pelo navegador

[← sumário](README.md)

Ao abrir uma conversa (botão **Ler**), ela abre numa janela flutuante cujo rodapé traz
uma caixa de escrever.
O que você manda dali **continua a mesma conversa do Claude Code** — não é um chat
paralelo.

## Como funciona

O serviço `chat` mantém **um processo `claude` vivo por conversa** e conversa com ele
pelo stdin:

```bash
claude -p --input-format stream-json \
  --resume <sessionId> \
  --output-format stream-json --verbose --include-partial-messages \
  <flags do modo de permissão>
```

Cada mensagem é **uma linha JSON** escrita no stdin desse processo:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"oi"}]},"parent_tool_use_id":null}
```

- roda com `cwd` = a pasta onde a conversa aconteceu (lida do próprio transcript);
- `--resume` **preserva o `session_id`** e grava as mensagens novas no **mesmo
  `.jsonl`** — verificado: 10.454 → 14.900 bytes no mesmo arquivo, contexto intacto;
- a saída `stream-json` é traduzida em eventos SSE simples e o texto aparece
  aparecendo (deltas), como no terminal;
- se você reabrir essa conversa no terminal (`claude --resume <id>`), a troca feita
  pelo navegador está lá.

O `-p` continua obrigatório (é ele que liga o headless) e **não** impede o multi-turno:
sem `-p "<texto>"`, o prompt vem do stdin e o processo **fica de pé depois do
`result`**, esperando a próxima linha. Ele sai com código 0 quando o stdin fecha.

Quem cuida disso é [`runner.js`](#arquivos-do-serviço); o `repo.js` só guarda o mapa
`conversa → runner`.

## Mandar mensagem durante a resposta

Antes, cada mensagem subia um processo novo e o **navegador** segurava a segunda numa
fila local. Agora é como no terminal: a mensagem **sai na hora** para o Claude, que a
pega quando termina o passo atual. A espera acontece **dentro do Claude**.

O que foi medido no CLI, e que sustenta o desenho:

- linha escrita no stdin **durante** um turno é aceita na hora e **enfileirada pelo
  próprio CLI**; o turno seguinte começa sozinho quando o atual termina;
- **não existe injeção no meio do turno.** Ninguém "interrompe para acrescentar": a
  mensagem entra na vez dela. É a escolha consciente aqui — o valor é não perder o que
  você escreveu, não atropelar o raciocínio em andamento;
- de brinde: o `--resume` e os ~2s de partida acontecem **uma vez por conversa**, e o
  cache de prompt é reaproveitado entre turnos.

O CLI processa o stdin **em ordem**, e é isso que permite entregar cada linha ao turno
certo sem correlação nenhuma — mas **não** é verdade que a linha seja sempre do primeiro
turno da fila, porque o CLI também começa turnos sozinho (veja
[Turnos que nascem sozinhos](#turnos-que-nascem-sozinhos-o-cli-começa-por-conta-própria)).
Quem manda é o **turno corrente**. Para a espera não ser invisível (regra 8 do
[CLAUDE.md](../CLAUDE.md)), o SSE de cada turno começa assim:

| Ordem | Evento | Quando |
| --- | --- | --- |
| 1 | `init` | sempre, ao abrir o stream |
| 2 | `queued` com `ahead: N` | **só** se houver `N` turnos na frente (contando um turno espontâneo em curso) |
| 3 | `turnStart` | na **primeira linha** deste turno — é aí que se sabe que o CLI está respondendo a ELE |

Depois vem o fluxo normal (`system`, `delta`, `tool`, …), o `result` **daquele** turno
e o `done`, que fecha só aquele SSE.

O `turnStart` **saía no envio** e mudou de hora de propósito: no momento do envio ninguém
sabe se a próxima linha é a resposta a esta mensagem ou a de um turno que o CLI abriu por
conta própria. Dizer "começou" ali era um palpite que errava exatamente quando dói.

Medido no CLI de verdade (duas mensagens, a segunda enviada durante a primeira):
`[t1] init → turnStart`, `[t2] init → queued{ahead:1}`, depois todos os eventos de t1,
seu `result`/`done`, e só então `[t2] turnStart`. **Cada turno traz o seu próprio
`system`** (o CLI reemite o `system/init` a cada turno), então quem consome não deve
assumir "um `system` por conversa".

### Armadilha: conversa viva não se procura no disco

A rota de mensagem resolvia `(sessionId, cwd)` **lendo o transcript** antes de qualquer
coisa. Numa conversa **recém-criada** esse `.jsonl` ainda não existe enquanto a primeira
resposta corre — então a segunda mensagem morria com *"conversa não encontrada (ou sem
cwd no transcript)"*. O bug não aparecia antes porque o navegador segurava a segunda
mensagem até a primeira acabar, e aí o arquivo já existia; ele nasceu junto com o
"mandar na hora".

Correção: **quem já tem processo vivo não vai ao disco.** Sessão e pasta são
conhecimento do runner, que está na memória; só o caminho que precisa *spawnar* lê o
transcript. Regra geral: quando a informação já está na mão, reler a fonte é pior que
inútil — é um jeito de falhar.

Achado ao rodar de verdade pelo HTTP (conversa nova + segunda mensagem durante a
primeira resposta), não pelos testes: o `repo.js` cria o runner por dentro, e os testes
injetam `spawn` só no `runner.js`.

A regra que faltava ganhou casa e spec: `services/chat/runners.js` +
`test/chat-runners-registry.test.js`. O que o spec **não** cobre é a ORDEM (olhar o
registro antes de ir ao disco) — isso continua sendo teste à mão pelo HTTP, receita em
[13](13-testes.md#o-que-o-spawn-de-mentira-não-pega-o-teste-pelo-http).

### Turnos que nascem sozinhos (o CLI começa por conta própria)

**O CLI não espera você para começar um turno.** Quando um subagente lançado em segundo
plano termina, ele **enfileira um `<task-notification>` como se fosse uma mensagem do
usuário** e, ao fim do turno atual, abre um turno novo para tratá-la.

A evidência veio de uma conversa de verdade: **4 `queue-operation` com `dequeue`** no
transcript, sendo **1** a mensagem do usuário e **3 turnos que nasceram sozinhos** (11:20,
11:24 e 11:28), com o arquivo indo de **608 KB para 1,3 MB**. Ou seja: o Claude trabalhou
mais de dez minutos depois da "última resposta".

O desenho anterior ("a linha que chega é sempre do turno da **cabeça da fila**") quebrava
em três lugares — e este é o tipo de erro que o projeto documenta para não repetir:

1. **as linhas órfãs eram DESCARTADAS em silêncio.** O `handleLine` fazia
   `if (!turn) return;`: turno sem SSE dono não tinha para onde mandar, então **toda** a
   saída dele ia para o lixo. Na tela, o chat congelava depois do primeiro agente voltar e
   nunca mais se movia;
2. **`busy` mentia.** Fila vazia = `busy: false`, com o processo trabalhando. O painel
   dizia que nada rodava, o botão **Parar** desaparecia e o usuário não conseguia nem
   interromper;
3. **a ociosidade matava o processo trabalhando.** O temporizador era armado quando a fila
   esvaziava; um turno espontâneo mais longo que `CHAT_IDLE_MS` levava um `stdin.end()` no
   meio do trabalho (na conversa real os intervalos foram de ~4 min, com teto de 5).

E um quarto, de correlação: com um turno espontâneo em curso, o `result` **dele** fechava
o turno **do usuário** antes da hora — e a resposta verdadeira à mensagem dele virava
linha órfã, isto é, lixo.

#### O turno corrente

Não existe mais "a cabeça da fila recebe". Existe um **turno CORRENTE** explícito, que é
`null`, **nosso** (veio de um `send`) ou **espontâneo** (nasceu no CLI):

| Situação | O que acontece |
| --- | --- |
| chega linha e não há corrente, **com** turno nosso na fila | o primeiro da fila vira corrente e recebe **agora** o `turnStart` |
| chega linha e não há corrente, **sem** turno nosso na fila | nasce um corrente **espontâneo** e o **canal** recebe `autoStart` |
| chega qualquer outra linha | vai para o corrente (traduzida pelo `stream.js`, como sempre) |
| chega o `result` | encerra **o corrente**: se é nosso, `result` + `done`, fecha o SSE e sai da fila; se é espontâneo, o canal recebe o `result` traduzido e depois `autoEnd` |

Com isso o erro de correlação morre de graça: **nenhum `result` fecha um turno que ainda
não começou.** E mandar mensagem com um turno espontâneo rodando mostra a verdade — o
`ahead` conta o espontâneo, então o SSE recebe `queued { ahead: 1 }` e só ganha `turnStart`
depois do `autoEnd`.

#### O canal da conversa

O que é do turno espontâneo não tem SSE dono — então tem um **quadro de avisos por
conversa** (`services/chat/channel.js`), independente do runner: o processo morre e nasce,
o canal continua.

```
GET /api/chat/:id/events        (SSE, fica aberto por horas)
```

| Evento | Quando |
| --- | --- |
| `hello` | primeiro evento ao conectar: `{ pid, busy, pending }` (`pid: null` se não há processo vivo) |
| `autoStart` | um turno nasceu sem ser pedido daqui. `source: 'terminal'` quando veio do **arquivo** (é o terminal trabalhando); sem `source`, nasceu no nosso processo |
| eventos normais | `delta`, `message`, `tool`, `toolResult`, `notice`, `system`, `result` — **do turno espontâneo** |
| `autoEnd` | o turno espontâneo terminou |
| `peer` | `{ role, text, at }` — alguém **digitou no terminal** nesta conversa |
| `busy` | `{ busy, pending }` mudou — é o que mantém o **Parar** honesto |
| `gone` | o processo da conversa encerrou |

Três decisões que vêm com isso:

- **o canal não duplica o que já tem dono.** O que pertence a um turno nosso vai só para o
  SSE daquele turno; o navegador já está mostrando aquilo;
- **fechar a aba só desinscreve** — nunca mata processo. Inscrito com o SSE fechado é
  removido na primeira publicação seguinte;
- **keep-alive a cada ~25s** (um comentário SSE, `: keep-alive`): é um stream que fica
  aberto por horas, e conexão ociosa cai sozinha;
- **reconexão relê o disco.** O `EventSource` reconecta sozinho (servidor reiniciado,
  máquina suspensa, rede) — e o seguidor novo começa a olhar do **fim** do arquivo, então o
  que o terminal escreveu durante a queda não passa pelo canal. Por isso um `hello` que
  **não** é o primeiro pede uma releitura da conversa: sem isso a janela ficava
  silenciosamente desatualizada, que é a sensação de "não está em tempo real" sem nenhum
  aviso na tela. A releitura só acontece com a vista parada — recarregar em cima de uma
  resposta chegando apagaria dela justamente o que você não viu.

#### Seguir a conversa que roda NO TERMINAL

O canal tem **duas** fontes. A primeira é o nosso processo (acima). A segunda é o
**arquivo da conversa**, e existe por um problema concreto: com a conversa rodando no
terminal, a janela de leitura mostrava uma **foto** — para ver o passo seguinte era fechar
e abrir. Mas navegador e terminal são a mesma conversa e o **mesmo `.jsonl`**; então
enquanto alguém ouve o canal, o servidor acompanha o fim desse arquivo
(`services/chat/follow.js`) e publica o que aparece.

```
navegador abre o canal → followTranscript(id) → tick de ~1s (CHAT_FOLLOW_MS)
   linhas novas → transcriptEvents() → mesmos eventos do canal → a mesma bolha viva
```

| Linha do transcript | Vira |
| --- | --- |
| `assistant` (texto, `tool_use`, ou só `thinking`) | abre o turno (`autoStart { source: 'terminal' }`) e o conteúdo traduzido pelo **mesmo** `stream.js` |
| `user` com `tool_result` | `toolResult`, casado pelo id — é o CLI devolvendo resultado ao modelo, não fala de ninguém |
| `user` com texto | `peer` — a pessoa digitou no terminal |
| `system/turn_duration` | `autoEnd` (no transcript **não existe** linha `result`: o fim do turno é este) |
| `queue-operation`, `attachment`, `ai-title`, `file-history-*`, `custom-title`… | nada |

O que isso obriga a acertar, e por quê:

- **começa do FIM do arquivo**, medido de forma síncrona na hora em que o seguidor nasce.
  Se essa marca fosse tirada no primeiro `tick`, tudo que o terminal escrevesse até lá
  seria engolido; e se fosse do começo, a janela mostraria a conversa duas vezes (ela já
  leu o histórico do disco ao abrir);
- **pausa enquanto o processo é NOSSO.** Aí a resposta já sai pelo SSE do turno, e
  publicar o arquivo também mostraria tudo em dobro. O cursor **anda mesmo pausado**:
  sem isso, ao voltar, o histórico inteiro seria despejado de uma vez;
- **lê só os bytes novos** (o transcript é append-only): seguir um arquivo de 2 MB custa
  um `stat` por segundo. Linha pela metade espera o `\n`; caractere partido entre duas
  leituras espera o resto (é `StringDecoder`, não `toString()` — senão a linha vira lixo e
  a entrada some);
- **um seguidor por conversa**, com contagem de janelas: duas abas na mesma conversa
  publicariam cada linha duas vezes;
- **`peer` não abre nem fecha bolha.** Quem digita no terminal durante uma resposta não a
  interrompe — a mensagem entra na fila do CLI, e a resposta continua. Na mesma entrada
  podem vir o resultado de uma ferramenta **e** a fala: saem os dois, o do turno primeiro.

Ainda **não** é simétrico: o que se faz no navegador aparece no terminal só quando ele
relê o arquivo (`/resume`), porque o CLI de lá tem o histórico em memória. O que este
seguidor resolve é o lado que dói — ver, daqui, o que está acontecendo lá.

### Parar, tempo limite e ociosidade

- **Parar** (`POST /api/chat/:id/stop`) não é mais `SIGTERM`: o servidor escreve
  `{"type":"control_request","request":{"subtype":"interrupt"}}` no stdin. O CLI corta o
  turno em voo e o encerra com um `result` de erro (`error_during_execution`) — o runner
  reescreve esse `subtype` para **`interrupted`**, porque quem clicou "Parar" não errou
  nada, e a mensagem que chega ao navegador é *interrompido*;
- **o Parar corta o turno CORRENTE** — inclusive um que o CLI começou sozinho, que é
  justamente o caso em que antes o botão nem aparecia. Ele atende sempre que o processo
  está `working` (o mesmo critério do `/status`), e responde `stopped: false` quando não
  havia nada para cortar: um botão visível não pode devolver 404;
- **o interrupt NÃO descarta a fila.** As mensagens já escritas no stdin continuam
  valendo e o próximo turno começa em seguida (o `turnStart` dele sai normalmente). Se
  você quer descartar, aí é fechar o processo — hoje só a ociosidade faz isso;
- **tempo limite é por turno** (`CHAT_TIMEOUT_MS`): ao estourar, o **turno corrente**
  recebe um `notice` e é **interrompido** — inclusive quando ele é espontâneo (aí o aviso
  sai no canal). O processo **não** morre: matar levaria embora a fila e a sessão quente
  de todo mundo;
- **ociosidade é SILÊNCIO, não fila vazia** (`CHAT_IDLE_MS`, 5 min). O temporizador é
  rearmado a **cada linha** do stdout — subagente em segundo plano também escreve ali,
  então isso é sinal confiável de "vivo trabalhando" — e o stdin só fecha quando: **fila
  vazia + nenhum turno espontâneo em curso + silêncio** por todo o período. Era aqui que o
  processo tomava um `stdin.end()` no meio de um turno que o CLI havia começado sozinho;
- **`busy` não é "fila não vazia"**, é `fila > 0 || turno espontâneo em curso`. E existe
  também **`working`** = `busy || (agora − última linha < CHAT_QUIET_MS)`, o "acabou de
  escrever algo, ainda está de pé". É o `working` que alimenta `/:id/status` e o painel;
- **se o processo morrer sozinho** (crash), todo turno pendente recebe `error` + `done`,
  os SSE fecham e o runner sai do mapa — ninguém fica pendurado esperando uma resposta
  que não vem.

### Trocar de modo ou de modelo

Modo e modelo são **flags de linha de comando**, então viram a "assinatura" do processo:

| Situação | O que acontece |
| --- | --- |
| sem runner | cria o processo |
| mesma assinatura | **enfileira** — é o caminho normal, e não dá mais 409 |
| assinatura diferente, ocioso | fecha o processo antigo e sobe outro |
| assinatura diferente, respondendo | **409** `esta conversa está respondendo com outro modo/modelo; espere terminar para trocar` |

Trocar de modo **no processo vivo** existe no protocolo (`set_permission_mode`) e ficou
de fora de propósito: o modo é o que decide se o Claude pode editar o seu disco, e
mudar isso no meio de uma fila de turnos é justamente onde um acidente passaria
despercebido. Se um dia entrar, é aqui que se documenta.

### Fechar a aba não mata nada (e agora nem podia)

Um processo serve **vários turnos e vários clientes**, então o servidor não pode mais
matá-lo quando uma conexão cai. Cliente que vai embora só perde o stream: o SSE é
marcado como morto, o turno segue no Claude e grava no `.jsonl` — você vê o resultado
ao reabrir a conversa. Para interromper de verdade, use **Parar**.

## Arquivos do serviço

Cada arquivo, uma responsabilidade (o `repo.js` de antes fazia as seis coisas):

| Arquivo | O quê |
| --- | --- |
| `services/chat/bin.js` | onde está o binário `claude` e o PATH do filho |
| `services/chat/args.js` | modos de permissão e a montagem dos argumentos |
| `services/chat/protocol.js` | as linhas que **escrevemos** no stdin (mensagem do usuário, interrupt) |
| `services/chat/child.js` | o processo filho e o corte do stdout **linha a linha** |
| `services/chat/timers.js` | os dois relógios: ociosidade (por silêncio) e tempo limite do turno |
| `services/chat/channel.js` | o **canal** por conversa: quem ouve o que não tem turno dono |
| `services/chat/follow.js` | segue o `.jsonl` da conversa (é assim que o **terminal** aparece aqui) |
| `services/chat/transcript-events.js` | regra pura: uma linha do transcript → eventos do canal |
| `services/chat/runner.js` | o **processo vivo** por conversa: fila, **turno corrente**, `queued`/`turnStart`, interrupt |
| `services/chat/oneshot.js` | execução única — sobrou para o `/compact` |
| `services/chat/validate.js` | texto, imagens e pasta |
| `services/chat/runners.js` | o registro `conversa → processo vivo` e a regra "dá para reaproveitar?" |
| `services/chat/repo.js` | cola: valida, resolve a conversa e escolhe entre runner e execução única |
| `services/chat/stream.js` | tradutor de uma linha do stream-json em eventos do contrato |

O `runner.js` recebe o `spawn` **por parâmetro** (padrão: o do `node:child_process`) —
é assim que [o teste](13-testes.md) prova o comportamento sem chamar o CLI de verdade.

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

No back não há caminho especial: **toda** mensagem já vai pelo stdin em
`--input-format stream-json`, então a imagem é só mais um bloco no mesmo `content`:

```json
{"type":"user","message":{"role":"user","content":[
  {"type":"text","text":"que erro é esse?"},
  {"type":"image","source":{"type":"base64","media_type":"image/png","data":"<...>"}}
]},"parent_tool_use_id":null}
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
# no .env (o docker-app.sh cria; 0 deixa o chat só-leitura)
CHAT_ALLOW_FULL_TOOLS=1
```

O motivo: em modo headless **não existe o "perguntar antes"** do terminal — o modo já
libera ou não. Deixar um modo que edita/executa a um clique numa página web é convite a
acidente, então habilitá-lo é uma decisão consciente na hora de subir o servidor.
("plano" e "só conversa" não alteram nada, então não precisam da variável.)

## Variáveis de ambiente

| Variável | Padrão | O quê |
| --- | --- | --- |
| `CHAT_MAX_USD` | (sem teto) | teto de gasto por mensagem (`--max-budget-usd`) — só se você definir. Numa assinatura não faz sentido; útil só com API paga por token |
| `CHAT_TIMEOUT_MS` | `900000` (15 min) | tempo limite **por turno**: ao estourar, o turno é interrompido (o processo continua vivo). No `/compact`, que é execução única, ainda mata |
| `CHAT_IDLE_MS` | `300000` (5 min) | quanto **silêncio** (sem linha nenhuma no stdout, sem fila e sem turno espontâneo) até o stdin ser fechado |
| `CHAT_QUIET_MS` | `30000` (30 s) | janela em que a última linha do stdout ainda conta como "trabalhando" (`working`) |
| `CHAT_FOLLOW_MS` | `1000` (1 s) | de quanto em quanto tempo o servidor olha o fim do `.jsonl` da conversa aberta, para mostrar o que o **terminal** está fazendo |
| `CHAT_ALLOW_FULL_TOOLS` | (desligado) | `1` habilita os modos "automático" e "aceitar edições" |
| `MAX_BODY_BYTES` | `31457280` (30 MB) | limite do corpo da requisição (imagens base64 são grandes) |
| `CLAUDE_BIN` | (auto) | caminho do binário `claude`. Por padrão é resolvido sozinho (PATH + locais conhecidos como `~/.npm-global/bin`); defina só se o servidor não achar o CLI |
| `CHAT_ENTRYPOINT` | `claude-manager-web` | como a conversa fica marcada no transcript (`CLAUDE_CODE_ENTRYPOINT` do filho). Mexer aqui muda se ela aparece no `/resume` do terminal — ver abaixo |

## Aparecer no `/resume` do terminal

Conversa criada pelo navegador **existia no disco e não aparecia** no `/resume` do
terminal. Nada de índice corrompido nem de título faltando: o `/resume` lista os
`.jsonl` da pasta do projeto, mas **descarta** os que têm `entrypoint` de SDK. No
binário do CLI:

```js
e4r = new Set(["sdk-cli","sdk-ts","sdk-py"]);
if (!souSdk && e4r.has(sessao.entrypoint)) return log(`filtered from /resume: entrypoint=…`), null;
```

E quem marca `sdk-cli` é a **própria flag `-p`** — a que liga o headless, sem a qual este
serviço não existe. Comprovado nos dados: nas conversas do navegador a primeira linha
traz `entrypoint: "sdk-cli"` / `promptSource: "sdk"`; nas do terminal, `entrypoint: "cli"`.

Correção: o filho nasce com `CLAUDE_CODE_ENTRYPOINT` fora daquele conjunto
([`bin.js`](#arquivos-do-serviço)). O valor `claude-manager-web` tem o bônus de dizer de
onde a conversa veio. **`'cli'` não serve** — o CLI reescreve para `sdk-cli` quando está
em modo SDK; foi testado.

Duas coisas para não se enganar:

- **conversas antigas continuam escondidas.** O `entrypoint` está gravado linha por
  linha no transcript, e nada aqui reescreve histórico. Para essas, o caminho por id
  funciona (o filtro só existe na *lista*):

  ```bash
  cd ~/www/projeto && claude --resume <uuid-da-conversa>
  ```
- o filtro do CLI é interno e pode mudar de nome. Se um dia voltar a esconder, o lugar
  de olhar é este, e o `CHAT_ENTRYPOINT` existe justamente para testar outro valor sem
  editar código.

## Rotas

| Método | Rota | O quê |
| --- | --- | --- |
| POST | `/api/chat` | **inicia** uma conversa nova `{ cwd, text, mode, model, images }` em SSE |
| POST | `/api/chat/:id` | envia `{ text, mode, model, images }` e devolve a resposta em SSE |
| POST | `/api/chat/:id/compact` | compacta o contexto (`/compact`), também em SSE |
| POST | `/api/chat/:id/stop` | **interrompe** o turno em andamento (a fila continua) |
| GET | `/api/chat` | processos de chat vivos (`id`, `pid`, `startedAt`, `kind`, `busy`, `working`, `auto`, `pending`, `lastOutputAt`) |
| GET | `/api/chat/:id/events` | **canal da conversa** em SSE: `hello`, `autoStart`/`autoEnd`, `busy`, `gone` |
| GET | `/api/chat/:id/status` | `{ running: true|false }` — `running` = **trabalhando agora** (o `working`) |

`:id` é o mesmo id composto das conversas: `<pastaDoProjeto>:<sessionId>`.

Exemplo:

```bash
curl -sN -X POST "localhost:7788/api/chat/-home-fernando:57316179-…" \
  -H 'content-type: application/json' \
  -d '{"text":"Responda apenas: OK","mode":"none"}'
```

```
data: {"type":"init","sessionId":"…","cwd":"/home/fernando","mode":"none","pid":45497}
data: {"type":"turnStart"}
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
| `init` | `conversationId`, `sessionId`, `cwd`, `mode`, `kind`, `images`, `pid` | turno aceito (`images` = quantas imagens; `kind`: `message`/`compact`/`new`) |
| `queued` | `ahead` | **só quando há espera**: quantos turnos estão na frente deste |
| `turnStart` | — | a primeira linha DESTE turno chegou: o Claude está respondendo a ELE |
| `system` | `model` | modelo escolhido |
| `delta` | `text` | pedaço de texto (streaming) |
| `message` | `text` | bloco de texto completo |
| `tool` | `id`, `name`, `summary`, `input`, `inputTruncated`, `parentId` | **chamou** uma ferramenta (`input` já em texto). `parentId` = id do `Agent` que a disparou (`null` na thread principal) |
| `toolResult` | `id`, `text`, `truncated`, `isError`, `ack`, `parentId` | o que a ferramenta **devolveu** (casa pelo `id`). `ack: true` = é só o aceite do disparo de um agente, **não** trabalho entregue |
| `agentStart` | `id`, `name`, `agentType`, `model`, `parentId` | soltou um **agente**. `name` é o que ele foi fazer (`description`); o `id` é o do `tool_use`, e é por ele que o fim se casa |
| `agentEnd` | `id`, `summary`, `result`, `status`, `taskId` | o agente **voltou**, com o relatório dele. Pode chegar minutos depois, em outro turno — ou em nenhum |
| `compact` | `ok`, `message` | resultado da compactação (só no `/compact`) |
| `notice` | `message` | stderr, aviso de limite de uso |
| `result` | `ok`, `subtype`, `costUsd`, `turns`, `durationMs` | fim **deste** turno. `subtype: 'interrupted'` = cortado pelo **Parar** (ou pelo tempo limite), não é erro de execução |
| `error` | `message` | falhou (id inválido, modo proibido, processo morreu) |
| `done` | `code`, `signal` | stream **deste turno** fechado (o processo pode continuar vivo) |

Os eventos que **não** pertencem a um turno nosso (`hello`, `autoStart`, `autoEnd`,
`busy`, `gone`, mais os normais do turno espontâneo) chegam pelo
[canal da conversa](#o-canal-da-conversa), não por este stream.

### Agentes em segundo plano

Um agente **não** é uma ferramenta comum, e tratá-lo como tal produzia a tela errada. O
que o CLI grava, medido num transcript de verdade:

| Sinal | Quando | O que é |
| --- | --- | --- |
| `tool_use` `Agent` (ou `Task`) com `description`/`subagent_type` | no disparo | o agente **nasceu** |
| `tool_result` "Async agent launched successfully… agentId: a96a…" | ~3 s depois | só o **aceite** do disparo — não é o trabalho. Mas é aqui que vem o **id estável** do agente |
| `<task-notification>` numa entrada `user`, com `<tool-use-id>`, `<status>`, `<summary>`, `<result>` | quando ele para (minutos depois) | o agente **terminou**, e aqui está o relatório |
| `pendingBackgroundAgentCount` no `system/turn_duration` | a cada turno, **só quando é maior que zero** | quantos ainda estão de pé; **ausente = nenhum** |

Daí três eventos separados no contrato (`agentStart`, `toolResult { ack }`, `agentEnd`) e
o desenho da tela:

- **cada agente é um bloco próprio** da conversa ([`agent-card`](11-componentes.md#agent-cardjs)),
  com relógio vivo, e não um chip no pé de uma mensagem. Ele trabalha por dez, doze
  minutos: desenhado como ferramenta, aparecia **resolvido em 3 s** (pelo aceite) e
  enterrado dentro de uma bolha já terminada;
- **quem está de pé aparece no rodapé**, acima da caixa de escrever
  ([`agent-strip`](11-componentes.md#agent-stripjs)) — é o painel fixo que o terminal tem.
  Sem isso, saber se o agente ainda vive exigia rolar o feed para trás;
- **o cartão é da CONVERSA, não do turno.** O disparo acontece num turno e o aviso de fim
  chega em outro (ou em nenhum), então o registro `id → cartão` vive no nível da conversa.
  Com um registro por resposta, o relatório caía numa resposta que nunca viu o disparo: o
  cartão original ficava "rodando…" para sempre e o relatório aparecia duplicado;
- **o aviso de fim não abre turno.** Ele chega sozinho; deixá-lo abrir uma bolha viva
  acenderia um indicador que nada iria apagar;
- **o casamento é pelo id ESTÁVEL do agente** (`agentId` do aceite = `<task-id>` do aviso),
  não pelo `tool_use` do disparo. Quando o CLI **retoma** um agente (manda mensagem para
  ele), o aviso seguinte traz o `tool-use-id` **daquela** chamada — medido num transcript
  real. Casando só pelo disparo, aquele relatório não achava dono e o cartão ficava
  "rodando…" com doze minutos de trabalho perdidos. O id estável nunca vai para a tela: o
  próprio CLI pede para não mostrá-lo.

**Nem todo agente que termina tem aviso no arquivo.** Medido: o terminal deu uma frente
como concluída (`Agent "Lane 2 colisão e tenant dos claims" finished · 15m 4s`) e **não
existe** `<task-notification>` dela no `.jsonl`. Nesses casos a única evidência é o
contador do turno seguinte — e é por isso que, por alguns instantes, a janela pode mostrar
um agente a mais que o terminal: ele sabe de memória, nós sabemos do arquivo. Não há como
descobrir isso mais cedo sem inventar.

**Agente sem aviso de fim: o contador do CLI resolve.** Numa conversa de verdade havia
**16** agentes lançados, **8 sem `<task-notification>`** — 4 de ontem (o aviso se perdeu,
provavelmente num `/compact`) e 4 rodando naquele momento —, com o
`pendingBackgroundAgentCount` dizendo **4**.

A regra: **em ordem cronológica**, a cada contador do arquivo, se há mais agentes sem
aviso do que o número diz, os **mais antigos** são encerrados como *"sem aviso de fim"*
(`status: 'unknown'`) até a conta fechar. O número é autoridade sobre a **quantidade**; a
ordem "mais antigo primeiro" é a única defensável, porque um agente de uma sessão de ontem
não sobrevive ao processo que o hospedava.

**E o campo ausente conta como zero** — medido, não suposto. Num arquivo real de 110 fins
de turno: os 4 que fecharam com agente vivo trouxeram o campo (`1`), nenhum turno com
agente vivo veio sem ele, e depois que os agentes acabaram o CLI simplesmente **parou de
escrever o campo** (mesma versão do CLI nos dois casos — ele omite quando é zero).

Ler ausência como *"não sei"* era um bug com cara de fantasma: um agente disparado em 25/08
seguia na faixa do rodapé com o relógio em **8678 min** seis dias depois, enquanto o
terminal — o mesmo CLI, na mesma conversa, vivo — não mostrava agente nenhum. Quem
percebeu foi o dono, justamente comparando as duas telas.

**A trava contra a regressão oposta:** só concluímos zero por ausência se aquele arquivo já
provou que o CLI que o escreveu usa o campo. Num `.jsonl` que nunca o traz, ausência volta a
não decidir nada e quem está de pé continua de pé — apagar da tela um agente que está
trabalhando seria a outra mentira.

Duas tentativas erradas antes disso, e por que doeram:

1. **marcar todos como "não sei"** quando a conta não fecha — apagava justamente os 4 que
   estavam trabalhando naquele instante (a janela reabria sem faixa nenhuma, com o terminal
   mostrando "Waiting for 4 background agents");
2. **julgar no fim do arquivo** em vez de a cada contador — o aviso que chega **depois** do
   contador (aconteceu: o contador viu 5 de pé e um deles só reportou depois) derrubava o
   agente errado.

Contador ausente (`null`, e existem) não decide nada. E quem está de pé vem no
**resumo da leitura** (`agents`, em [03](03-api.md#conversas)), calculado sobre o arquivo
INTEIRO: "quem está rodando" não pode depender de até onde você rolou — ao reabrir a
janela, o disparo pode estar 200 mensagens atrás.

Não mostramos **tokens por agente** como o terminal: aquele número é do processo que
hospeda o agente, e não está no arquivo. Preferimos não ter o campo a inventá-lo.

### Ferramentas: o que dá para ver

O chip de cada ferramenta é clicável ([`tool-call`](11-componentes.md#tool-calljs)) e
abre o **pedido** e o **resultado**. Vale para qualquer ferramenta — `Bash`, `Edit`. Ele
é um **bloco na sequência da conversa**, não um chip dentro da bolha: a caixa de mensagem
tem só o texto do main, e a ordem na tela é a ordem em que as coisas aconteceram.

O chip também traz um **resumo** ao lado do nome, para identificar a chamada sem abrir:
`⚙ Agent · Explore · Recon do login`, `⚙ Bash · git status`, `⚙ Edit · core/ui.js`. Quem
monta é o `summaryOf()` do `core/claude-blocks.js`, e ele é **genérico**: escolhe o
primeiro campo útil do `input` (`description`, `command`, `pattern`, `query`, `url`,
`file_path`, `path`, `name`), com `subagent_type` na frente quando existe. Campo de
caminho mostra as duas últimas partes (o nome do arquivo é o que identifica); nos outros
o corte vai no fim, porque ali quem identifica é o começo (`git status …`). Ferramenta
nova que use um desses campos ganha resumo sem ninguém mexer no código.

Vale **ao vivo e ao reabrir a conversa**: a leitura do histórico devolve os mesmos blocos
estruturados ([03](03-api.md#conversas)), então a interface tem um só caminho de render. Isso importa porque, no fim de cada resposta, o painel chama
`chat.reload()` e redesenha a conversa a partir do disco — enquanto o histórico
achatava ferramenta em texto, o chip vivia poucos segundos e sumia.

O par `tool` → `toolResult` é casado pelo `id` (o `tool_use_id` do CLI). Dois detalhes
que a interface trata sem inventar:

- **teto de 4000 caracteres** por lado (`MAX_DETAIL` em `core/claude-blocks.js`): o
  prompt de um subagente e o retorno de um `Read` são grandes demais para o SSE. Quando
  corta, o evento traz `inputTruncated`/`truncated` e a tela **diz** que cortou;
- **ferramenta que não devolve nada** no stream não fica "executando…" para sempre: ao
  fim da resposta o chip passa a dizer *"sem resultado registrado neste stream"*.

O que **não** dá para mostrar, e não é limitação da interface:

### O trabalho do subagente aparece ANINHADO (corrigido)

Cada linha do stream que vem de um subagente traz **`parent_tool_use_id`** — o id do
`tool_use` que criou aquele agente. O tradutor propaga isso como `parentId`, e a
interface encaixa a chamada **dentro do chip do `Agent`**: você só vê os passos
expandindo o agente, como no terminal. Vale em qualquer profundidade — agente que chama
agente aninha de novo, porque o filho também entra no mapa e passa a ser pai do neto.

```
▸ ⚙ Agent  Explore · Resumir core/   3 passos     ← fechado: só o contador
▾ ⚙ Agent  Explore · Resumir core/   3 passos
    pedido     { subagent_type: "Explore", prompt: "…" }
    passos   │ ▸ ⚙ Bash  ls core/
             │ ▸ ⚙ Bash  grep -rn "export"
             │ ▸ ⚙ Agent  sub-sub          ← e este tem os passos DELE dentro
    resultado  o relatório que o agente devolveu
```

Três decisões que vêm com isso:

- **prosa de subagente não entra na bolha principal.** Um bloco de `text` com
  `parent_tool_use_id` é descartado: o relatório do agente chega inteiro como
  **resultado** do `Agent`, e duplicar só confundiria quem fez o quê;
- **o indicador não muda de rótulo.** Quando o `Bash` é do subagente, o cabeçalho segue
  dizendo `usando Agent…` — dizer "usando Bash" mentiria sobre quem está trabalhando;
- **pai desconhecido aparece solto.** Se um `parentId` não casar com nenhum chip na tela,
  a chamada é mostrada no nível de cima em vez de desaparecer.

Detalhe medido: os **deltas** (`stream_event`) **nunca** trazem `parent_tool_use_id`, então
texto ao vivo é sempre da thread principal — não há risco de o texto do subagente vazar
como se fosse do Claude principal.

> **Antes estava escrito aqui que isso era impossível.** A medição que sustentava a
> afirmação (583 chamadas de `Agent`, zero linhas com `isSidechain:true`) olhava o
> **transcript do pai** — e ali realmente não há nada. O erro foi concluir daí que o
> *stream* também não tinha. Tem, e sempre teve: era o `parent_tool_use_id` que estávamos
> ignorando, e por isso o trabalho dos subagentes era despejado no mesmo nível.

### No disco: o que sobra ao reabrir a conversa

O transcript do pai grava **só** a chamada do `Agent` e o resultado dela. Os turnos do
subagente vão para um arquivo próprio:

```
~/.claude/projects/<projeto>/<sessionId>/subagents/agent-<agentId>.jsonl
```

com `isSidechain: true`, `agentId`, o `sessionId` do pai e `parentUuid`. Consequência
hoje: **ao vivo os passos aparecem aninhados; ao reabrir a conversa fica o chip do
`Agent` com o resultado, sem os passos.** Não é limite do canal — é feature ainda não
feita (ler esses arquivos e casar com o `tool_use` do pai; agentes em paralelo
compartilham o `parentUuid`, então o desempate tem de ser pelo prompt).

Em **background**, o `tool_result` do `Agent` é só o recibo
(`"Async agent launched successfully. agentId: …"`) — o relatório chega depois, por outro
caminho: o CLI enfileira um `<task-notification>` e **abre um turno novo por conta
própria**. É exatamente o caso de
[Turnos que nascem sozinhos](#turnos-que-nascem-sozinhos-o-cli-começa-por-conta-própria),
e é por ele que aquele relatório aparece no **canal** da conversa em vez de virar lixo.

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
claude -p --input-format stream-json --session-id <uuid> --model <alias> \
  --output-format stream-json --verbose ...
# a primeira mensagem entra pelo stdin, como todas as outras
```

O caminho é o mesmo do resto: quem nasce já nasce com um **runner** vivo, então a
segunda mensagem não espera processo novo — só `--session-id` no lugar de `--resume`.

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

Ele é a **única** execução única que sobrou (`oneshot.js`), de propósito: a compactação
reescreve o contexto do transcript, e dois processos escrevendo o mesmo `.jsonl` se
atropelariam. Então, antes de compactar, o servidor **fecha** o processo vivo da
conversa se ele estiver ocioso — e recusa com **409** se ela estiver respondendo
(`esta conversa está respondendo; espere terminar para compactar`). O contrário também
vale: mandar mensagem enquanto compacta dá 409. Aqui o `/stop` ainda é `SIGTERM`, que é
o único jeito de parar uma execução única.

É o mesmíssimo `/compact` que você digitaria no terminal — o Claude resume o
histórico e grava o marcador de compactação **no próprio transcript**. As mensagens
antigas continuam no arquivo; o que diminui é o contexto que cada turno seguinte
carrega. Depois de compactar, o painel relê o transcript e o medidor cai.

**Não existe "% de progresso" para o compactar** — o `/compact` headless é opaco, não
reporta andamento. Em vez de inventar uma barra falsa, enquanto roda o medidor mostra
o indicador vivo ([`activity.js`](11-componentes.md#activityjs)): bolinha pulsando,
barra indeterminada e **tempo decorrido**. Ao terminar, o toast dá o feedback honesto
que interessa — o antes→depois, ex.: `269k → 41k (−85%)`.

Enquanto compacta, a caixa de escrever fica **travada de verdade**
(`composer.setLocked(true, 'compactando…')`) — e o placeholder diz o porquê. Essa é a
diferença entre travar e "estar respondendo": mensagem durante uma resposta **sai na
hora** e o Claude a pega na vez dela, mas durante o `/compact` não há fila nenhuma,
porque o histórico está sendo reescrito debaixo dela. Ver a tabela em [`composer`](11-componentes.md#composerjs).

O tamanho do contexto (ex.: `contexto 258k / 1M`) vem do campo `usage` do último
turno do assistant no transcript: `input_tokens + cache_read + cache_creation`. A
janela é inferida (200k, ou 1M quando o uso já passou de 200k) porque o transcript
não a informa. Sem `usage` no arquivo (conversa que nunca teve resposta), mostra `—`.

Esse contrato é o que o componente [`chat.js`](11-componentes.md) consome — outro
serviço que emita os mesmos eventos reaproveita a interface inteira.

## Proteções

- **um processo por conversa**: mandar mensagem enquanto ela responde é **normal** e
  **não** dá mais 409 — a linha vai para o stdin na hora e o CLI enfileira. O 409 sobrou
  para o que é de fato incompatível: trocar de modo/modelo com a conversa respondendo, e
  cruzar chat com `/compact`;
- **fechar a janela NÃO mata o processo**: cada conversa abre numa
  [janela flutuante](11-componentes.md#floating-windowjs); fechá-la destrói o chat com
  `abort: false`, então a resposta em andamento **termina em segundo plano** (grava no
  `.jsonl`) e você a vê ao reabrir. Para interromper de verdade, use o botão **Parar**
  na caixa, ou encerre o processo em **Sessões** (o `claude -p` aparece lá com seu PID);
- **aba/navegador fechados também não matam nada**: o processo serve vários turnos e
  vários clientes, então a conexão que cai só perde o stream (o SSE é marcado como morto,
  e no canal ela apenas se desinscreve). O órfão de verdade quem recolhe é a
  **ociosidade** — e ela conta **silêncio**, então nunca desliga um processo que está
  produzindo saída (era assim que um turno espontâneo longo morria no meio);
- **timeout por turno** vindo das variáveis acima — ele **interrompe** o turno, não mata
  o processo (e **teto de gasto** opcional, se você definir `CHAT_MAX_USD` — desligado
  por padrão);
- **aviso de conflito**: se um terminal está com essa conversa aberta **e dá para provar**
  (o comando dele traz `--resume <este id>`), uma faixa amarela avisa antes de você
  escrever (os dois gravam no mesmo arquivo). Sem prova, nada é dito — ver
  [06 · Interface](06-interface.md);
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
- **sem injeção no meio do turno**: a mensagem escrita durante uma resposta entra na
  vez dela, não no meio do raciocínio. O CLI não oferece outro caminho, e este é o que o
  terminal faz;
- **a fila mora no CLI, não no servidor nem na aba**: o que já foi escrito no stdin
  **não volta**. Fechar a janela não descarta mais nada (antes descartava, porque a fila
  era do navegador) — e o `Parar` corta só o turno em voo, não o resto da fila;
- **trocar de modo/modelo com a conversa respondendo dá 409**; não há troca a quente
  (veja [Trocar de modo ou de modelo](#trocar-de-modo-ou-de-modelo));
- **`--fork-session` não é usado**: continuar sempre grava na mesma conversa. Se
  quiser "ramificar", é um campo novo no composer e a flag no `args` — 3 linhas.
