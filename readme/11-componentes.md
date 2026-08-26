# 11 · Componentes reutilizáveis

[← sumário](README.md)

> **Regra do projeto (vale para toda alteração futura).** Qualquer pedaço de
> interface que possa aparecer duas vezes nasce como componente reutilizável em
> `public/js/components/` — não dentro do painel. Antes de escrever UI num painel,
> pergunte: "isso é reaproveitável?" Se for (e quase sempre é), vira componente e o
> painel só o compõe. Ao mexer aqui, mantenha o contrato: **dados e callbacks entram
> por parâmetro; o componente nunca importa `api.js` nem conhece rota/painel.**

Painel é cola — busca dados com `api.*` e compõe componentes. Componente não conhece
serviço, rota nem painel: recebe dados e callbacks, devolve nó.

```
public/js/components/
  feed.js         lista paginada que cresce para cima (histórico, logs)
  bubble.js       bolha de mensagem estática e bolha de streaming (SÓ texto)
  message-items.js  quebra uma mensagem lida do disco nos blocos dela, na ordem
  agent-card.js   um agente como bloco próprio (relógio vivo + relatório)
  agent-strip.js  os agentes em segundo plano da conversa (faixa do rodapé + registro)
  composer.js     caixa de escrever com campos de opção e enviar/parar
  chat.js         feed + composer + envio = vista de conversa
  live-answer.js  uma resposta chegando: bolha viva + tradutor, já dentro do feed
  stream-sink.js  traduz os eventos do stream em chamadas na bolha viva
  quick-reply-host.js  o lugar dos botões de resposta rápida (detecta e se limpa)
  auto-turn-watcher.js  mostra na vista o que chega pelo canal (turno que nasce sozinho)
  conversation-window.js  a janela de uma conversa (floating-window + chat + medidor + cor)
  data-table.js   tabela declarativa por colunas
  activity.js     indicador vivo "algo está acontecendo" (pulso + tempo + barra)
  context-meter.js  barra de uso de contexto + botão compactar
  tool-call.js      chip de ferramenta que abre o pedido e o resultado
  choice-select.js  dropdown de opção (+ "outro" para digitar um valor livre)
  duration-field.js quantidade + unidade (dias/meses/anos); compõe o choice-select
  dir-picker.js   modal para navegar o disco e escolher uma pasta
  dir-field.js    campo "pasta escolhida + botão", compõe o dir-picker
  inline-edit.js  texto + botão ✎ que vira um campo (renomear no lugar)
  image-tray.js   anexar/colar imagens (botão + Ctrl+V + miniaturas)
  floating-window.js  janela flutuante arrastável/redimensionável (não-modal)
  color-picker.js   botão + paleta de cores (amostras + cor livre)
  quick-replies.js  botões de resposta rápida (opções detectadas na pergunta)
  source-tag.js     valor + procedência (certeza x palpite)
  toggle-text.js    interruptor + texto livre num popover (frase fixa, assinatura…)
  server-status.js  status do servidor (verde/vermelho) + reiniciar/desligar
```

> **Um controle = um componente.** O `<select>` de opção é o `choice-select` — e o
> próprio `composer` o usa para renderizar seus campos. Nunca monte um `<select>`/
> `<input>` de opção solto num painel; componha o componente. Foi o erro do "ferramentas
> aparecia em dois lugares com dois renderizadores".

Componentes de casca (toasts, modal, drawer, estados) continuam em
[`core/ui.js`](06-interface.md) — são únicos na página, não instanciáveis.

## `feed.js`

Lista que se lê do fim para o começo e libera mais ao subir.

```js
const feed = createFeed({
  fetchPage: ({ limit, before }) => api.conversations.read(id, { limit, before }),
  renderItem: (m) => messageBubble(m),
  pageSize: 20,
  triggerPx: 150,
  onState: ({ shown, total, hasMore }) => drawer.setSubtitle(`${shown} de ${total}`),
  labels: { done: (t) => `· início · ${t} itens ·` },
});
container.append(feed.node);
feed.attach(scrollerElement);     // quem realmente rola
await feed.loadFirst();           // abre já rolado até o fim
```

`fetchPage` deve devolver `{ items|messages, total, from, hasMore }` — o mesmo
formato da paginação da API ([03](03-api.md)). O componente cuida de: ancorar a
posição ao inserir itens antigos, estados do sentinel (carregando / botão / início /
erro com "tentar de novo") e `append()` para itens novos no fim.

| Método | O quê |
| --- | --- |
| `attach(el)` | liga o scroll infinito ao elemento que rola |
| `loadFirst()` / `loadMore()` | primeira janela (rola ao fim) / janela anterior |
| `append(...nós)` | adiciona no fim; rola se você já estava no fim |
| `remove(...nós)` | tira itens (a bolha viva que acabou sem texto) e **acerta o contador** |
| `moveToEnd(nó)` | manda para o fim um item já contado — é como a bolha viva continua sendo a última quando um bloco novo entra na frente |
| `scrollToEnd()` · `state()` · `destroy()` | utilidades |

`onPage(page)` entrega a **página inteira** como veio do transporte, depois de desenhar —
para quem precisa do que não é item (hoje: quais agentes estão de pé na conversa).

`renderItem` pode devolver **vários nós** (uma mensagem virou prosa + ferramenta +
agente): o feed achata a lista. Ele conta **itens**, não nós.

Serve para qualquer histórico longo: mensagens hoje, saída de terminal ou lista de
commits depois.

## `bubble.js`

```js
messageBubble({ role: 'user', text, at, badge });          // → Node (só texto e imagens)
```

**Ferramenta e agente NÃO moram aqui.** A caixa de mensagem tem só o texto do main; cada
chamada e cada agente é um bloco próprio da conversa
([`message-items`](#message-itemsjs)). Antes vinham empilhados no pé da bolha: embrulhava
numa caixa o que o terminal mostra separado, trocava a ordem (a chamada que veio ANTES do
parágrafo aparecia depois dele) e enterrava um agente de doze minutos dentro de uma
mensagem já terminada.

`badge` é uma etiqueta opcional no cabeçalho da bolha. Existiu um `clearBadge(node)`
para a fila antiga do [`chat`](#chatjs) (a mensagem entrava com `badge: 'na fila'` e
perdia a etiqueta na vez dela); ele **foi removido** quando a fila saiu do navegador —
hoje quem mostra a espera é a bolha de resposta, pelo evento `queued` (ver
[`stream-sink`](#stream-sinkjs)). Uma informação, um lugar.

```js
const b = streamBubble({ role: 'assistant' });      // → controles
feed.append(b.node);
b.append('pedaço de texto');   // streaming
b.addNotice('limite de uso');  // aviso discreto
b.setStatus('claude-opus-5');  // chip do cabeçalho
b.setError('deu erro');        // marca a bolha
b.finish('$0.0116 · 1 turno'); // encerra o estado "digitando"
b.empty;                       // não escreveu nada? (aí ela sai do feed em vez de virar "(sem texto)")
```

Quem consome um stream nunca toca no DOM: só chama esses métodos. `startedAt` faz o
relógio contar do começo do TURNO, e não do nascimento desta bolha — é o que permite
trocar a bolha viva quando um bloco novo entra sem o tempo voltar a zero.

## `message-items.js`

Uma mensagem **lida do disco** → os blocos dela na tela, na ordem em que aconteceram.
Compõe [`bubble`](#bubblejs), [`tool-call`](#tool-calljs) e [`agent-card`](#agent-cardjs).

```js
const feed = createFeed({
  renderItem: (m) => messageItems(m, {
    onToggle: () => feed.scrollToEnd(),
    keep: (card, block) => { /* tem relógio vivo: guarde para destruir */ },
  }),
});
```

- devolve **uma lista de nós** (o feed achata) — um por bloco (`text`, `tool`, `agent`);
- só o **primeiro** bloco leva o cabeçalho "quem falou · quando": repetir em cada bloco
  encheria a tela de etiquetas iguais;
- `keep` recebe o que tem **timer** (cartão de agente ainda rodando) junto com o bloco de
  origem. Quem monta destrói ao recarregar o feed — nó removido da tela com relógio vivo é
  vazamento — e coloca o agente na faixa do rodapé;
- mensagem sem `blocks` (formato antigo, ou outro caminho) continua desenhando como texto.

## `agent-card.js`

Um **agente** como bloco próprio da conversa: nome, tipo, relógio vivo e o relatório
quando ele volta.

```js
const card = createAgentCard({ name: 'Lane 1', agentType: 'general-purpose', startedAt });
feed.append(card.node);
card.addChild(toolCall.node);                      // o que ele fez, quando se sabe
card.finish({ summary: 'terminou', report: '…', durationMs: 726000, status: 'completed' });
card.running;                                      // ainda de pé?
card.destroy();                                    // tem timer: sempre
```

Existe porque agente **não** é ferramenta comum: o `tool_result` dele volta em ~3 s com o
aceite do disparo, e o trabalho chega minutos depois num aviso separado
([10](10-chat.md#agentes-em-segundo-plano)). Desenhado como chip, ele aparecia
**resolvido** enquanto seguia trabalhando por doze minutos — e escondido no pé de uma
mensagem já terminada. Cria com `running: false` para um agente que já voltou (é o caso da
leitura do disco); `startedAt` faz o relógio contar do disparo de verdade.

## `agent-strip.js`

Os agentes em segundo plano **da conversa**: a faixa de "rodando agora" (acima da caixa de
escrever, como o painel fixo do terminal) **e** o registro de qual cartão é de quem.

```js
const agentes = createAgentStrip({ onPick: () => feed.scrollToEnd() });
agentes.track({ id, name, agentType, card, startedAt });   // entrou
agentes.track({ id, card });        // o cartão dele foi desenhado depois: liga os dois
agentes.alias(agentId, id);         // id ESTÁVEL do agente -> o disparo dele
agentes.end(id, fim, agentId);      // acha por qualquer um dos dois
agentes.end(id, { summary, report, status, durationMs });   // voltou → encerra o cartão
agentes.has(id); agentes.size; agentes.ids();
agentes.clear();      // o feed vai ser redesenhado
agentes.destroy();    // tem timer: sempre
```

As duas coisas moram juntas porque o problema é um só: **o agente nasce num turno e volta
em outro**, dez minutos depois. Com um registro por resposta, o aviso de fim chegava numa
resposta que nunca viu o disparo — o cartão original ficava "rodando…" para sempre e o
relatório aparecia duplicado num cartão solto. `end()` devolve `false` quando ninguém
conhece aquele id, e aí quem chamou decide o que fazer com o relatório (nunca jogar fora).

`alias` existe porque o aviso de fim casa pelo **id estável** do agente, e num agente
RETOMADO ele vem com o id da chamada que o retomou — sem o laço, o relatório não acha o
cartão ([10](10-chat.md#agentes-em-segundo-plano)).

Entrada **sem cartão** é normal: ao abrir a conversa, a faixa é preenchida pelo resumo da
leitura (`page.agents`) e o bloco do disparo pode estar 200 mensagens atrás. Quando ele
finalmente é desenhado, um `track` com o `card` liga os dois — senão o aviso de fim não
teria onde escrever e o cartão ficaria "rodando…" na tela.

## `live-answer.js`

Uma resposta **chegando** na tela — em **blocos**, na ordem em que as coisas acontecem:
prosa na bolha, ferramenta e agente como blocos soltos, e a bolha viva sempre por último
(como o spinner no pé do terminal).

```js
const resposta = createLiveAnswer({ feed, agents: agentes, onHint: (t) => composer.setHint(t) });
await send(texto, valores, imagens, resposta.onEvent, sinal);
resposta.finish();          // encerra o "trabalhando"; sem isto o indicador pulsa para sempre
resposta.bubble.failed;     // terminou em erro?
```

A `bubble` que ela devolve é uma **superfície**: tem a cara da bolha de antes (`append`,
`setActivity`, `setError`…) mais o que é de bloco (`addTool`, `addAgent`, `endAgent`).
Assim o [`stream-sink`](#stream-sinkjs) continua sendo só tradutor, sem saber onde cada
coisa é desenhada.

Três regras de ordem que valem ler:

- bolha viva que **ainda não escreveu nada** só desce quando um bloco entra (o relógio é
  do turno, não do bloco);
- bolha que **já tem prosa** fica onde está e a próxima nasce depois — a ordem na tela é a
  ordem do que aconteceu. E ela **para de pulsar**: sem isso cada parágrafo deixava para
  trás uma bolha dizendo "pensando…" para sempre, com um timer vivo por parágrafo;
- bolha vazia no fim do turno **sai do feed** em vez de virar um "(sem texto)" solto.

Existe porque nasceram **dois** lugares montando o mesmo par bolha+tradutor: a resposta
a uma mensagem sua e a resposta que o Claude começa por conta própria (ver
[`chat.watch`](#chatjs)). Duas cópias do mesmo desenho é o tombo que o
[`CLAUDE.md`](../CLAUDE.md) já registra — então o desenho passou a ter um dono só.

O `onHint` é opcional **de propósito**: uma resposta que você não pediu não deve mexer
na dica da sua caixa de escrever.

## `quick-reply-host.js`

O lugar dos botões de resposta rápida no rodapé. Recebe o texto da última resposta,
detecta as opções e monta os botões; sem opções, não desenha nada.

```js
const rapidas = createQuickReplyHost({ onPick: (v) => enviar(v), onWrite: () => composer.focus() });
rodape.append(rapidas.node);
rapidas.offer(bubble.text());   // ofereça para este texto (ou nada, se não houver opções)
rapidas.clear();                // no envio seguinte
```

Saiu do `chat.js` por ser responsabilidade própria — detectar, montar, limpar na hora
certa e destruir o que registrou.

## `auto-turn-watcher.js`

Traduz o que chega pelo **canal da conversa** em coisas na vista. O canal existe porque o
Claude começa turnos por conta própria (agente em segundo plano que volta) — ver
[10](10-chat.md).

```js
const observador = createAutoTurnWatcher({ chat });
const canal = watch(observador.handle);   // transporte entra por parâmetro
// ao fechar a janela: canal.close(); observador.destroy();
```

Não toca no DOM: só chama `chat.watch()`, `chat.working()` e `chat.composer.setBusy()`.
Por isso tem **spec de verdade na suíte** (com um `chat` de mentira), e não arnês — ver
[13](13-testes.md#a-saída-para-o-front-extrair-a-regra-e-testar-a-regra). A decisão de
"que ação para qual evento" é a regra pura `core/channel-route.js`, também com spec.

O `setBusy` **só liga** por conta do canal: desligar é decisão do `chat`, o único que
sabe se ainda há um envio SEU em voo — senão o "Parar" sumia no meio da sua resposta.

Pelo mesmo caminho chega o que está acontecendo **no terminal**: turno de lá abre bolha
com o rótulo `no terminal…` (não é "retomou sozinho": são coisas diferentes e chamar
igual confundiria as duas), e a fala digitada lá vira `chat.peer()` — sem abrir nem
fechar bolha, porque quem digita no terminal durante uma resposta não a interrompe.

## `stream-sink.js`

Pega um evento do stream e mexe na bolha. É só isso — e é o suficiente para tirar 70
linhas de `switch` de dentro do `chat.js`.

```js
const onEvent = createStreamSink({
  bubble,                                  // a superfície da resposta (ver `live-answer`)
  onHint: (t) => composer.setHint(t),      // "modo: …", "$0.0116 · 2 turno(s)"
  onScroll: () => feed.scrollToEnd(),      // cresceu; quem rola decide se acompanha
});
onEvent({ type: 'delta', text: 'oi' });
```

Devolve **uma função** (o próprio `onEvent`), então entra direto no transporte. Não
conhece composer, feed, painel nem rota: só a bolha e dois callbacks. Guarda um único
pedaço de estado — se já houve `delta` — porque depois de uma ferramenta o rótulo tem de
voltar de "usando Bash…" para "escrevendo…". Evento de tipo desconhecido é ignorado de
propósito: o contrato ([readme/10](10-chat.md)) pode crescer sem quebrar a tela.

**`agentStart`/`agentEnd` não são ferramenta.** O tradutor manda o agente para
`addAgent`/`endAgent` (bloco próprio + faixa do rodapé) e trata `toolResult { ack: true }`
como o que é: o aceite do disparo, que **não** encerra ninguém. Era isso que fazia um
agente de doze minutos parecer pronto em três segundos.

**`queued` e `turnStart` existem por honestidade.** Uma mensagem mandada durante outra
resposta chega em quem responde na hora, mas só é atendida depois — então a bolha dela
mostra `na fila · aguardando a vez` (ou `na fila · N na frente`) e só troca para
`pensando…` quando o `turnStart` chega. Sem isso a bolha ficaria "pensando…" desde o
começo, inventando um trabalho que ainda não começou.

Reaproveitável em qualquer lugar que mostre resposta chegando — o editor explicando um
arquivo, um agente rodando em segundo plano.

## `source-tag.js`

Mostra um valor **e de onde ele veio**. Fábrica de nó (como o `messageBubble`): sem
estado, sem listener, sem `destroy()`.

```js
meta.append(sourceTag({ text: `conversa ${id.slice(0, 8)}…` }));                 // certeza
meta.append(sourceTag({
  text: `conversa ${id.slice(0, 8)}…`,
  certain: false,                          // esmaece e escreve "(palpite)"
  title: 'por que é palpite, em uma frase',
}));
```

Existe porque "este dado é palpite" **já aparece em mais de um lugar**: a janela de
contexto (vinda da API x estimada pelo nome do modelo) e a conversa de uma sessão
(declarada no comando x deduzida pelo arquivo mais recente da pasta). Sem uma peça só,
cada painel inventava a sua marcação — que é exatamente o tombo já registrado no
`CLAUDE.md` ("o mesmo controle renderizado de dois jeitos").

> **Dívida declarada:** o [`context-meter`](#context-meterjs) ainda marca o palpite por
> conta própria, com o parâmetro `note` (texto livre que o painel passa). Não foi
> convertido nesta rodada de propósito — mexer no contrato dele é mexer num caminho que
> funciona, e isso pede uma alteração própria, não um efeito colateral. Quando for
> convertido, o `note` vira `sourceTag` e a marcação passa a ser única.

## `toggle-text.js`

Um interruptor + um campo de texto, editados num popover, com o estado resumido no
próprio botão. Genérico: guarda um texto que pode estar **ligado ou desligado**. Hoje é a
frase fixa do fim da mensagem; serve igual para assinatura de commit, cabeçalho de
arquivo, comando padrão.

```js
const tt = createToggleText({
  label: 'frase',
  value: settings.suffix || '',
  enabled: settings.suffixOn === true,
  placeholder: 'ex.: Responda sempre em português.',
  hint: 'vai no fim de toda mensagem desta conversa',
  onChange: ({ value, enabled }) => salvar({ suffix: value, suffixOn: enabled }),
});
header.append(tt.node);
tt.state();     // { phrase, enabled } — pronto para a regra que usa
tt.set({ value: 'outra', enabled: false });
tt.destroy();   // OBRIGATÓRIO: solta o clique-fora e o Esc de `document`
```

Devolve `{ node, value(), enabled(), state(), set(), destroy() }`. Três regras que ele
garante sozinho, e que quem usa não precisa repetir:

- **não existe "ligado sem texto"**: sem valor, a chave nasce `disabled`, e apagar o
  texto desliga;
- **grava no `change`, não no `input`** — ao sair do campo, não a cada tecla. Uma
  gravação por letra viraria rajada de escrita no arquivo de configuração;
- **o botão mostra o estado sem abrir**: esmaecido (vazio), normal (tem texto,
  desligado) ou com a cor de acento (ligado) — senão a frase iria junto sem sinal nenhum.

Não sabe o que é conversa, mensagem ou arquivo: recebe o valor e devolve mudanças.

## `composer.js`

Caixa de escrever genérica — não sabe o que faz com o texto.

```js
const composer = createComposer({
  placeholder: 'Escreva…',
  submitLabel: 'Enviar',
  fields: [{
    name: 'mode', label: 'modo', value: 'none',
    choices: [{ value: 'none', label: 'só conversa', title: 'não toca em nada' }],
  }],
  allowImages: true,                     // habilita anexar/colar imagem (image-tray)
  onSubmit: async (text, values, images) => enviar(text, values.mode, images),
  onStop: () => api.chat.stop(id),      // mostra "Parar" enquanto ocupado
  submitOnEnter: true,                   // Enter envia, Shift+Enter quebra linha
});
footer.append(composer.node);
composer.setBusy(true);                  // "respondendo": NÃO trava, só avisa
composer.setLocked(true, 'compactando…'); // trava de verdade (outra operação)
composer.setHint('$0.0116 · 1 turno');   // rodapé à direita
composer.setNotice('aviso importante');  // faixa amarela acima
composer.focus();
```

### `setBusy` não trava — `setLocked` trava

São duas coisas diferentes, e confundi-las foi bug:

| | o que faz | quando usar |
| --- | --- | --- |
| `setBusy(true)` | só revela o botão "Parar". A caixa **continua escrevível** e o rótulo do botão **não muda** | enquanto uma resposta corre |
| `setLocked(true, motivo)` | `disabled` na caixa e no botão; `motivo` vira o placeholder | operação que mexe na conversa e **não** aceita mensagem nova (hoje só `/compact`) |

Antes o `setBusy` fazia `input.disabled = true`, e o resultado era o oposto do
terminal: durante a resposta você ficava de mãos atadas, sem poder nem digitar a
próxima mensagem. Depois ele trocava o rótulo para **"Enfileirar"** — o que também
deixou de ser verdade: a mensagem escrita durante uma resposta **sai na hora**, não
fica presa nesta caixa (ver [`chat`](#chatjs)). Chamar de "Enfileirar" mentiria sobre
quem espera. Se você precisa impedir o envio, é `setLocked` — e aí diga o porquê no
`motivo`, senão o usuário só vê uma caixa morta.

Amanhã serve para mensagem de commit, prompt do editor ou caixa de comando — muda
só `fields` e `onSubmit`.

## `chat.js`

Junta feed + composer + o protocolo de eventos de stream ([contrato em 10](10-chat.md)).

```js
const chat = createChat({
  fetchPage: (opts) => api.conversations.read(c.id, opts),
  send: (text, values, onEvent, signal) =>
    api.chat.send(c.id, { text, mode: values.mode }, onEvent, signal),
  onStop: () => api.chat.stop(c.id),
  fields: [{ name: 'mode', value: 'none', choices: MODE_CHOICES }],
  onState: ({ shown, total }) => drawer.setSubtitle(`${shown} de ${total}`),
  onFinish: () => chat.reload(),   // relê do disco depois da resposta
  beforeSend: (text, values) => applySuffix(text, sufixo.state()),   // última chance
});

drawer.open({ body: chat.node, footer: chat.footer, onClose: () => chat.destroy() });
chat.attach(drawer.scroller());
await chat.start();
chat.submit('primeira mensagem', images);   // envia por código, com os campos atuais
chat.notice('esta conversa está aberta num terminal');
```

O transporte é injetado: qualquer serviço que emita os eventos do contrato
(`init`, `delta`, `message`, `tool`, `toolResult`, `notice`, `result`, `error`, `done`)
reaproveita esta vista inteira. `mountChat(container, chat)` monta fora do drawer.

### `beforeSend`: mexer no texto sem espalhar regra

`beforeSend(text, values) => text` é a última chance de transformar a mensagem — hoje a
[frase fixa](06-interface.md#frase-fixa-no-fim-das-mensagens). Roda **antes de tudo**, em
`run()`, e por isso vale para os três caminhos (clique em Enviar, `submit()` por código e
resposta rápida) e também para o que está **na fila**.

A ordem importa: o texto transformado é o que vira **bolha na tela** e o que vai para o
**servidor**, nessa ordem. Transformar só na hora do envio deixaria a tela mostrando uma
coisa e o Claude recebendo outra.

O `chat` não sabe o que a transformação faz — quem monta o `beforeSend` é o
[`conversation-window`](#conversation-windowjs), compondo o `toggle-text` com a regra
pura `core/message-suffix.js`.

`submit(text, images)` envia por código pelo **mesmo** caminho do clique em "Enviar" (é
o que as respostas rápidas já usavam por dentro). Serve para abrir a vista já com a
primeira mensagem em mão — é assim que a tela de nova conversa manda a primeira.

### Mandar durante a resposta: sai na hora, a espera é do outro lado

Como no terminal: escrever durante uma resposta **manda a mensagem imediatamente**. O
`chat` não guarda nada — quem a segura até a vez dela é quem responde (no chat de
conversas, o próprio CLI; ver [10](10-chat.md)).

- cada envio abre o **seu** stream e ganha a **sua** bolha de resposta; pode haver mais
  de um em voo (`emVoo`), e eles aparecem na tela na ordem em que foram mandados;
- enquanto a mensagem espera a vez, a bolha dela mostra `na fila · aguardando a vez`
  (evento `queued`) e, quando começa de fato, volta para `pensando…` (evento
  `turnStart`). Mostrar "pensando…" antes da hora seria inventar trabalho que não
  existe;
- o botão "Parar" fica de pé enquanto houver **qualquer** resposta em voo, e ele pede o
  corte para o outro lado (`onStop`) em vez de só desligar a conexão do navegador —
  desligar aqui não faria o trabalho parar lá;
- as respostas rápidas só aparecem quando **nada** está em voo, senão a resposta
  seguinte apagaria os botões no meio do caminho;
- `destroy()` para os indicadores vivos de todas as bolhas em voo (têm timer); com
  `abort: true` também cancela os streams;
- **`onFinish` só é chamado quando a tela pode ser recarregada.** Os painéis usam esse
  gancho para trocar as bolhas vivas pelas do disco, e recarregar é `replaceChildren`:
  apaga tudo. Com outra resposta em voo isso apagaria a bolha dela; depois de um erro,
  apagaria a explicação do erro e sobraria uma janela vazia. Quem decide é a regra pura
  `core/response-end.js`, com spec na suíte — e a bolha informa se falhou pelo
  `bubble.failed`.

Antes a fila era **aqui**: a segunda mensagem ficava presa no navegador e só saía
quando a primeira acabava. Era o oposto do terminal, onde a mensagem chega em quem
responde na hora.

Quem precisa de fato bloquear a escrita usa `chat.composer.setLocked(...)` — ver a
tabela em [`composer`](#composerjs).

### Resposta que você não pediu: `chat.watch()`

O Claude **começa turnos por conta própria**: quando um agente que ele soltou em segundo
plano termina, o CLI trata o aviso como uma mensagem nova e responde sem você pedir nada
(o porquê está em [10](10-chat.md)). Esse trabalho não pertence a nenhum envio seu — e
antes ele não aparecia em lugar nenhum: a tela congelava enquanto o Claude seguia
trabalhando por dez minutos.

```js
const espontanea = chat.watch();                     // bolha "retomou sozinho…"
const doTerminal = chat.watch({ label: 'no terminal…' });   // mesma peça, outra procedência
espontanea.onEvent(evento);                 // mesmo contrato de eventos do envio normal
espontanea.finish();                        // encerra
chat.working();                             // há resposta chegando? (sua OU espontânea)
chat.peer({ role: 'user', text, at });      // fala que veio de fora desta caixa
```

`chat.peer()` é para a fala que **entrou na conversa sem passar por esta caixa** — hoje:
alguém digitando no terminal, na mesma conversa. Vai ao feed como mensagem normal, com a
marca de onde veio: é a mesma conversa, e mostrar metade dela seria mentir.

### Reconexão: `chat.resync()`

```js
chat.resync();     // relê a conversa do disco — só se nada estiver em voo
```

O canal cai e volta (servidor reiniciado, máquina suspensa, rede) e o seguidor novo começa
a olhar do **fim** do arquivo: o que o terminal escreveu durante a queda não passou pelo
canal. A única fonte é o disco. Quem decide que houve RE-conexão é a regra pura
`core/channel-route.js` (um `hello` que não é o primeiro).

### Agente que chega fora de qualquer resposta: `chat.agentEvent()`

```js
chat.agentEvent({ type: 'agentEnd', id, summary, result, status, durationMs });
```

O disparo de um agente acontece num turno e o aviso de fim chega em **outro** — às vezes
em nenhum. Esses eventos moram numa "resposta de FUNDO": ela nunca abre bolha (só recebe
blocos) e **não conta como "respondendo"**, senão um aviso de agente deixaria a caixa em
estado de resposta para sempre. Quem acha o cartão certo é o
[`agent-strip`](#agent-stripjs), que é o registro da conversa; sem cartão nenhum, o
relatório vira um cartão solto — nunca lixo.

A faixa dos agentes rodando fica no **rodapé** do chat (`chat.footer`), acima das respostas
rápidas e da caixa de escrever — o mesmo lugar do painel fixo do terminal.

Quem liga isso ao servidor é a janela ([`conversation-window`](#conversation-windowjs)),
que ouve o canal da conversa. Enquanto uma bolha dessas está aberta, **o feed não é
recarregado**: recarregar apagaria da tela justamente o que você não tinha visto.

Isso é lógica de verdade embrulhada em DOM, então foi conferida por **arnês
descartável** (27 checagens; as mutações "a caixa volta a segurar", "a caixa trava",
"ignora o `queued`", "ignora o `turnStart`", "desliga o *respondendo* com resposta em
voo" e "Parar só desliga a conexão daqui" acusaram todas) — ver
[13](13-testes.md#quando-o-front-tem-lógica-de-verdade-arnês-descartável).

## `conversation-window.js`

A vista completa de "estar dentro de uma conversa": compõe
[`floating-window`](#floating-windowjs) + [`chat`](#chatjs) +
[`context-meter`](#context-meterjs) + [`color-picker`](#color-pickerjs) +
[`toggle-text`](#toggle-textjs).

Existe porque **dois caminhos abrem a mesma coisa**: clicar em "Ler" na lista e iniciar
uma conversa nova. Painel não importa painel, então a peça compartilhada é componente e
cada painel compõe.

```js
const janela = createConversationWindow({
  id: c.id, title: c.name || c.title, project: c.project, bytes: c.bytes, model: c.model,
  context: { tokens, window, note },          // estado inicial do medidor
  settings: salvas,                            // { mode, model, color } do disco
  modeChoices: MODE_CHOICES, modelChoices: MODEL_CHOICES, swatches: CORES,
  fetchPage: (opts) => api.conversations.read(c.id, opts),
  send: (text, values, images, onEvent, signal) =>
    api.chat.send(c.id, { text, mode: values.mode, model: values.model, images }, onEvent, signal),
  watch: (onEvent) => api.chat.events(c.id, onEvent),   // canal da conversa
  stop: () => api.chat.stop(c.id),
  onSaveSetting: (patch) => api.settings.save(c.id, patch),
  onCompact: (j) => compactar(j.meter, j.chat),
  onFinish: (j) => j.chat.reload(),
});
await janela.chat.start();
janela.focus();
```

Devolve `{ id, win, chat, meter, setId, setTitle, setHeader, listen, focus, destroy }`.

### O canal da conversa (`watch`)

`watch(onEvent)` é o transporte de um canal que fica **aberto enquanto a janela viver**,
e por ele chega tudo que acontece na conversa **sem** você pedir daqui: os turnos que o
Claude começa por conta própria (agente em segundo plano que volta) **e o que está sendo
feito no terminal** nesta mesma conversa — o servidor segue o `.jsonl` enquanto alguém
ouve ([10](10-chat.md#seguir-a-conversa-que-roda-no-terminal)). Devolve `{ close() }`, e a
janela fecha no `onClose` — quem abre, fecha.

Para onde vai cada evento é a regra pura `core/channel-route.js`, com spec na suíte; a
janela só executa as ações que ela devolve:

| Ação | O que a janela faz |
| --- | --- |
| `open` | abre a bolha do turno espontâneo (`chat.watch()`); com `source: 'terminal'` o rótulo é **"no terminal…"**, que não é a mesma coisa que "retomou sozinho" |
| `feed` | entrega o evento a ela |
| `close` | encerra a bolha |
| `peer` | põe no feed a fala que alguém digitou **no terminal** (`chat.peer()`) |
| `agent` | entrega um `agentStart`/`agentEnd` que não pertence a turno nenhum (`chat.agentEvent()`) |
| `busy` | liga o "Parar"; só desliga se `chat.working()` for falso |
| `gone` | o processo encerrou (normal depois de ociosidade) — nada visível |

O `busy` **só liga** por conta do canal. Desligar é decisão do `chat`, o único que sabe
se ainda há um envio SEU em voo — senão o "Parar" sumia no meio da sua própria resposta.

Conversa nova não tem id até o primeiro `init`, então o `setId` chama o `listen()`
quando o id chega. O `listen()` é idempotente: chamar duas vezes não abre dois canais.

Três coisas que valem saber:

- **uma janela por conversa.** O registro vive no módulo do componente, não no painel:
  `createConversationWindow` com um `id` já aberto **foca a existente** em vez de criar
  outra. `openConversationWindow(id)` responde se já existe. Se o registro ficasse no
  painel, abrir por um caminho e depois pelo outro daria duas janelas da mesma conversa;
- **`setId(id)`** existe para a conversa que ainda vai nascer: quem inicia só descobre o
  id no evento `init`, e é esse registro que impede a segunda janela depois. **Só registra
  se a janela ainda está aberta** (`win.isOpen()`) — ver o fantasma abaixo;
- **o registro não guarda fantasma.** Fechar a janela **não** aborta o stream, então o
  `init` pode chegar *depois* do fechamento. Registrar aí deixava uma janela fechada
  marcada como "aberta", e `focus()` em janela fechada só mexe no `z-index`: o clique em
  **"Ler" não abria nada**. Hoje há duas guardas (de propósito redundantes): `setId` não
  registra janela fechada, e `openConversationWindow` descarta a entrada quando a janela
  não está mais na tela. Reproduzir: criar pela tela de nova conversa, **fechar antes da
  primeira resposta chegar**, e depois clicar em "Ler" na lista;
- **`setHeader({ … })` mescla.** O total de mensagens chega pelo feed e o modelo pode só
  ser conhecido depois; atualizar um não apaga o outro.

O `/compact` **não** vem embutido: entra como `onCompact`, porque quem mostra toast e
mede o antes→depois é o painel. O componente não conhece `api.js`.

## `data-table.js`

```js
createDataTable({
  rows: items,
  empty: states.empty('Nada aqui'),
  onRowClick: (row) => abrir(row),
  columns: [
    { label: 'Quando', className: 'code', width: '110px',
      render: (r) => fmt.when(r.modifiedAt), title: (r) => fmt.clock(r.modifiedAt) },
    { label: 'Msgs', key: 'messages', className: 'code' },
    { label: 'Assunto', render: (r) => r.title, onClick: (r) => abrir(r) },
    { label: '', render: (r) => botões(r) },
  ],
});
```

`onClick` por coluna já faz `stopPropagation`, então botões dentro da linha não
disparam o clique da linha.

### Destacar uma linha

`rowClass(row)` e `rowStyle(row)` marcam o `<tr>` sem a tabela saber o motivo — ela
só repassa. É assim que o painel de Conversas mostra a **cor configurada** de cada
conversa:

```js
createDataTable({
  rows: items,
  rowClass: (c) => (cores.has(c.id) ? 'accent' : null),
  rowStyle: (c) => (cores.has(c.id) ? `--row-accent:${cores.get(c.id)}` : null),
  columns: [ /* … */ ],
});
```

O CSS lê a variável (`table.grid tr.accent`): faixa de 3px à esquerda com a cor exata
e uma tinta de 8% na linha (18% no hover), via `color-mix` — funciona nos dois temas
sem cor fixa.

Duas armadilhas que valem lembrar:

- as duas funções só entram no `<tr>` **quando devolvem valor**. O `el()` faz
  `node.className = v` sem checar `null`, então um `class: null` viraria literalmente
  `class="null"`;
- o valor de `rowStyle` vai para um atributo `style`. Se a origem for dado gravado
  (um arquivo de config, por exemplo), **valide** antes — o painel de Conversas só
  aceita cor que casa com `/^#[0-9a-fA-F]{3,8}$/`, para um valor torto não virar
  declaração de estilo solta.

## `tool-call.js`

Uma chamada de ferramenta dentro de uma mensagem: chip clicável que abre o **pedido**
e o **resultado**. Genérico — não sabe o nome de nenhuma ferramenta, então serve para
`Bash`, `Edit` e para um subagente (`Agent`) igualmente. O `summary` chega **pronto**
por parâmetro: quem decide o que resume é quem traduziu o stream
([`core/claude-blocks.js`](10-chat.md#ferramentas-e-subagentes-o-que-dá-para-ver)), não
o componente — ele não sabe que existe uma ferramenta chamada "Agent".

```js
const call = createToolCall({
  name: 'Agent',
  summary: 'Explore · Recon do login',   // frase curta no chip (já vem pronta)
  input: '{ "subagent_type": "Explore", "prompt": "…" }',   // já em texto
  inputTruncated: true,                                     // avisa que cortou
  onToggle: () => feed.scrollToEnd(),                       // abrir muda a altura
});
extras.append(call.node);
call.addChild(outraCall.node);   // um passo do subagente, DENTRO deste chip
call.setResult({ text: 'relatório', isError: false });
call.settle();     // fim do stream: o que não voltou vira "sem resultado"
call.destroy();    // OBRIGATÓRIO: remove o listener de clique
```

### `addChild`: os passos ficam dentro, não do lado

`addChild(nó)` encaixa uma chamada **filha** — o que um subagente fez. Consequências
visíveis, todas de propósito:

- os passos só aparecem **expandindo** o agente (é o pedido: igual ao terminal);
- o chip fechado ganha um contador (`3 passos`) — com ele fechado o trabalho ficaria
  invisível, e sumir com o sinal seria desonesto;
- a seção "passos" **não existe** numa ferramenta comum: nasce escondida e só aparece
  quando chega o primeiro filho, então um `Bash` solto não ganha caixa vazia;
- o componente **não sabe** o que é subagente: recebe um nó pronto e dá o lugar. Quem
  decide quem é filho de quem é a [`bubble`](#bubblejs), pelo `parentId` do stream.

Aninha em qualquer profundidade — agente que chama agente vira mais um nível, sem código
novo, porque cada filho é um `tool-call` completo.


Quem compõe é a [`bubble`](#bubblejs), pelos dois caminhos:

- **ao vivo** (`streamBubble`): `addTool(name, { id, input, … })` e depois
  `setToolResult(id, payload)`. A bolha resolve e destrói todas no
  `finish()`/`setError()`/`destroy()`;
- **no histórico** (`messageBubble`): recebe `tools: [{ id, name, input, result }]` da
  API e já monta cada chip resolvido. Aqui **não** há `destroy()` — o listener do
  `tool-call` está no próprio nó dele, então morre quando o feed remove a bolha. Só o
  que escuta `document`/`window` ou usa timer precisa de destruição explícita.

Três decisões de honestidade (regra 8 do projeto):

- enquanto não há retorno, o resultado diz **"executando…"** — não "vazio";
- ao fim do stream, o que não voltou vira **"sem resultado registrado neste stream"** —
  que é a verdade para subagente em background, cujo retorno é só o recibo de início;
- texto cortado no teto ganha a marca *"… cortado no limite de exibição"*, em vez de
  fingir que aquilo era o conteúdo inteiro.

Fechado é só um chip na linha das etiquetas; aberto, a raiz recebe a classe `open` e
ocupa a linha inteira (senão o detalhe ficaria comprimido ao lado dos outros chips).

## `activity.js`

Indicador de "algo está acontecendo agora" — bolinha pulsando + rótulo + relógio de
tempo decorrido, com barra indeterminada opcional. Genérico: não sabe **o quê** está
acontecendo, só que está e há quanto tempo. É a resposta honesta quando não dá para
medir progresso real.

```js
const act = createActivity({ label: 'pensando…' });   // sem barra (cabe num chip)
who.append(act.node);
act.start();                 // começa a contar (0s, 1s, 2s…)
act.label('escrevendo…');    // troca o texto sem zerar o relógio
act.stop();                  // para e libera o timer — sempre no fim

createActivity({ label: 'Compactando…', bar: true });  // com barra, para rodapés
```

`destroy()` é obrigatório se o nó puder sumir com a operação ainda viva (drawer
fechado no meio). Quem usa: [`bubble.js`](#bubblejs) (estado "trabalhando" da resposta)
e [`context-meter.js`](#context-meterjs) (o `/compact` rodando). Amanhã: um deploy, um
build, qualquer tarefa de duração desconhecida.

## `context-meter.js`

Barra de "quanto do contexto já está ocupado" + botão de compactar. Só números e um
callback — não sabe de conversa nem de API. Compõe [`activity.js`](#activityjs).

```js
const meter = createContextMeter({ onCompact: () => compactar(), warnAt: 0.75 });
footer.prepend(meter.node);
meter.set({ tokens: 258000, window: 1_000_000 });   // "contexto 258k / 1M"
const before = meter.tokens();                       // total atual (para o antes→depois)
meter.setBusy(true);                                 // troca a barra pela atividade viva
```

`set({ tokens: null })` mostra `—` (conversa sem uso registrado). A barra fica em cor
de alerta ao passar de `warnAt`. Durante `setBusy(true)` a barra estática vira o
indicador de [`activity.js`](#activityjs) (pulso + tempo + barra indeterminada), porque
o `/compact` é opaco e não dá para medir %. O painel guarda `before` e, ao terminar,
mostra o antes→depois no toast. `destroy()` é obrigatório (o indicador tem timer).
Serve para qualquer recurso com "orçamento" visível: tokens hoje, cota de disco depois.

## `dir-picker.js`

Modal que navega o disco do servidor e devolve a pasta escolhida. Desacoplado: recebe
a função `browse` por parâmetro — **não importa `api.js`** nem conhece rota.

```js
const dir = await openDirPicker({
  browse: api.fs.browse,        // (path?) => { path, parent, home, entries:[{name,path}] }
  start: '/home/eu/projetos',   // opcional; vazio = HOME do servidor
});
if (dir) usar(dir);             // null = cancelou
```

Devolve uma `Promise<string|null>`. Serve para qualquer "escolher onde": iniciar uma
conversa numa pasta hoje, "abrir pasta" no editor amanhã. O back que alimenta o
`browse` é o serviço `fs` (`GET /api/fs`), que só lista diretórios — nunca lê arquivo.

## `choice-select.js`

O **único** dropdown de opção do app: ferramentas (no chat e na barra de nova
conversa), modelo, e o que vier. Com `allowCustom`, ganha uma opção livre que revela um
campo de texto — para valores que não estão na lista (ex.: um id de modelo específico,
`claude-opus-4-8`). Recebe as opções por parâmetro.

```js
const mode = createChoiceSelect({ choices: MODE_CHOICES, value: 'none' });
const model = createChoiceSelect({
  choices: MODEL_CHOICES, value: 'opus', allowCustom: true,
  customLabel: 'versão específica…', customPlaceholder: 'ex.: claude-opus-4-8',
});
enviar({ mode: mode.value(), model: model.value() });
```

`value()` devolve a opção escolhida ou, em "outro", o texto digitado. `setDisabled(v)`
trava durante um envio. `onChange(v)` (opcional) dispara sempre que o valor efetivo
muda — é o que deixa o painel de Conversas **gravar o modo escolhido na hora** (ver
[`settings`](03-api.md#configurações-settings)), sem esperar o envio. O
[`composer`](#composerjs) usa este mesmo componente para renderizar seus `fields`
(e repassa o `onChange` de cada campo) — então um `<select>` de opção nunca é montado à mão.

Um `<input list=datalist>` **não** serve para "mostrar todas as opções": com um valor
preenchido o navegador filtra e esconde o resto. Por isso um `<select>` de verdade.

## `duration-field.js`

Campo de "quanto tempo": quantidade + unidade num só controle. Hoje é a retenção da
lixeira; serve para qualquer duração que apareça depois (timeout, intervalo…).

Não desenha `<select>` por conta própria — **compõe** o [`choice-select`](#choice-selectjs),
que é o único dropdown do app. E não decide nada com o número: recebe valor e callback.

```js
const ret = createDurationField({
  label: 'apagar o que está aqui há mais de',
  value: 30, unit: 'days',
  onChange: ({ value, unit }) => api.settings.saveGlobal({ … }),
});
bar.append(ret.node);
ret.value();      // { value: 30, unit: 'days' } — inteiro já normalizado em [min, max]
```

`value()` devolve `{ value, unit }` com o número já preso em `[min, max]` (padrão 1–999).
`setDisabled(v)` trava os dois campos. `destroy()` é **obrigatório** chamar (ele repassa
para o `choice-select`) — o painel Lixeira faz isso no seu `destroy()`.

Grava no `change`, não no `input`: digitar "30" passaria por "3" e dispararia uma
gravação intermediária que ninguém pediu.

Também exporta `DURATION_UNITS` (as unidades, com `value` igual ao que o backend
entende) e `formatDuration({ value, unit })`, que resolve o plural — "1 dia",
"3 meses". Quem monta frase usa o helper em vez de concatenar `label` na mão.

## `dir-field.js`

Campo de pasta: mostra o caminho escolhido + um botão que abre o
[`dir-picker`](#dir-pickerjs). Compõe o picker e guarda a escolha; recebe `browse` por
parâmetro (não importa `api.js`).

```js
const dir = createDirField({ browse: api.fs.browse, value: cwd, onChange: (d) => {} });
bar.append(dir.node);
iniciar({ cwd: dir.value() });   // dir.set(path) e dir.setDisabled(true) também existem
```

## `inline-edit.js`

Texto editável no lugar: mostra um valor + um botão ✎ que troca por um campo com
Salvar/Cancelar (Enter salva, Esc cancela). Recebe o valor e um `onSave` por
parâmetro — não sabe de API nem de painel.

```js
const ie = createInlineEdit({
  value: c.name || '', emptyLabel: 'sem nome', editTitle: 'Renomear',
  onSave: async (novo) => { await api.conversations.rename(c.id, novo); },
});
cell.append(ie.node);
// ie.edit() abre o campo por fora; ie.set(v) atualiza; ie.value() lê
```

Se `onSave` rejeitar, o componente fica em edição para tentar de novo (quem chama
mostra o erro). Para os botões dentro dele. Serve para renomear uma conversa hoje
(célula "Nome"), um arquivo/aba no editor amanhã.

## `image-tray.js`

Anexar imagens a uma mensagem: botão de escolher arquivo, **colar** (Ctrl+V) e uma
tira de miniaturas com remover. Desacoplado — guarda as imagens em memória e as
entrega em base64; não sabe de API. Tem duas partes de UI (a tira e o botão) porque
vivem em lugares diferentes do composer, então expõe `strip` e `button` separados.

```js
const tray = createImageTray();
above.append(tray.strip);      // miniaturas acima da caixa
row.append(tray.button);       // botão 🖼 na linha de ações
tray.attachPaste(textarea);    // liga o Ctrl+V na textarea
enviar({ images: tray.items() });   // [{ media_type, data(base64) }]
tray.clear();                  // depois de enviar
```

Quem usa é o [`composer`](#composerjs), com a opção `allowImages: true` — então o chat
inteiro (Conversas e Nova conversa) ganha "colar imagem" de graça. Aceita PNG, JPEG,
GIF e WebP; no máximo 6 por mensagem (o back revalida). As imagens viajam como blocos
`image` no `--input-format stream-json` do CLI ([10 · Chat](10-chat.md)).

## `floating-window.js`

Janela flutuante **arrastável** (pelo cabeçalho), **redimensionável** (alça no canto)
e **não-modal**: o host das janelas não captura cliques, então dá para abrir várias e
continuar usando a página por baixo. É o que substitui o drawer nas Conversas — cada
conversa abre numa janela própria.

```js
const win = createFloatingWindow({
  title: 'Conversa', subtitle: '…',
  actions: [colorPicker.node],       // controles extras no cabeçalho (antes do ✕)
  onClose: () => limpar(),
});
win.bodyEl.append(chat.node);      // conteúdo rolável
win.setFooter([meter.node, chat.footer]);
win.attach && chat.attach(win.scroller());
win.setSubtitle('20 de 262');      // atualiza sem redesenhar
win.setAccent('#3b82f6');          // tinge borda + cabeçalho ('' remove o realce)
win.focus();                        // traz para a frente
win.isOpen();                       // ainda está na tela?
win.close();                        // fecha (dispara onClose)
```

Empilha em cascata quando várias abrem. O `close()` remove o nó e todos os listeners
morrem com ele. `actions` é um slot genérico no cabeçalho (a área de ações não inicia
arrasto, então botões e popovers ali funcionam); `setAccent(cor)` injeta a cor como
`--fw-accent` (dado do usuário, não um token) e o CSS a usa via `color-mix` — é o que
dá a **cor por conversa**. Serve para conversas hoje e para abas/painéis flutuantes do
editor amanhã. **Fechar a janela não deve matar nada** — quem usa decide o que o
`onClose` faz (nas Conversas, ele destrói o chat com `abort: false`, deixando a resposta
em andamento terminar em segundo plano, e chama `colorPicker.destroy()`).

## `color-picker.js`

Um botão que mostra a cor atual e abre um popover com **amostras prontas** + um
seletor de **cor livre** (`<input type=color>`) e um "Padrão" que limpa. Dispara
`onChange(cor)` a cada escolha; a string vazia `''` significa "voltar ao padrão".
Burro: recebe as amostras e a cor por parâmetro, não sabe para que a cor serve.

```js
const cp = createColorPicker({
  value: '#ff6a45',                      // cor atual ('' = padrão)
  swatches: ['#ff6a45', '#17c964', '#3b82f6'],
  onChange: (cor) => { win.setAccent(cor); api.settings.save(id, { color: cor }); },
});
header.append(cp.node);
cp.value();       // cor atual
cp.set('#000');   // troca por fora (encadeável)
cp.destroy();     // remove o listener de "clique-fora" — obrigatório
```

Registra um listener de clique-fora para fechar o popover, então **`destroy()` é
obrigatório**. Quem usa hoje é o painel de Conversas: a cor vai como `action` no
cabeçalho da [`floating-window`](#floating-windowjs) e cada troca grava em
[`settings`](03-api.md#configurações-settings). Amanhã: cor de uma aba do editor,
etiqueta de um projeto — qualquer "escolher uma cor".

## `quick-replies.js`

Quando o Claude termina a resposta com uma **pergunta e opções em lista**, o chat
mostra essas opções como botões acima da caixa. Clicar num botão manda aquela opção;
"✎ escrever outra" foca a caixa (a resposta livre continua sempre possível).

```js
const qr = createQuickReplies({
  options: [{ label: 'Sim', value: 'Sim' }, { label: 'Não', value: 'Não' }],
  onPick: (value) => enviar(value),
  onWrite: () => composer.focus(),
});
host.append(qr.node);
```

Pura apresentação — recebe as opções e callbacks. **Quem decide se há opções** é a
função pura [`core/detect-options.js`](../public/js/core/detect-options.js)
(`detectOptions(text)`), que o [`chat`](#chatjs) roda no fim de cada resposta. Ela é
**conservadora**: só devolve opções quando há um sinal claro de escolha (um "?" ou
"qual/quer/prefere…") logo antes de uma lista curta de 2–6 itens; na dúvida, nada
aparece e você só digita.

Por que heurística e não um recurso da CLI: em headless a ferramenta de pergunta
(`AskUserQuestion`) **não existe** e o pedido de permissão **não é interceptável** —
quando o Claude quer perguntar, ele escreve a pergunta como texto. Então lemos o texto
dele; sem depender de nada que a CLI não ofereça, e sem poluir o transcript.

## `server-status.js`

Indicador vivo do servidor no rodapé da sidebar: **verde** = no ar, **vermelho** =
fora, **âmbar pulsante** = reiniciando. Traz os controles ↻ (reiniciar) e ⏻ (desligar).

```js
const status = createServerStatus({
  onRestart: () => api.server.restart(),   // sobe instância nova e assume
  onStop:    () => api.server.stop(),       // desliga o processo
  onStart:   () => copiarComando(),         // ver nota abaixo
});
footer.replaceChildren(status.node);
status.set('up');   // 'up' | 'down' | 'wait' — encadeável
```

Componente burro: não faz `fetch` nem conhece rota. Quem monta (`core/app.js`) faz o
`ping` de saúde e chama `set(...)`, e liga os callbacks às rotas
[`/api/_server/*`](03-api.md#sistema).

**Nota honesta (regra 8):** quando o servidor está **fora**, a página **não consegue
religá-lo** — o navegador não abre programas do PC, e não há ninguém escutando para
receber o clique. Por isso o estado `down` mostra **"▶ ligar"** que apenas dispara
`onStart`; o `app.js` trata copiando o comando `./start.sh` para você colar no terminal.
Desligar e reiniciar funcionam de verdade (o servidor vivo executa a ação).

## Como criar um componente novo

1. arquivo em `public/js/components/`, uma responsabilidade;
2. exporta uma função `createX(opts)` (ou uma função que devolve `Node`, se não tiver
   estado);
3. recebe **dados e callbacks**, nunca importa `api.js`;
4. devolve `{ node, ...métodos, destroy() }` — `destroy()` obrigatório se registra
   listener ou timer;
5. o CSS vai em `app.css` com prefixo do componente (`.feed-*`, `.composer-*`), usando
   só os tokens de `tokens.css`;
6. documente aqui com um exemplo de uso de verdade.

Teste de cheiro: se para entender o componente você precisa saber que existe uma
rota `/api/algo`, ele está acoplado demais — injete isso por parâmetro.
