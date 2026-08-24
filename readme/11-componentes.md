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
  bubble.js       bolha de mensagem estática e bolha de streaming
  composer.js     caixa de escrever com campos de opção e enviar/parar
  chat.js         feed + composer + fila de envio = vista de conversa
  stream-sink.js  traduz os eventos do stream em chamadas na bolha viva
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
| `scrollToEnd()` · `state()` · `destroy()` | utilidades |

Serve para qualquer histórico longo: mensagens hoje, saída de terminal ou lista de
commits depois.

## `bubble.js`

```js
messageBubble({ role: 'user', text, at, badge });          // → Node
messageBubble(msgDaApi);   // com `tools`, já monta os chips de ferramenta resolvidos
clearBadge(node);          // tira a etiqueta de uma bolha já montada → o próprio node
```

`clearBadge` existe para a fila do [`chat`](#chatjs): a mensagem entra na tela com
`badge: 'na fila'` e, quando chega a vez dela, perde a etiqueta **na mesma bolha**. A
função vive aqui porque a marcação (`.bubble-badge`) é conhecimento desta peça — quem
usa não deve cutucar o DOM dela.

```js
const b = streamBubble({ role: 'assistant' });      // → controles
feed.append(b.node);
b.append('pedaço de texto');   // streaming
b.addTool('Bash', { id, input });         // compõe o tool-call (chip expansível)
b.addTool('Bash', { id, parentId: idDoAgent });   // ANINHA dentro do chip do Agent
b.setToolResult(id, { text, isError });   // casa o retorno pelo id do tool_use
b.addNotice('limite de uso');  // aviso discreto
b.setStatus('claude-opus-5');  // chip do cabeçalho
b.setError('deu erro');        // marca a bolha
b.finish('$0.0116 · 1 turno'); // encerra o estado "digitando"
```

Quem consome um stream nunca toca no DOM: só chama esses métodos.

**`parentId` é o que faz o subagente aninhar.** Quando ele casa com uma chamada já
registrada, a nova entra **dentro** dela ([`tool-call`](#tool-calljs) → `addChild`); só
aparece ao expandir o pai, como no terminal. Funciona em qualquer profundidade, porque o
filho também fica no mapa e passa a ser pai do neto. `parentId` que não casa com ninguém
cai no nível de cima — melhor mostrar solto que sumir.

## `stream-sink.js`

Pega um evento do stream e mexe na bolha. É só isso — e é o suficiente para tirar 70
linhas de `switch` de dentro do `chat.js`.

```js
const onEvent = createStreamSink({
  bubble,                                  // uma instância de streamBubble
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
| `setBusy(true)` | botão vira **"Enfileirar"**, aparece "Parar". A caixa **continua escrevível** | enquanto uma resposta corre — quem serializa é o [`chat`](#chatjs), que enfileira |
| `setLocked(true, motivo)` | `disabled` na caixa e no botão; `motivo` vira o placeholder | operação que mexe na conversa e **não** aceita fila (hoje só `/compact`) |

Antes o `setBusy` fazia `input.disabled = true`, e o resultado era o oposto do
terminal: durante a resposta você ficava de mãos atadas, sem poder nem digitar a
próxima mensagem. Se você precisa impedir o envio, é `setLocked` — e aí diga o
porquê no `motivo`, senão o usuário só vê uma caixa morta.

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

`submit(text, images)` envia por código pelo **mesmo** caminho do clique em "Enviar" (é
o que as respostas rápidas já usavam por dentro). Serve para abrir a vista já com a
primeira mensagem em mão — é assim que a tela de nova conversa manda a primeira.

### A fila (uma resposta por vez, sem travar a caixa)

Como no terminal: você digita durante a resposta e a mensagem **espera a vez**.

- mandar com uma resposta em andamento **enfileira**: a bolha já aparece na tela com a
  etiqueta `na fila` (é o `badge` do [`bubble`](#bubblejs));
- quando a resposta atual termina, o `chat` tira a etiqueta daquela bolha — não cria uma
  segunda — e manda. Nunca há dois streams ao mesmo tempo na mesma conversa;
- enquanto sobrar item na fila o botão continua "Enfileirar"; ele só volta a "Enviar"
  quando a fila esvazia (senão o rótulo piscava entre uma mensagem e a outra);
- `destroy()` **descarta a fila**: fechar a janela não continua mandando mensagem que
  você não vai ver.

Quem precisa de fato bloquear a escrita usa `chat.composer.setLocked(...)` — ver a
tabela em [`composer`](#composerjs).

## `conversation-window.js`

A vista completa de "estar dentro de uma conversa": compõe
[`floating-window`](#floating-windowjs) + [`chat`](#chatjs) +
[`context-meter`](#context-meterjs) + [`color-picker`](#color-pickerjs).

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
  stop: () => api.chat.stop(c.id),
  onSaveSetting: (patch) => api.settings.save(c.id, patch),
  onCompact: (j) => compactar(j.meter, j.chat),
  onFinish: (j) => j.chat.reload(),
});
await janela.chat.start();
janela.focus();
```

Devolve `{ id, win, chat, meter, setId, setTitle, setHeader, focus, destroy }`.

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
