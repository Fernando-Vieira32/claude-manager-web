# 06 · Interface

[← sumário](README.md)

## Layout

```
┌──────────────┬──────────────────────────────────────────────┐
│ marca        │ título do painel        busca   [Atualizar]  │  topbar
│              ├──────────────────────────────────────────────┤
│ ＋ Nova conv │                                              │
│ ◉ Sessões  1 │   #panel-root — conteúdo do painel ativo     │
│ ❐ Conversas8 │                                              │
│ ⌫ Lixeira    │      (as conversas abrem em janelas          │
│ ⚙ Serviços 2 │       flutuantes soltas sobre a página)      │
│ [Tema]       │                                              │
│ ● no ar ↻ ⏻ ├──────────────────────────────────────────────┤
└──────────────┴──────────────────────────────────────────────┘
   janelas flutuantes · modal (centro) · toasts (canto)
```

`public/index.html` só tem a casca: sidebar, topbar, `#panel-root`, drawer, modal e
a área de toasts. As janelas de conversa nascem num host próprio no `<body>`
([`floating-window`](11-componentes.md#floating-windowjs)). Todo o conteúdo é criado por JS.

No rodapé da sidebar, de cima para baixo:

- **Tema** — alterna claro/escuro.
- **status do servidor** ([`server-status`](11-componentes.md#server-statusjs)):
  verde = no ar, vermelho = fora, âmbar = reiniciando; com ↻ reiniciar e ⏻ desligar.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `/` | foca a busca |
| `r` | recarrega o painel (mesmo que o botão Atualizar) |
| `Esc` | fecha drawer/modal, ou desfoca a busca |
| `Enter` | confirma o modal aberto |

## Tema e tokens

`public/css/tokens.css` guarda **todas** as decisões visuais em variáveis:

```css
/* paleta moderna: neutros frios + coral vivo com gradiente coral→rosa */
:root { --accent: #ff6a45; --accent-2: #ff4f8b; --grad: linear-gradient(135deg, var(--accent), var(--accent-2));
        --ok: #17c964; --warn: #ffb020; --danger: #ff4d67; --radius: 14px; … }
:root[data-theme="dark"]  { --bg: #0d0e13; --surface: #1a1c26; --text: #edeef3; … }
:root[data-theme="light"] { --bg: #f6f7fb; --surface: #ffffff; --text: #191b23; … }
```

Cada cor semântica tem um par `--x-soft` (fundo suave) e há `--on-accent` (texto sobre
o gradiente). O botão **Tema** troca `data-theme` no `<html>` e grava em
`localStorage['cmw:theme']`. Para mudar a identidade do painel, mexa só nos tokens —
`app.css` não tem cor literal (só backdrops pretos neutros). Trocar o `--accent` e o
`--accent-2` repinta a interface inteira.

> Peças instanciáveis (feed, bolhas, caixa de escrever, tabela) ficam em
> `js/components/` e estão documentadas em [11 · Componentes](11-componentes.md).
> Aqui estão só as de casca, únicas na página.

## Componentes de `js/core/ui.js`

```js
el('div', { class: 'card', onclick: fn, dataset: { id: 1 } }, 'texto', outroNode)
```
Criador de elementos: `class`, `html`, `dataset`, qualquer `on*` como listener,
demais chaves como atributos. Filhos podem ser string, Node, array ou `null`
(ignorado) — dá para escrever `cond ? el(…) : null` sem `if`.

**Valor `null`/`undefined`/`false` faz a chave ser ignorada — inclusive `class`.** Isso
importa porque o padrão `class: cond ? 'x' : null` é usado à vontade no projeto: antes a
checagem existia só no ramo dos atributos, então `class: null` caía em
`node.className = null` e o DOM gravava a **string "null"** (havia 171 elementos com
`class="null"` na página). Não quebrava seletor nenhum, mas era sujeira esperando alguém
definir `.null`.

```js
fmt.bytes(61234)   // "60KB"
fmt.when(iso)      // "agora", "38 min atrás", "2 h atrás", "18/08 12:03"
fmt.clock(iso)     // data e hora completas (bom para title=)
```

```js
toast('Sessão encerrada.', { type: 'ok' });            // ok | err | info
toast('Conversa na lixeira.', {
  type: 'ok',
  action: { label: 'Desfazer', run: () => restaurar() },
});
```
Fecha sozinho em **5 s** (`TOAST_MS`, exportado do `ui.js`). O `timeout` é opcional e
serve para pedir *menos* tempo: ele é limitado ao teto, então passar `9000` não estica
nada — não existe toast permanente.

Passar o mouse por cima **adia** o fechamento enquanto o ponteiro estiver ali (dá tempo
de mirar o "Desfazer"); ao sair, o relógio recomeça. Fechar pelo botão de ação também
cancela o timer, sem deixar `setTimeout` pendente.

```js
const ok = await confirmAction({
  title: 'Deletar conversa?',
  text: 'Vai para a lixeira — dá para restaurar.',
  okLabel: 'Mover para a lixeira',
  danger: true,
});
if (!ok) return;
```

```js
drawer.open({ title, subtitle, body, onClose });  // body: Node ou array de Nodes
drawer.setSubtitle('40 de 110 mensagens');        // atualiza sem redesenhar
drawer.scroller();                                 // #drawer-body: o elemento que rola
drawer.close();                                    // dispara o onClose
```
`onClose` existe para liberar recursos do conteúdo (listeners, timers) — o leitor de
conversas usa para remover o listener de scroll. `scroller()` é o que permite scroll
infinito e ancoragem de posição.

```js
states.loading(3)              // esqueletos animados
states.empty('Nada aqui', 'dica opcional')
states.error(err, () => load())  // mensagem + botão "Tentar de novo"
```

## Classes úteis de `app.css`

| Classe | Para quê |
| --- | --- |
| `cards` / `card` / `card row` | lista de cartões; `row` alinha ações à direita |
| `card-main`, `card-title`, `meta` | miolo do cartão, título e linha de metadados |
| `chip`, `chip accent/ok/warn` | etiquetas curtas (projeto, PID, status) |
| `code`, `mono` | texto monoespaçado esmaecido |
| `btn`, `btn small`, `btn primary`, `btn danger`, `icon-btn` | botões |
| `grid` (em `<table>`) | tabela com cabeçalho discreto e hover |
| `toolbar-line` | linha de contexto acima da lista (contagem, switches) |
| `switch` | rótulo + checkbox (ex.: "atualizar a cada 5s") |
| `msg`, `msg user`, `msg assistant` | bolhas de conversa no drawer |
| `ctx-*` | medidor de contexto (rótulo, barra, alerta) |
| `skeleton`, `state` | carregando e estados vazios |

Regra de ouro no CSS: `[hidden] { display: none !important; }` está no topo do
arquivo porque vários componentes usam `display: grid/flex` — sem isso o atributo
`hidden` não esconde nada (foi exatamente esse o bug do modal aparecendo sozinho).

## Painéis atuais

| Painel | Arquivo | Particularidades |
| --- | --- | --- |
| Nova conversa | `panels/new-conversation.js` | **lançador**: barra de modelo/pasta/modo + `composer`; ao enviar a primeira mensagem a conversa **abre numa janela** ([`conversation-window`](11-componentes.md#conversation-windowjs)) — a mesma de "Ler" |
| Sessões | `panels/sessions.js` | auto-refresh de 5s com `destroy()` limpando o timer; SIGTERM → oferta de SIGKILL no toast; a conversa da sessão é desenhada pelo [`source-tag`](11-componentes.md#source-tagjs) — sai marcada **`(palpite)`** quando não é certeza —, e execuções `-p` levam o chip **`headless`** |
| Conversas | `panels/conversations.js` | compõe `data-table` + `inline-edit` (renomear) + [`conversation-window`](11-componentes.md#conversation-windowjs); **a linha da lista aparece na cor configurada** (faixa + tinta, via `rowClass`/`rowStyle` — ver [11](11-componentes.md#destacar-uma-linha)); deletar com "Desfazer" |
| Lixeira | `panels/trash.js` | filtro local (a lista é pequena), restauração e expurgo por idade ([`duration-field`](11-componentes.md#duration-fieldjs) + retenção na config global) |
| Serviços | `panels/services.js` | desenha `/api/_services`: documentação que não desatualiza |

## Leitor e chat de conversas

Cada conversa abre numa [janela flutuante](11-componentes.md#floating-windowjs)
(arrastável, redimensionável, não-modal — dá para abrir várias) montada pelo
[`conversation-window`](11-componentes.md#conversation-windowjs): abre com as 20 últimas
mensagens roladas até o fim, libera as anteriores ao subir e tem a caixa de escrever no
rodapé fixo. Fechar a janela não interrompe uma resposta em curso (ela termina em
segundo plano). Contratos em [11 · Componentes](11-componentes.md); o servidor em
[10 · Chat](10-chat.md).

### Aviso de "aberta num terminal": só com certeza

A faixa amarela "Esta conversa está aberta num terminal (PID …)" sai **só** quando algum
processo declara no comando `--resume <o id desta conversa>` — o `conversationSource:
'args'` de [03 · API](03-api.md#sessões). Nos outros casos **não aparece nada**.

Não existe meio-termo aqui, e isso é decisão, não falta de vontade:

- **conversa nova é sessão nova.** Criar uma conversa pelo navegador não pode avisar
  nada — não há como ela estar aberta em outro lugar. Antes avisava, porque o aviso saía
  do **palpite** (o `.jsonl` mais recente da pasta) e o mais recente tinha acabado de ser
  criado por nós mesmos;
- **pasta não é conversa.** "Há um Claude rodando nesta pasta" chegou a existir como
  faixa cinza e foi removido: é verdade e é inútil — não dá para confirmar se é *esta*
  conversa, então só ocupa espaço e ensina a ignorar avisos;
- **um `claude` cru de terminal não declara id nenhum**, então para ele o aviso nunca
  sai. Quem quiser o aviso funcionando abre o terminal com `claude --resume <id>`;
- execuções `headless` (`-p`) são ignoradas: são deste painel, e dois envios na mesma
  conversa já batem no 409 do serviço de chat.

**A caixa não trava enquanto o Claude responde** — igual ao terminal. Mandou durante uma
resposta? A mensagem aparece na hora com a etiqueta `na fila` e é enviada sozinha quando
a atual terminar (o botão diz "Enfileirar" justamente para isso não ser surpresa). O que
trava de verdade é o **compactar**, e aí o placeholder da caixa explica. Detalhe em
[`chat`](11-componentes.md#chatjs).

**Os dois caminhos abrem a MESMA janela.** Clicar em "Ler" na lista e iniciar uma
conversa nova compõem o mesmo componente — e ele guarda quais estão abertas, então
começar uma conversa e depois clicar em "Ler" nela **foca a janela existente** em vez de
abrir uma segunda. Antes a conversa nova ficava embutida no painel: outro lugar, outra
aparência, e ela saía de vista ao trocar de aba.

**No cabeçalho:** `projeto · N de M mensagens · tamanho · modelo`. O modelo ali é o que
**respondeu de fato** (vem do transcript); o seletor de modelo no rodapé é o que vale
para o **próximo** envio — os dois podem divergir, e é por isso que aparecem separados.

**Preferências por conversa (salvas em arquivo).** Cada conversa lembra o **modo** do
chat (só conversa/plano/…), o **modelo**, uma **cor** para a janela e uma **frase fixa**
para o fim das mensagens — não se perde ao fechar e reabrir. Modo e modelo gravam assim
que você troca, mesmo sem enviar; a cor sai do seletor 🎨 no cabeçalho da janela
(amostras + cor livre; "Padrão" remove); a frase sai do botão **✎** ao lado dele. Tudo vai
para um arquivo por conversa
em `data/conversas/` (dentro do projeto, ignorado no git), pelo serviço
[`settings`](03-api.md#configurações-settings) — o vínculo arquivo ↔ conversa é o `:id`
único da conversa. É chave/valor, então dá para lembrar mais coisas no futuro sem mexer
no serviço.

### Frase fixa no fim das mensagens

O botão **✎** no cabeçalho da janela guarda uma frase e um interruptor. Ligado, essa
frase é acrescentada ao fim de **toda** mensagem que você mandar **nesta conversa** —
serve para instrução repetida ("responda em português", "sempre em tópicos", "não altere
arquivo sem me perguntar") sem digitar de novo a cada vez.

| Estado do botão | O que significa |
| --- | --- |
| esmaecido, escrito `frase` | não há frase definida |
| normal, com a frase resumida | há frase, **desligada** |
| destacado (cor de acento) | **ligada** — está indo em toda mensagem |

Como funciona, e por que assim:

- **o que você vê é o que foi enviado.** A frase é acrescentada *antes* de a bolha ser
  desenhada, então a mensagem na tela é exatamente o texto que foi para o Claude.
  Acrescentar só na hora do envio deixaria a tela mentindo;
- **separada por linha em branco**, como um parágrafo novo — não colada no fim da frase;
- **não empilha**: se a mensagem já termina com a frase (reenvio, cópia), ela não entra
  de novo;
- **mensagem vazia** (só imagens) vira só a frase;
- **apagar a frase desliga** o interruptor: não existe "ligado sem frase";
- grava ao **sair do campo**, não a cada tecla — configuração é arquivo, e uma gravação
  por letra é rajada de escrita à toa (ver o bug de escrita concorrente em
  [07](07-seguranca.md)).

As chaves no arquivo da conversa são `suffix` (texto) e `suffixOn` (booleano). Quem
aplica é a regra pura [`core/message-suffix.js`](13-testes.md); quem desenha é o
componente [`toggle-text`](11-componentes.md#toggle-textjs) — e o `chat` só sabe que
existe um gancho `beforeSend`.

(O `drawer` continua em `ui.js` como primitivo reutilizável, hoje sem uso — as
conversas migraram para janelas flutuantes.)
