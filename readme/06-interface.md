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
| `skeleton`, `state` | carregando e estados vazios |

Regra de ouro no CSS: `[hidden] { display: none !important; }` está no topo do
arquivo porque vários componentes usam `display: grid/flex` — sem isso o atributo
`hidden` não esconde nada (foi exatamente esse o bug do modal aparecendo sozinho).

## Painéis atuais

| Painel | Arquivo | Particularidades |
| --- | --- | --- |
| Nova conversa | `panels/new-conversation.js` | tela inicial; barra de modelo/pasta/modo + `chat`; inicia a conversa (`api.chat.start`) e depois continua |
| Sessões | `panels/sessions.js` | auto-refresh de 5s com `destroy()` limpando o timer; SIGTERM → oferta de SIGKILL no toast |
| Conversas | `panels/conversations.js` | compõe `data-table` + `chat` + `context-meter` + `inline-edit` (renomear) + `color-picker`; abre em janelas flutuantes (várias, não-modais) com modo/cor salvos por conversa; **a linha da lista aparece na cor configurada** (faixa + tinta, via `rowClass`/`rowStyle` — ver [11](11-componentes.md#destacar-uma-linha)); deletar com "Desfazer" |
| Lixeira | `panels/trash.js` | filtro local (a lista é pequena), restauração e expurgo por idade ([`duration-field`](11-componentes.md#duration-fieldjs) + retenção na config global) |
| Serviços | `panels/services.js` | desenha `/api/_services`: documentação que não desatualiza |

## Leitor e chat de conversas

Cada conversa abre numa [janela flutuante](11-componentes.md#floating-windowjs)
(arrastável, redimensionável, não-modal — dá para abrir várias) que compõe
`data-table` → `chat` (`feed` + `composer`): abre com as 20 últimas mensagens roladas
até o fim, libera as anteriores ao subir e tem a caixa de escrever no rodapé fixo.
Fechar a janela não interrompe uma resposta em curso (ela termina em segundo plano).
Contratos em [11 · Componentes](11-componentes.md); o servidor em [10 · Chat](10-chat.md).

**Preferências por conversa (salvas em arquivo).** Cada conversa lembra o **modo** do
chat (só conversa/plano/…) e uma **cor** para a janela — não se perde ao fechar e
reabrir. O modo grava assim que você troca; a cor sai do seletor 🎨 no cabeçalho da
janela (amostras + cor livre; "Padrão" remove). Tudo vai para um arquivo por conversa
em `data/conversas/` (dentro do projeto, ignorado no git), pelo serviço
[`settings`](03-api.md#configurações-settings) — o vínculo arquivo ↔ conversa é o `:id`
único da conversa. É chave/valor, então dá para lembrar mais coisas no futuro sem mexer
no serviço.

(O `drawer` continua em `ui.js` como primitivo reutilizável, hoje sem uso — as
conversas migraram para janelas flutuantes.)
