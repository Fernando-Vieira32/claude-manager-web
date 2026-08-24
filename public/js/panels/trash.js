import { api } from '../core/api.js';
import { el, fmt, toast, states } from '../core/ui.js';

export default {
  id: 'trash',
  icon: '⌫',
  title: 'Lixeira',
  description: 'Conversas removidas — restaure ou deixe guardadas',
  searchPlaceholder: 'filtrar por projeto, id…',

  mount(root, ctx) {
    let term = ctx.search();
    const body = el('div', {});
    root.replaceChildren(body);

    const matches = (t) => !term
      || `${t.name} ${t.projectDir} ${t.sessionId}`.toLowerCase().includes(term.toLowerCase());

    async function load() {
      body.replaceChildren(states.loading(2));
      try {
        const { items } = await api.conversations.trash();
        const visible = items.filter(matches);
        ctx.setCount(items.length);
        if (!visible.length) {
          body.replaceChildren(states.empty(
            items.length ? 'Nada casa com o filtro' : 'Lixeira vazia',
            items.length ? '' : 'Conversas deletadas aparecem aqui.'));
          return;
        }
        body.replaceChildren(el('div', { class: 'cards' }, ...visible.map(card)));
      } catch (err) {
        body.replaceChildren(states.error(err, load));
      }
    }

    function card(t) {
      return el('div', { class: 'card row' },
        el('div', { class: 'card-main' },
          el('div', { class: 'card-title code' }, t.sessionId),
          el('div', { class: 'meta' },
            el('span', { class: 'chip' }, t.projectDir),
            el('span', {}, `deletada ${fmt.when(t.deletedAt)}`),
            el('span', {}, fmt.bytes(t.bytes)))),
        el('div', { class: 'actions' },
          el('button', {
            class: 'btn small primary',
            type: 'button',
            onclick: async () => {
              try {
                await api.conversations.restore(t.name);
                toast('Conversa restaurada.', { type: 'ok' });
              } catch (err) {
                toast(err.message, { type: 'err' });
              }
              load();
            },
          }, 'Restaurar')));
    }

    load();
    return { onSearch(v) { term = v; load(); }, refresh: load };
  },
};
