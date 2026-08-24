import { api } from '../core/api.js';
import { el, fmt, toast, confirmAction, states } from '../core/ui.js';
import { sourceTag } from '../components/source-tag.js';

/**
 * Qual conversa esta sessão está usando — dizendo se é certeza ou palpite. O
 * Claude não deixa o transcript aberto num descritor, então só há certeza quando
 * o próprio comando traz `--resume <id>`. Mostrar palpite sem etiqueta fazia a
 * interface afirmar o que não sabe (ver readme/03-api.md).
 */
function conversaDaSessao(s) {
  if (!s.conversationId) return null;
  const texto = `conversa ${s.conversationId.slice(0, 8)}…`;
  const certeza = s.conversationSource === 'args';
  return sourceTag({
    text: texto,
    certain: certeza,
    title: certeza
      ? `conversa ${s.conversationId} (declarada no comando)`
      : `palpite: ${s.conversationId} é a conversa modificada mais recentemente nesta pasta.`
        + ' Não há como saber por fora em qual conversa um terminal está.',
  });
}

export default {
  id: 'sessions',
  icon: '◉',
  title: 'Sessões abertas',
  navTitle: 'Sessões',
  description: 'Processos do Claude Code rodando agora nesta máquina',
  searchPlaceholder: 'filtrar por PID, tty, pasta…',

  mount(root, ctx) {
    let term = ctx.search();
    let auto = true;
    let timer = null;

    const list = el('div', { class: 'cards' });
    const info = el('span', {}, '');
    const autoBox = el('input', { type: 'checkbox', checked: true, onchange: (e) => {
      auto = e.target.checked;
      schedule();
    } });

    root.replaceChildren(
      el('div', { class: 'toolbar-line' },
        info,
        el('label', { class: 'switch' }, autoBox, 'atualizar a cada 5s')),
      list,
    );

    async function load({ silent = false } = {}) {
      if (!silent) list.replaceChildren(states.loading(2));
      try {
        const { items } = await api.sessions.list(term);
        ctx.setCount(items.length);
        info.textContent = items.length
          ? `${items.length} sessão(ões)${term ? ` casando com "${term}"` : ''}`
          : '';
        render(items);
      } catch (err) {
        list.replaceChildren(states.error(err, () => load()));
      }
    }

    function render(items) {
      if (!items.length) {
        list.replaceChildren(states.empty(
          term ? 'Nenhuma sessão casa com o filtro' : 'Nenhuma sessão aberta',
          term ? 'Limpe o filtro para ver todas.' : 'Abra o Claude Code em um terminal e atualize.'));
        return;
      }

      list.replaceChildren(...items.map((s) => el('div', { class: 'card row' },
        el('div', { class: 'card-main' },
          el('div', { class: 'card-title' },
            el('span', { class: 'chip accent' }, `PID ${s.pid}`),
            ' ',
            el('span', { class: 'code' }, s.cwd || 'pasta desconhecida'),
            s.kind === 'headless'
              ? el('span', {
                  class: 'chip',
                  title: 'rodando com -p (sem terminal) — é assim que o chat deste painel executa',
                }, 'headless')
              : null),
          el('div', { class: 'meta' },
            el('span', {}, `tty ${s.tty || '—'}`),
            el('span', {}, `ativa há ${s.uptime}`),
            conversaDaSessao(s))),
        el('div', { class: 'actions' },
          el('button', {
            class: 'btn small',
            type: 'button',
            onclick: () => kill(s, 'SIGTERM'),
          }, 'Encerrar')))));
    }

    async function kill(session, signal) {
      const ok = await confirmAction({
        title: `Encerrar PID ${session.pid}?`,
        text: `${signal} será enviado para a sessão em ${session.cwd || '?'} (ativa há ${session.uptime}).`,
        okLabel: 'Encerrar',
      });
      if (!ok) return;

      try {
        const res = await api.sessions.kill(session.pid, signal);
        if (res.alive) {
          toast(`PID ${session.pid} ignorou o ${signal}.`, {
            type: 'err',
            action: { label: 'Forçar SIGKILL', run: () => forceKill(session) },
          });
        } else {
          toast(`Sessão ${session.pid} encerrada.`, { type: 'ok' });
        }
        load({ silent: true });
      } catch (err) {
        toast(err.message, { type: 'err' });
      }
    }

    async function forceKill(session) {
      try {
        const res = await api.sessions.kill(session.pid, 'SIGKILL');
        toast(res.alive ? `PID ${session.pid} não morreu.` : `PID ${session.pid} morto (SIGKILL).`,
          { type: res.alive ? 'err' : 'ok' });
      } catch (err) {
        toast(err.message, { type: 'err' });
      }
      load({ silent: true });
    }

    function schedule() {
      clearInterval(timer);
      if (auto) timer = setInterval(() => load({ silent: true }), 5000);
    }

    load();
    schedule();

    return {
      onSearch(value) { term = value; load(); },
      refresh() { load(); },
      destroy() { clearInterval(timer); },
    };
  },
};
