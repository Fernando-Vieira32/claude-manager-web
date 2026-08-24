// Seletor de pasta: um modal que navega o disco do servidor e devolve o caminho
// escolhido. Desacoplado — recebe a função `browse` por parâmetro (não importa
// api.js nem conhece rota). Reaproveitável em qualquer "escolher onde": iniciar
// uma conversa hoje, "abrir pasta" no editor amanhã.
//
//   const dir = await openDirPicker({ start: '/home/eu', browse: api.fs.browse });
//   if (dir) usar(dir);   // null = cancelou

import { el } from '../core/ui.js';

/**
 * @param {object} opts
 * @param {(path?:string) => Promise<{path,parent,home,entries:Array<{name,path}>}>} opts.browse
 * @param {string} [opts.start] caminho inicial (vazio = HOME do servidor)
 * @param {string} [opts.title]
 * @returns {Promise<string|null>} caminho escolhido, ou null se cancelar
 */
export function openDirPicker({ browse, start, title = 'Escolher pasta' } = {}) {
  return new Promise((resolve) => {
    let current = null;
    let home = null;

    const crumb = el('span', { class: 'dp-path' }, '…');
    const list = el('div', { class: 'dp-list' });
    const upBtn = el('button', { class: 'btn small', type: 'button' }, '↑ acima');
    const homeBtn = el('button', { class: 'btn small', type: 'button' }, '⌂ início');
    const okBtn = el('button', { class: 'btn primary', type: 'button' }, 'Selecionar esta pasta');

    const overlay = el('div', { class: 'dp-overlay' },
      el('div', { class: 'dp-backdrop' }),
      el('div', { class: 'dp-card', role: 'dialog', 'aria-modal': 'true' },
        el('div', { class: 'dp-head' },
          el('strong', {}, title),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar' }, '✕')),
        el('div', { class: 'dp-bar' }, upBtn, homeBtn, crumb),
        list,
        el('div', { class: 'dp-foot' },
          el('button', { class: 'btn', type: 'button' }, 'Cancelar'),
          okBtn)));

    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };

    overlay.querySelector('.dp-backdrop').addEventListener('click', () => close(null));
    overlay.querySelector('.dp-head .icon-btn').addEventListener('click', () => close(null));
    overlay.querySelector('.dp-foot .btn:not(.primary)').addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => close(current));
    upBtn.addEventListener('click', () => { if (parent()) load(parent()); });
    homeBtn.addEventListener('click', () => load(home || undefined));

    let parentPath = null;
    const parent = () => parentPath;

    async function load(target) {
      list.replaceChildren(el('div', { class: 'dp-empty' }, 'carregando…'));
      try {
        const data = await browse(target);
        current = data.path;
        parentPath = data.parent;
        home = data.home;
        crumb.textContent = data.path;
        crumb.title = data.path;
        upBtn.disabled = !data.parent;

        if (!data.entries.length) {
          list.replaceChildren(el('div', { class: 'dp-empty' }, '(sem subpastas aqui)'));
          return;
        }
        list.replaceChildren(...data.entries.map((entry) =>
          el('button', { class: 'dp-item', type: 'button', title: entry.path, onclick: () => load(entry.path) },
            el('span', { class: 'dp-ico' }, '📁'),
            el('span', {}, entry.name))));
      } catch (err) {
        list.replaceChildren(el('div', { class: 'dp-empty' }, `falhou: ${err.message || err}`));
      }
    }

    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    load(start || undefined);
  });
}
