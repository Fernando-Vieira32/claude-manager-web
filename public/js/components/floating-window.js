// Janela flutuante: arrastável (pelo cabeçalho), redimensionável e NÃO-modal —
// dá para abrir várias e continuar usando o resto da página por baixo. É a base
// para "abrir várias conversas ao mesmo tempo" e, no futuro, abas do editor.
//
// Desacoplado: recebe título e um onClose; o conteúdo é montado em `bodyEl`/`footEl`.
//
//   const win = createFloatingWindow({ title: 'Conversa', onClose: () => limpar() });
//   win.bodyEl.append(chat.node);
//   win.setFooter(chat.footer);
//   win.focus();

import { el } from '../core/ui.js';

let zTop = 100;

/** Host único das janelas: fixo, sem capturar cliques (só as janelas capturam). */
function windowsHost() {
  let host = document.getElementById('windows');
  if (!host) {
    host = el('div', { id: 'windows', class: 'windows' });
    document.body.append(host);
  }
  return host;
}

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.subtitle]
 * @param {Node[]} [opts.actions] controles extras no cabeçalho (antes do fechar)
 * @param {() => void} [opts.onClose]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 */
export function createFloatingWindow({ title = '', subtitle = '', actions = [], onClose, width = 720, height = 560 } = {}) {
  const host = windowsHost();
  const titleEl = el('h2', {}, title);
  const subEl = el('p', {}, subtitle);
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar' }, '✕');
  const actionsEl = el('div', { class: 'fw-actions' }, ...actions, closeBtn);
  const header = el('div', { class: 'fw-head' }, el('div', { class: 'fw-titles' }, titleEl, subEl), actionsEl);

  const bodyEl = el('div', { class: 'fw-body' });
  const footEl = el('div', { class: 'fw-foot', hidden: true });
  const node = el('div', { class: 'fw', role: 'dialog' }, header, bodyEl, footEl);

  // tamanho inicial e posição escalonada (para não empilharem exatamente iguais).
  // Começa à direita da barra lateral para não cobrir o menu (senão não dá para
  // trocar de painel) — o usuário pode arrastar para onde quiser depois.
  const step = (host.children.length % 6) * 30;
  const baseLeft = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim();
  const left0 = (parseInt(baseLeft, 10) || 230) + 24;
  node.style.width = `${width}px`;
  node.style.height = `${height}px`;
  node.style.left = `${Math.min(window.innerWidth - 120, left0 + step)}px`;
  node.style.top = `${Math.max(12, 64 + step)}px`;

  const focus = () => { node.style.zIndex = String(++zTop); };
  node.addEventListener('mousedown', focus);

  // arrastar pelo cabeçalho (menos a área de ações: fechar, seletor de cor, etc.)
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.fw-actions')) return;
    e.preventDefault();
    const rect = node.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev) => {
      node.style.left = `${Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx))}px`;
      node.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    node.remove();
    onClose?.();
  }
  closeBtn.addEventListener('click', close);

  host.append(node);
  focus();

  return {
    node,
    bodyEl,
    footEl,
    /** elemento que rola (para o feed do chat). */
    scroller: () => bodyEl,
    setTitle(t) { titleEl.textContent = t || ''; return this; },
    setSubtitle(t) { subEl.textContent = t || ''; return this; },
    /** Tinge a janela com uma cor (borda + cabeçalho). '' remove o realce. */
    setAccent(color) {
      if (color) {
        node.style.setProperty('--fw-accent', color);
        node.classList.add('fw-tinted');
      } else {
        node.style.removeProperty('--fw-accent');
        node.classList.remove('fw-tinted');
      }
      return this;
    },
    setFooter(nodes) {
      footEl.replaceChildren(...[nodes].flat().filter(Boolean));
      footEl.hidden = footEl.childNodes.length === 0;
      return this;
    },
    focus() { focus(); return this; },
    close,
  };
}
