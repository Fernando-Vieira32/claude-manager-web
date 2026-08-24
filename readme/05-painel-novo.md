# 05 · Criar um painel (front)

[← sumário](README.md)

Continuando o exemplo do [serviço `files`](04-servico-novo.md): uma aba que navega
pelas pastas e mostra o conteúdo do arquivo no drawer.

## 1. Um atalho na camada de API

Painel nenhum usa `fetch`. Em `public/js/core/api.js`, dentro do objeto `api`:

```js
files: {
  list: (path) => api.get('/api/files', { path }),
  read: (path) => api.get('/api/files/read', { path }),
},
```

## 2. O painel

`public/js/panels/files.js`:

```js
import { api } from '../core/api.js';
import { el, fmt, toast, drawer, states } from '../core/ui.js';

export default {
  id: 'files',
  icon: '⌸',
  title: 'Arquivos',
  description: 'Navegue e leia arquivos do disco',
  searchPlaceholder: 'filtrar nesta pasta…',

  mount(root, ctx) {
    let cwd = '.';
    let term = ctx.search();
    const body = el('div', {});
    root.replaceChildren(body);

    async function load() {
      body.replaceChildren(states.loading(3));
      try {
        const data = await api.files.list(cwd);
        cwd = data.path;
        const items = data.items.filter((i) =>
          !term || i.name.toLowerCase().includes(term.toLowerCase()));
        ctx.setCount(items.length);
        body.replaceChildren(
          el('div', { class: 'toolbar-line' },
            el('span', { class: 'code' }, `${data.root}/${cwd === '.' ? '' : cwd}`),
            cwd !== '.' ? el('button', {
              class: 'btn small', type: 'button',
              onclick: () => { cwd = cwd.split('/').slice(0, -1).join('/') || '.'; load(); },
            }, '↑ subir') : null),
          items.length
            ? el('div', { class: 'cards' }, ...items.map(row))
            : states.empty('Pasta vazia ou nada casa com o filtro'));
      } catch (err) {
        body.replaceChildren(states.error(err, load));
      }
    }

    function row(item) {
      return el('div', {
        class: 'card row clickable',
        onclick: () => (item.dir ? (cwd = item.path, load()) : open(item)),
      },
        el('div', { class: 'card-main' },
          el('div', { class: 'card-title' }, `${item.dir ? '▸' : '·'} ${item.name}`),
          el('div', { class: 'meta' },
            el('span', {}, item.dir ? 'pasta' : fmt.bytes(item.bytes)),
            el('span', {}, fmt.when(item.modifiedAt)))),
        el('div', { class: 'actions' },
          el('span', { class: 'chip' }, item.dir ? 'abrir' : 'ler')));
    }

    async function open(item) {
      drawer.open({ title: item.name, subtitle: item.path, body: states.loading(2) });
      try {
        const file = await api.files.read(item.path);
        drawer.open({
          title: item.name,
          subtitle: `${item.path} · ${fmt.bytes(file.bytes)}`,
          body: el('pre', { class: 'msg assistant' }, file.text),
        });
      } catch (err) {
        toast(err.message, { type: 'err' });
        drawer.close();
      }
    }

    load();
    return { onSearch(v) { term = v; load(); }, refresh: load };
  },
};
```

## 3. Registre

`public/js/panels/index.js`:

```js
import files from './files.js';
export default [sessions, conversations, files, trash, services];
```

A ordem do array é a ordem da sidebar. Recarregue a página (sem build, sem cache).

## O que o `ctx` oferece

| Item | Para quê |
| --- | --- |
| `ctx.search()` | termo que já estava na busca ao montar |
| `ctx.setCount(n)` | número no badge da sidebar |
| `ctx.toast(msg, opts)` | mesma função de `ui.js` |
| `ctx.go(id)` | trocar de painel sem conhecer o outro painel |

E o que o painel devolve: `{ onSearch(termo), refresh(), destroy() }` — todos
opcionais. `destroy()` é onde você limpa `setInterval`, `AbortController` e
listeners globais (o painel de sessões faz isso com o timer de 5s).

## Convenções de UI que já existem

Use os componentes de `ui.js` e as classes do CSS em vez de inventar:
`states.loading()`, `states.empty()`, `states.error(err, retry)`, `toast()`,
`confirmAction()`, `drawer.open()`; classes `card`, `card row`, `cards`, `chip`,
`meta`, `code`, `btn small`, `grid`. Detalhes em [06 · Interface](06-interface.md).
