// Feed paginado que cresce para cima (estilo timeline de mensagens).
//
// Não sabe de conversas, de API nem de drawer: recebe `fetchPage` e `renderItem`
// e devolve o nó pronto. Serve para qualquer lista longa que se lê do fim para o
// começo — mensagens, logs, histórico de commits, saída de terminal.
//
//   const feed = createFeed({
//     fetchPage: ({ limit, before }) => api.conversations.read(id, { limit, before }),
//     renderItem: (m) => messageBubble(m),
//     onState: ({ shown, total }) => drawer.setSubtitle(`${shown} de ${total}`),
//   });
//   container.append(feed.node);
//   feed.attach(scrollerElement);
//   await feed.loadFirst();

import { el } from '../core/ui.js';

const DEFAULT_LABELS = {
  loading: 'carregando mensagens anteriores…',
  more: (n) => `↑ carregar ${n} anteriores`,
  progress: (shown, total) => `${shown} de ${total} · role para cima`,
  done: (total) => `· início · ${total} itens ·`,
  retry: 'tentar de novo',
};

/**
 * @param {object} opts
 * @param {(args: {limit:number, before?:number}) => Promise<object>} opts.fetchPage
 *        deve devolver { items|messages, total, from, hasMore }
 * @param {(item:any) => Node} opts.renderItem
 * @param {number} [opts.pageSize=20]
 * @param {number} [opts.triggerPx=150] distância do topo que dispara a próxima página
 * @param {(state:{shown:number,total:number,hasMore:boolean}) => void} [opts.onState]
 * @param {object} [opts.labels]
 */
export function createFeed({
  fetchPage,
  renderItem,
  pageSize = 20,
  triggerPx = 150,
  onState,
  labels = {},
}) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const list = el('div', { class: 'feed-list' });
  const sentinel = el('div', { class: 'feed-sentinel' });
  const node = el('div', { class: 'feed' }, sentinel, list);

  let scroller = null;
  let detach = null;
  let oldest = null;
  let total = 0;
  let hasMore = true;
  let loading = false;

  const state = () => ({ shown: total - (oldest ?? total), total, hasMore, loading });
  const notify = () => onState?.(state());
  const nearBottom = () =>
    !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;

  function setSentinel(kind, err) {
    sentinel.className = `feed-sentinel${kind === 'done' ? ' done' : ''}`;
    if (kind === 'loading') {
      sentinel.replaceChildren(el('span', {}, text.loading));
    } else if (kind === 'more') {
      sentinel.replaceChildren(
        el('button', { class: 'btn small', type: 'button', onclick: () => loadMore() },
          text.more(pageSize)),
        el('span', {}, text.progress(state().shown, total)));
    } else if (kind === 'done') {
      sentinel.replaceChildren(el('span', {}, text.done(total)));
    } else if (kind === 'error') {
      sentinel.replaceChildren(
        el('span', {}, `falhou: ${err?.message || err}`),
        el('button', { class: 'btn small', type: 'button', onclick: () => loadMore() }, text.retry));
    } else {
      sentinel.replaceChildren();
    }
  }

  async function load({ first = false } = {}) {
    if (loading || (!first && !hasMore)) return;
    loading = true;
    setSentinel('loading');

    const prevHeight = scroller?.scrollHeight ?? 0;
    const prevTop = scroller?.scrollTop ?? 0;

    try {
      const page = await fetchPage({ limit: pageSize, before: first ? undefined : oldest });
      const items = page.items || page.messages || [];
      total = page.total ?? items.length;
      hasMore = Boolean(page.hasMore);
      oldest = page.from ?? 0;

      const nodes = items.map(renderItem);
      if (first) {
        list.replaceChildren(...nodes);
        scrollToEnd();
      } else if (nodes.length) {
        list.prepend(...nodes);
        // devolve o usuário exatamente ao ponto onde ele estava lendo
        if (scroller) scroller.scrollTop = prevTop + (scroller.scrollHeight - prevHeight);
      }

      setSentinel(hasMore ? 'more' : 'done');
      notify();
    } catch (err) {
      setSentinel('error', err);
      if (first) throw err;
    } finally {
      loading = false;
    }
  }

  function scrollToEnd() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  return {
    node,
    list,

    /** Liga o scroll infinito ao elemento que realmente rola. */
    attach(element) {
      detach?.();
      scroller = element;
      const onScroll = () => {
        if (!hasMore || loading) return;
        if (scroller.scrollTop <= triggerPx) load();
      };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      detach = () => {
        scroller.removeEventListener('scroll', onScroll);
        detach = null;
      };
    },

    loadFirst: () => load({ first: true }),
    loadMore: () => load(),

    /** Acrescenta um item no fim (ex.: mensagem nova chegando). */
    append(...nodes) {
      const wasAtBottom = nearBottom();
      list.append(...nodes.flat().filter(Boolean));
      total += nodes.flat().filter(Boolean).length;
      if (wasAtBottom) scrollToEnd();
      notify();
    },

    scrollToEnd,
    state,
    destroy() {
      detach?.();
      scroller = null;
    },
  };
}

/** Recarrega um feed do zero (útil depois de gravar algo novo no fim). */
export async function reloadFeed(feed) {
  await feed.loadFirst();
}
