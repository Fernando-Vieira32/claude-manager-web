import { api } from '../core/api.js';
import { el, states } from '../core/ui.js';

// Painel de "meta": mostra os serviços registrados no backend.
// Serve de mapa para quando você for plugar novos módulos (ex.: editor de código).
export default {
  id: 'services',
  icon: '⚙',
  title: 'Serviços',
  description: 'Módulos registrados no backend e suas rotas',
  searchPlaceholder: 'filtrar rota…',

  mount(root, ctx) {
    let term = ctx.search();
    const body = el('div', {});
    root.replaceChildren(body);

    async function load() {
      body.replaceChildren(states.loading(2));
      try {
        const data = await api.meta.services();
        ctx.setCount(data.services.length);
        const cards = data.services.map((svc) => {
          const routes = svc.routes.filter((r) =>
            !term || `${r.method} ${r.path} ${r.summary}`.toLowerCase().includes(term.toLowerCase()));
          if (term && !routes.length) return null;
          return el('div', { class: 'card' },
            el('div', { class: 'card-main' },
              el('div', { class: 'card-title' },
                el('span', { class: 'chip accent' }, svc.id), ' ', svc.description),
              el('div', { class: 'meta' }, el('span', { class: 'mono' }, svc.basePath))),
            el('table', { class: 'grid' },
              el('tbody', {}, ...routes.map((r) => el('tr', {},
                el('td', { class: 'code', style: 'width:70px' }, r.method),
                el('td', { class: 'code' }, r.path),
                el('td', {}, r.summary))))));
        }).filter(Boolean);

        body.replaceChildren(
          el('div', { class: 'toolbar-line' },
            el('span', {}, `${data.app} v${data.version} · ${data.services.length} serviços`)),
          el('div', { class: 'cards' }, ...(cards.length ? cards : [states.empty('Nada casa com o filtro')])));
      } catch (err) {
        body.replaceChildren(states.error(err, load));
      }
    }

    load();
    return { onSearch(v) { term = v; load(); }, refresh: load };
  },
};
