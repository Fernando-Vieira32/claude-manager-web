# 13 · Testes

[← sumário](README.md)

Testes automatizados **sem dependência nenhuma**: o Node 18+ já traz o runner
(`node:test`) e as asserções (`node:assert`). Nada de `npm install`, nada de
`node_modules` — a regra "sem dependências, sem build" continua de pé.

## Rodar

```bash
./docker-app.sh test  # a suíte DENTRO do container (mesmo Node para todo mundo)

npm test              # ou direto na máquina, se você tiver Node 18+
npm run test:watch    # reroda ao salvar

node --test "test/*.test.js"                      # equivalente ao npm test
node --test --test-reporter=spec test/settings.test.js   # um arquivo só
```

O app **só roda em container** ([14 · Docker](14-docker.md)), mas a suíte não: ela testa
funções puras e nunca sobe o servidor, então roda dos dois lados. `./docker-app.sh test`
existe para quem não quer instalar Node — e é o jeito de garantir que todos testam na
mesma versão.

Cada arquivo roda em um **processo próprio** (é assim que o `node --test` funciona),
o que é essencial aqui — veja o sandbox abaixo.

## O que está coberto

| Arquivo | Cobre |
| --- | --- |
| `test/trash-purge.test.js` | expurgo por idade: validação de `value`/`unit`, `dryRun` não apagando, corte em dias/meses/anos, lixeira vazia, arquivo que não é `.jsonl` |
| `test/trash-lifecycle.test.js` | deletar → lixeira → restaurar: conteúdo preservado, padrão do nome, `deletedAt` vindo do nome (não do `mtime`), travessia de diretório recusada |
| `test/settings.test.js` | os **dois escopos** (global e por conversa) contra os mesmos casos: mesclagem PATCH, `''`/`null` removendo chave, chave/valor inválidos, teto de 16 KB, arquivo ilegível, escopos não se misturando |
| `test/settings-concurrency.test.js` | regressão do bug de gravação concorrente (ver [07](07-seguranca.md)) |
| `test/claude-models.test.js` | resolução modelo → janela de contexto: sufixo `[1m]`/`-fast` removido, alias resolvendo para o mais novo da família, `<synthetic>` ignorado, ausência de catálogo devolvendo `null` em vez de um número inventado |
| `test/claude-blocks.test.js` | o `core/claude-blocks.js`, que os **dois** serviços usam: teto de tamanho, blocos → texto, imagem sem base64, a regra do resumo do chip (caminho pelo fim, comando pelo começo), e o julgamento "isto é fala de gente?" (`messageText`/`isNoiseText`), que o leitor de conversas e o seguidor do terminal precisam fazer igual |
| `test/chat-stream.test.js` | tradução do stream-json do CLI (`services/chat/stream.js`): linha entra, eventos do contrato saem — ferramenta com `id`/`input`, `toolResult` casado, teto de tamanho, linha quebrada, tipo desconhecido, custo/turnos, limite de uso, turno **interrompido** não sendo chamado de erro de execução, **e o `parentId` do subagente** (chamada de dentro do agente aponta para quem a criou, agente-dentro-de-agente mantém a corrente, prosa de subagente não vira mensagem da conversa) |
| `test/chat-runner.test.js` | o **processo vivo** por conversa (`services/chat/runner.js`): as duas mensagens já escritas no stdin com o turno 1 em voo, `queued`/`turnStart` na ordem certa (e o `turnStart` saindo na **primeira linha** do turno, não no envio), evento do turno em voo não vazando para quem espera, `result` fechando só aquele SSE, interrupt virando `subtype: 'interrupted'` sem descartar a fila, processo morrendo → `error`+`done` em todos os pendentes, tempo limite interrompendo (não matando) — **e o turno que o CLI começa sozinho**: nasce no canal (`autoStart` → eventos → `result` → `autoEnd`) sem descartar nada, o `result` dele não consome quem está na fila, mensagem durante ele recebe `queued { ahead: 1 }`, `busy`/`working` honestos, ociosidade por **silêncio** (não fecha o stdin com saída chegando nem com turno em curso; fecha depois do silêncio) |
| `test/claude-agents.test.js` | o `core/claude-agents.js`, que os **dois** serviços usam: `Agent`/`Task` reconhecidos (e nada mais), o **aceite do disparo** ("Async agent launched successfully") distinguido do relatório, o **id estável** (`agentId`) saindo do texto do aceite, o `<task-notification>` rendendo id do disparo/status/resumo/relatório, relatório com quebras e `<` saindo inteiro, aviso truncado sem estourar |
| `test/chat-transcript-events.test.js` | uma linha do **transcript** virando evento do canal (`services/chat/transcript-events.js`) — é como o que roda **no terminal** aparece na janela: `assistant` abrindo o turno com `source: 'terminal'` (inclusive quando só pensou), `tool_use`/`tool_result` casados pelo id, `system/turn_duration` como fim do turno (no transcript **não existe** linha `result`), fala digitada no terminal virando `peer` sem interromper a resposta, resultado **e** fala na mesma entrada saindo os dois, marcador do CLI e linha pela metade ignorados |
| `test/chat-follow.test.js` | seguir o `.jsonl` da conversa (`services/chat/follow.js`), com arquivo de verdade e `tick()` chamado à mão: só o que acontece **a partir de agora** (o histórico a janela já leu do disco), linha pela metade esperando o `\n`, caractere partido entre duas leituras, **pausado** não publicando mas andando o cursor, arquivo que encolheu recomeçando do novo fim, e um seguidor só para N janelas na mesma conversa |
| `test/chat-channel.test.js` | o **canal** por conversa (`services/chat/channel.js`): publicar sem inscrito não estoura, dois inscritos recebem, canais não se misturam, desinscrever para de receber, SSE fechado (ou que estoura ao escrever) sai da lista sozinho |
| `test/conversations-messages.test.js` | leitura do histórico em **blocos**, na ordem: prosa e chamada da mesma mensagem virando dois blocos, `tool_result` costurado pelo id, mensagem só-de-ferramenta não descartada, resultado órfão, várias ferramentas numa mensagem — **e o agente**: bloco próprio (não ferramenta), o aceite do disparo NÃO o encerrando, o `<task-notification>` entregando o relatório no bloco dele dez minutos depois (com a duração tirada dos dois carimbos), agente que falhou marcado, aviso de agente de outra conversa não quebrando a leitura, agente síncrono terminando pelo próprio resultado — **e a conciliação pelo contador**: contador ausente depois de o arquivo já ter mostrado o campo conta como zero (era o agente com relógio de 6 dias), mas arquivo que nunca mostrou o campo não decide nada (a trava que impede apagar da tela quem está trabalhando) |
| `test/message-suffix.test.js` | a frase fixa do fim da mensagem (`public/js/core/message-suffix.js`): separador de parágrafo, desligado não mexe, frase vazia não mexe, não empilha quando a mensagem já termina com ela, mensagem vazia vira só a frase |
| `test/response-end.test.js` | o que pode acontecer quando **uma** resposta termina (`public/js/core/response-end.js`): com outra resposta em voo não recarrega o feed nem oferece botões, depois de erro/interrupção também não (recarregar apaga a explicação da tela), e a caixa só sai de "respondendo" quando não sobra nada em voo — **e a espera pelo disco** (`turnOnDisk`/`waitTurnOnDisk`): última mensagem ainda sendo a do usuário ou a resposta *anterior* conta como "não chegou", resposta posterior ao envio libera, data ilegível não trava, sem envio pendente nem consulta o disco, e o teto devolve `false` (quem chamou não recarrega) sem dormir depois da última tentativa |
| `test/chat-runners-registry.test.js` | quando um processo vivo é reaproveitado (`services/chat/runners.js`): mesma assinatura reaproveita **mesmo respondendo** (a mensagem entra na fila dele, sem tocar no disco), assinatura diferente recusa com 409 se está respondendo e devolve `null` se está ocioso, processo morto nunca é reaproveitado, e `forget` não apaga um substituto já registrado |
| `test/channel-route.test.js` | para onde vai cada evento do canal (`public/js/core/channel-route.js`): o **segundo** `hello` pedindo releitura do disco (o canal caiu e voltou; o que passou na queda não veio pelo canal), `autoStart` abre a bolha, conteúdo alimenta a que está aberta, `autoEnd`/`gone` encerram, conteúdo sem aviso de início abre em vez de sumir, `hello`/`busy` não sujam a tela, e a fala vinda do terminal (`peer`) indo ao feed sem abrir nem fechar bolha |
| `test/auto-turn-watcher.test.js` | o que aparece na vista quando chega algo pelo canal (`public/js/components/auto-turn-watcher.js`, com um `chat` de mentira): UMA bolha por turno espontâneo, o "Parar" só LIGA pelo canal (desligar é do chat, que sabe se há envio seu em voo), `gone` encerra a bolha aberta, `destroy` mata o timer dela — e a conversa conduzida no terminal: bolha com rótulo próprio ("no terminal…"), fala de lá entrando no feed sem interromper a resposta que está chegando |
| `test/chat-entrypoint.test.js` | o ambiente do processo `claude` (`services/chat/bin.js`): a conversa é marcada com um `entrypoint` que o `/resume` **não** filtra (nem `sdk-*` nem `cli`), o diretório do binário vai na frente do PATH, e `CHAT_ENTRYPOINT` permite escolher outro valor |
| `test/sessions-conversation-id.test.js` | como uma sessão é identificada: id **declarado** no comando (`--resume`/`-r`/`--session-id`) versus palpite, `--continue`/`--resume` sem valor não declarando nada, uuid solto nos argumentos não valendo, e `-p`/`--print` (headless) sem confundir com `--permission-mode` |

Os dois últimos cobrem a mesma regra pelos dois lados — ao vivo (stream) e relido
(disco) — porque foi justamente a **divergência** entre esses dois caminhos que criou o
bug do chip que sumia. Hoje os dois passam pelo `core/claude-blocks.js`.

Fora de escopo: `toast`, componentes e painéis. Testar DOM exigiria trazer jsdom ou
Playwright como dependência — o custo não paga, e quebraria a premissa do projeto.
O front continua sendo verificado à mão, no navegador.

### Quando o front tem lógica de verdade: arnês descartável

"Verificar à mão" funciona para desenho, não para **regra**. O envio do
[`chat`](11-componentes.md#chatjs) (mandar durante uma resposta sai na hora, cada
mensagem tem a sua bolha, a que espera diz "na fila", o "Parar" pede o corte lá) é
lógica pura embrulhada em DOM — clicar no navegador não prova que a segunda mensagem
não ficou presa.

Para esses casos vale um **arnês descartável**, fora de `test/`: um `document` de mentira
de ~40 linhas (`createElement` devolvendo um objeto com `className`, `append`,
`querySelector`, `classList`) e um `send` que só resolve quando você deixa. Com isso dá
para afirmar "a segunda mensagem saiu ANTES de a primeira terminar" — e mutar o código
para ver o arnês acusar. Foram 17 checagens, e todas estas mutações acusaram: "a caixa
volta a segurar a mensagem" (1), "a caixa trava de novo com `input.disabled`" (1),
"ignora o `queued`" (2), "ignora o `turnStart`" (1), "desliga o *respondendo* com
resposta em voo" (1), "Parar só desliga a conexão do navegador" (1) e "a frase fixa vale
só no envio, não na bolha" (1).

Duas lições do arnês em si (artefato, não bug do código): atribuir `textContent` no DOM
de verdade **apaga os filhos**, e sem imitar isso o rótulo antigo do
[`activity`](11-componentes.md#activityjs) sobrevivia e o arnês mentia; e mandar a
segunda mensagem por `chat.submit()` **não** exercita a guarda do `composer` — para que
a mutação "a caixa volta a segurar" acusasse, foi preciso digitar na caixa e disparar o
`submit` do formulário, que é o caminho do usuário.

O mesmo vale para o **aninhamento dos subagentes**: o arnês empurra eventos com
`parentId` no `stream-sink` e confere onde cada chip foi parar (dentro do pai, do
avô, ou solto quando o pai é desconhecido) — 14 checagens. As mutações "ignora o
`parentId`" (6 falhas), "filho não entra no mapa, então o neto perde o pai" (3) e "não
revela a seção de passos" (1) acusaram todas.

Para a conversa que roda **no terminal** o arnês fez o outro pedaço: os eventos que o
servidor publicou de verdade (medidos pelo HTTP, ponta a ponta) entram no `chat` real e o
que se confere é a TELA — a bolha abre uma só vez e diz "no terminal…", o chip da
ferramenta recebe o resultado dela, no fim do turno a bolha para de pulsar, a fala
digitada lá aparece como mensagem marcada e **não** abre bolha, o turno seguinte ganha
bolha nova e o contador do cabeçalho acompanha (15 checagens). E uma checagem a mais que
vale citar: **fechar a janela com uma resposta viva na tela**. O `destroy()` do `chat`
chamava `voo.bubble.destroy()` num objeto que só tem `resposta`, então fechar assim
estourava (`Cannot read properties of undefined`) — bug antigo, achado lendo o código, e
que só é *pego* se o arnês fechar a janela **sem** encerrar a bolha antes. Ordem de
limpeza no teste é regra, não detalhe: encerrar primeiro esconde exatamente o caso.

A **frase fixa** teve os dois tratamentos: a regra é pura e mora em
`public/js/core/message-suffix.js`, então virou teste de verdade na suíte (mutações
"sem separador" 4 falhas, "ignora o desligado" 2, "empilha a frase repetida" 1); o
resto — o controle e o caminho janela → chat → envio — é DOM, e foi conferido por
arnês (19 checagens, incluindo "a bolha mostra exatamente o que foi enviado"). A
mutação "transforma só no envio, não na bolha" acusou 2 falhas. Uma terceira mutação
("ligar sem frase fica ligado") **não** acusou, e o motivo é legítimo: a guarda existe
em dois lugares (a chave nasce `disabled` e o `enabled()` confere de novo), então tirar
uma não muda comportamento.

Ele **não** entra na suíte de propósito: um DOM falso mantido à mão viraria dependência
disfarçada e mentiria em silêncio no dia que divergisse do navegador. É ferramenta de
conferência do momento — escreve, prova, joga fora, e o que sobra é o comportamento
documentado aqui.

### Processo de mentira: `spawn` por parâmetro

O `services/chat/runner.js` existe para gerenciar um processo `claude` vivo — e testar
isso chamando o CLI de verdade seria lento, caro e não determinístico. A saída foi
**receber o `spawn` por parâmetro** (padrão: o do `node:child_process`). O teste passa
um que devolve um `EventEmitter` com `stdout`/`stderr` falsos e um `stdin` que só
acumula as linhas escritas — então dá para afirmar coisas que no CLI real seriam
impossíveis de observar: *"as duas mensagens já estão no stdin com o turno 1 em voo"*.

É o mesmo espírito do `sse` falso do `chat-stream.test.js` (um objeto com `send`): o
código de produção não sabe que está sendo testado, só recebe suas dependências. O
`publish` (o canal da conversa) entra pela mesma porta — o teste passa um coletor, então
dá para afirmar *"o turno que o CLI começou sozinho foi para o canal, e nada foi
descartado"* sem subir rota nem HTTP.

As mutações que provaram esse teste (17 checagens):

| Mutação no código | Falhas |
| --- | --- |
| `send()` só escreve no stdin se for a cabeça da fila (volta a ser fila do servidor) | 1 |
| não emite `queued` | 4 |
| não emite `turnStart` | 4 |
| os eventos vão para o ÚLTIMO turno da fila, não para a cabeça | 4 |
| não reescreve o `subtype` do turno interrompido | 1 |
| `result` não encerra o turno (não fecha o SSE nem resolve a promessa) | 7 |
| ociosidade não fecha o stdin | 1 |
| tempo limite do turno não interrompe | 1 |
| processo que morre não avisa os turnos pendentes | 1 |
| `explainResult` sem o caso `interrupted` (`stream.js`) | 2 |

Uma mutação **não** acusou, e o motivo é legítimo: tirar o `clearTimeout(idleTimer)` do
`send()` não muda comportamento, porque o próprio temporizador confere se ainda há
trabalho antes de fechar o stdin — são duas guardas para a mesma regra, e a segunda basta.
Mantivemos a primeira por clareza de intenção, não por necessidade.

#### O turno que nasce sozinho e o canal (mutações)

O desenho novo (turno **corrente** + canal por conversa, veja
[10 · Chat](10-chat.md#turnos-que-nascem-sozinhos-o-cli-começa-por-conta-própria)) foi
provado quebrando cada regra de propósito. Suíte de 257 testes:

| Mutação no código | Falhas |
| --- | --- |
| linha sem turno dono é **descartada** (`if (!current) return;` — o bug original) | 19 |
| o turno corrente nasce sempre espontâneo (ignora a fila) | 10 |
| não emite `turnStart` | 5 |
| `ahead` não conta o turno espontâneo em curso | 2 |
| o `result` do espontâneo consome o turno da fila (o desenho antigo) | 2 |
| `busy` ignora o turno espontâneo (volta a ser "fila não vazia") | 3 |
| `working` sem a janela de silêncio (`= busy`) | 1 |
| ociosidade fecha o stdin sem olhar se há trabalho | 1 |
| tempo limite só olha a fila, não corta o espontâneo | 1 |
| não publica `autoStart` / `autoEnd` / `gone` / `busy` no canal | 1 / 2 / 1 / 2 |
| processo que morre não encerra o turno espontâneo (`autoEnd`) | 1 |
| canal não remove o SSE já fechado | 1 |
| desinscrever não desinscreve | 1 |

Uma mutação **não** acusou, e é o mesmo caso de sempre: tirar o `keepAwake()` do
`handleLine` (o rearme da ociosidade a cada linha) não muda comportamento, porque o
próprio temporizador rearma quando ainda há turno em curso. Ficou por intenção — "cada
linha é sinal de vida" é a regra que se quer ler ali —, não por necessidade.

#### Agentes como blocos próprios (mutações)

O desenho de agente ([10 · Chat](10-chat.md#agentes-em-segundo-plano)) foi provado
quebrando cada regra. Suíte de 336 testes + os três arnês do front:

| Mutação no código | Onde acusou |
| --- | --- |
| aceite do disparo tratado como relatório (`isLaunchAck` sempre falso) | suíte |
| `Task` (nome antigo) deixa de ser agente | suíte |
| aviso de fim casado pelo `task-id` em vez do `tool-use-id` | suíte |
| aceite não guardando o id estável, e aviso casando só pelo disparo (agente RETOMADO perde o relatório) | suíte |
| stream não mandando o id estável para a tela | suíte |
| tela sem o laço id-estável→disparo, e fim ignorando esse id | arnês |
| relatório cortado no primeiro `<` (regex gulosa) | suíte |
| agente virando ferramenta comum na leitura do disco | suíte |
| aceite do disparo encerrando o agente | suíte |
| aviso de fim virando mensagem na conversa | suíte |
| blocos fora de ordem (ferramenta antes da prosa) | suíte |
| duração do agente inventada em vez de `null` | suíte |
| stream não marcando o `ack` / não separando agente de ferramenta | suíte |
| aviso de fim de agente abrindo turno | suíte |
| ferramenta voltando para dentro da bolha | arnês |
| agente voltando a ser chip de ferramenta | arnês |
| tela tratando o aceite como fim do agente | arnês |
| faixa do rodapé não registrando o agente | arnês |
| fim do agente procurando só na resposta atual (cartão duplicado) | arnês |
| bolha superada continuando a pulsar | arnês |
| bolha vazia do fim ficando na tela | arnês |

**19 de 19 acusaram.** Depois vieram mais 10 (contador de agentes de pé, releitura na
reconexão, faixa alimentada pelo resumo da conversa, cartão ligado à faixa depois de
desenhado) — todas acusadas, duas delas só depois de eu escrever a checagem que faltava. Duas delas nasceram de bugs que o arnês pegou antes: a bolha de
prosa que ficava atrás de um bloco continuava pulsando "pensando…" para sempre (um timer
por parágrafo), e a bolha viva criada preguiçosamente tirava o sinal imediato de "começou
algo" no turno que o terminal inicia.

Três lições do arnês em si (artefato, não bug do código): `classList.add` aceita VÁRIAS
classes no DOM de verdade; `.text()` de um DOM falso precisa **ignorar nó escondido**,
senão o arnês jura que o indicador parado continua na tela; e o detalhe de um bloco é
dobrado até o clique — para conferir resultado e relatório o arnês tem de **clicar**, que
é o que a pessoa faz.

#### Seguir a conversa que roda no terminal (mutações)

Mesmo método para o seguidor do `.jsonl`
([10 · Chat](10-chat.md#seguir-a-conversa-que-roda-no-terminal)). Suíte de 308 testes:

| Mutação no código | Falhas |
| --- | --- |
| turno do terminal sem a marca `source` (viraria "retomou sozinho") | 2 |
| `assistant` que só pensa não abre o turno (tela parada no começo do trabalho) | 1 |
| `autoEnd` publicado sem turno aberto | 1 |
| marcador do CLI (`<system-reminder>`…) virando fala de gente | 1 |
| fala do terminal descartada / com precedência, engolindo o turno | 6 / 1 |
| publica mesmo pausado (mostraria a resposta nossa em dobro) | 2 |
| pausado **sem** andar o cursor (ao voltar, despeja o histórico) | 1 |
| processa a linha que ainda está sendo escrita | 2 |
| `toString()` no lugar do `StringDecoder` (caractere partido vira lixo) | 1 |
| cursor medido só no primeiro `tick` (engole o que chegou antes) | 1 |
| soltar uma janela derruba o seguidor da outra | 2 |
| arquivo reescrito mantém o turno antigo | 1 |
| `peer` abrindo bolha no lugar de ir ao feed | 4 |
| rótulo "no terminal…" ignorado | 1 |

Uma mutação inócua ensinou algo: tirar a guarda "entrada com `tool_result` não é fala"
não mudava nada, porque o `messageText` já não lê `tool_result` como texto. Só que ao
investigar apareceu um caso real mal tratado — quando você digita no terminal **enquanto
uma ferramenta roda**, o CLI grava o resultado dela e a sua fala na MESMA entrada, e a
regra antiga escolhia um dos dois e perdia o outro. Agora saem os dois (o do turno
primeiro), e é isso que as duas mutações da linha "fala descartada / com precedência"
guardam. Mutação que passa não é só teste fraco: às vezes é a regra que estava errada.

Duas lições da própria mutação: a que trocava só o `const target` do tempo limite pegou
**duas** ocorrências iguais (a do `onStderr` também) e quebrou a sintaxe — 227 "passes" e
0 falhas é sinal de arquivo que **não carregou**, não de teste fraco. E o primeiro teste de
ociosidade não acusava a remoção da guarda porque empurrava linha a cada 12 ms: o
temporizador nunca chegava a disparar. O caso que separa as duas contas é **turno em curso
e silêncio total** — daí existir o teste `turno em curso sem saída nenhuma também não fecha
o stdin`.

### A saída para o front: extrair a regra e testar a regra

O arnês prova a **ligação** (o DOM certo mexeu na hora certa), mas ele não entra na
suíte — então nada impede a regra de voltar a quebrar amanhã. Quando a decisão é pura,
a saída é **tirá-la do componente** e testá-la de verdade:

| Regra | Onde mora | Spec |
| --- | --- | --- |
| frase fixa no fim da mensagem | `public/js/core/message-suffix.js` | `test/message-suffix.test.js` |
| o que fazer quando uma resposta termina | `public/js/core/response-end.js` | `test/response-end.test.js` |
| para onde vai cada evento do canal | `public/js/core/channel-route.js` | `test/channel-route.test.js` |

E há um passo além: **componente sem DOM também dá teste de verdade.** O
[`auto-turn-watcher`](11-componentes.md#auto-turn-watcherjs) só chama métodos do `chat`
(`watch()`, `working()`, `composer.setBusy`), então um `chat` de mentira de 20 linhas
basta e o spec vive na suíte — sem `document` falso nenhum. Quando um componente precisa
de arnês, vale perguntar primeiro se ele não é assim: quem fala com *outros
componentes*, e não com o DOM, é testável direto.

Mutações que provaram esta parte — no **spec**: "descarta o conteúdo quando não houve
aviso de início" (2 falhas, é o bug original), "o `busy` abre bolha" (2), "o `gone` não
encerra a bolha aberta" (1), "o `autoEnd` fecha bolha que não existe" (1). No **arnês**,
onde mora a ligação com o feed: "a bolha do turno espontâneo não conta como em voo" (1),
"`working()` ignora o espontâneo" (1) e "o `watch` não registra nada" (2).

O `response-end.js` nasceu de um bug: recarregar o feed é `replaceChildren`, ou seja
**apaga a tela**. Fazer isso depois de um erro apagava a explicação do erro — a janela
ficava vazia, com "enviando…" preso no rodapé e nenhuma pista do que houve (o caso real:
modo `automático` recusado por falta de `CHAT_ALLOW_FULL_TOOLS=1`). Com outra resposta em
voo, apagaria a bolha dela. As mutações "ignora o erro" (1 falha), "ignora quem está em
voo" (4), "ignora a interrupção" (1) e "`inFlight` negativo trava a caixa" (1) acusaram
todas; no arnês, "recarrega sem consultar a regra" (3) e "não passa o `failed` da bolha"
(1) provaram a ligação.

**Armadilha do arnês, aprendida na hora:** a primeira versão simulava o erro fazendo o
`send` **rejeitar**. Só que o caso real é outro — o servidor responde 200 e manda um
evento `error` **dentro** do stream, e o envio termina sem exceção. Com o caminho errado,
a mutação "não passa o `failed`" passava batido, porque o `interrupted` já cobria o
teste. Simule o caminho que o servidor usa de verdade, não o mais fácil de escrever.

### O que o `spawn` de mentira NÃO pega: o teste pelo HTTP

O `repo.js` cria o runner por dentro, então nenhum teste da suíte cobre o caminho
**rota → repo → runner → CLI**. Foi exatamente ali que morava o bug do
["conversa viva não se procura no disco"](10-chat.md#armadilha-conversa-viva-não-se-procura-no-disco):
os 190 testes passavam e a segunda mensagem de uma conversa nova falhava.

Ao mexer nesse caminho, rode à mão (script descartável, ~50 linhas): sobe o servidor
numa porta de teste, `POST /api/chat` com um `cwd` em `/tmp` para criar uma conversa,
espera ~3s e `POST /api/chat/:id` **durante** a primeira resposta, lendo os dois SSE.
O que tem de aparecer:

```
[t1] init → turnStart …            [t2] init → queued{ahead:1}
[t1] result → done                 [t2] turnStart → … → result → done
```

E confira o que só o teste real mostra: **o `pid` dos dois `init` é o mesmo** (um
processo servindo dois turnos) e a resposta de t2 é a resposta *de t2*. No fim, apague a
conversa de sonda de `~/.claude/projects/` — teste que deixa lixo nos seus dados é meio
teste.

Com o canal (`GET /api/chat/:id/events`) a sonda ganhou uma terceira conexão, aberta antes
do segundo envio. O que apareceu numa rodada de verdade:

```
[canal] hello {"pid":561878,"busy":false,"pending":0}
[t2] init …            [canal] busy {"busy":true,"pending":1}
[t2] turnStart → … → result → done
                       [canal] busy {"busy":false,"pending":0}
```

Note o que só o HTTP mostra: logo depois do `done`, `GET /api/chat/:id/status` responde
**`running: true`** — é o `working` na janela de `CHAT_QUIET_MS`, e é intencional. Ver
`auto` e `autoStart`/`autoEnd` de verdade exige um subagente em **segundo plano** (é ele
que faz o CLI abrir turno sozinho): a sonda rápida não cobre isso, e a prova ali é o
`spawn` de mentira.

## O sandbox (por que os testes não encostam nos seus dados)

O `core/config.js` resolve os caminhos **uma vez, no import**. Então o teste troca o
env *antes* de importar o módulo sob teste — e é por isso que os testes usam
`await import()` dentro de `before()`, nunca `import` estático no topo:

```js
before(async () => {
  box = await createSandbox();                              // troca o env
  repo = await import('../services/conversations/repo.js'); // só então importa
});
```

`createSandbox()` (em `test/helpers/sandbox.js`) cria um `mkdtemp` e aponta para lá:

| Variável | Redireciona |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | `projects/` e `.trash-conversas/` — a lixeira e as conversas |
| `DATA_DIR` | `data/settings.json` e `data/conversas/` — as preferências |

Com isso, os testes apagam conversas e expurgam lixeira **de verdade**, sem risco:
nada disso é o seu `~/.claude` nem o `data/` do projeto. As duas variáveis também
servem em produção, se você quiser rodar com outro diretório.

O helper traz as "factories" — `givenTrashed()`, `givenConversation()`, `ago()`,
`stampFor()` — para os testes não repetirem setup.

## Vindo do RSpec

| RSpec | `node:test` |
| --- | --- |
| `describe` / `context` | `describe` (aninha igual) |
| `it do … end` | `it('...', () => {})` |
| `before` / `after` | `before`, `beforeEach`, `after`, `afterEach` |
| `expect(x).to eq(y)` | `assert.equal(x, y)` |
| `expect(h).to eq(hash)` | `assert.deepEqual(h, hash)` |
| `expect { }.to raise_error(/msg/)` | `assert.rejects(fn, /msg/)` — ou `assert.throws` se for síncrono |
| `let(:x)` | não existe: `const` no escopo do `describe` + `beforeEach` |
| FactoryBot | função helper comum (`givenTrashed`, `givenConversation`) |
| `bundle exec rspec` | `npm test` |

Duas diferenças que incomodam: **não há `let` com avaliação tardia**, e o `assert`
nativo tem menos matchers que o `expect` — às vezes sai uma linha a mais.

## Teste que não falha não vale nada

Ao escrever um caso, **quebre o código de propósito e confirme que ele acusa**. Foi
assim que se descobriu que o teste de "meses são calendário" estava fraco: trocar
`setMonth(m - n)` por `setDate(d - n*30)` passava batido, porque o caso usado (item de
1 mês e meio) cai do mesmo lado do corte nas duas contas.

O caso que **realmente** separa as duas é 12 meses: calendário dá ~365 dias, o atalho
errado dá 360 — então um item de 362 dias cai de lados opostos. É o teste
`12 meses não são 360 dias`, e ele existe só por causa dessa checagem.

```bash
# receita: mute, rode, confirme a falha, restaure
perl -0pi -e 's/setMonth\(d.getMonth\(\) - n\)/setDate(d.getDate() - n * 30)/' services/conversations/repo.js
npm test                                      # tem que FALHAR
git checkout -- services/conversations/repo.js
```

**Cuidado com fixture "arrumadinho".** O mesmo erro apareceu de novo no teste de
"alias resolve para o modelo mais novo": o catálogo de exemplo estava em ordem
decrescente de data, então remover a ordenação do código **não fazia o teste falhar**
— o `filter` já devolvia o mais novo primeiro, por acidente. A correção foi pôr o
mais **antigo** primeiro no fixture. Quando um teste depende de ordenação,
agrupamento ou desempate, monte o dado de entrada na ordem *errada* de propósito.

## Ao acrescentar teste

- nome do arquivo termina em `.test.js` e vive em `test/` (o `npm test` usa o glob
  `test/*.test.js`, então `test/helpers/` não é varrido);
- se o teste toca disco, use o sandbox — nunca escreva em `~/.claude` nem no `data/`;
- descreva o **comportamento**, não a implementação: `it('apaga o antigo e preserva o
  recente')` sobrevive a um refactor; `it('chama fs.rm')` não.
