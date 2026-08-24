// Campo de pasta: mostra o caminho escolhido + um botão que abre o seletor de
// pasta (dir-picker) e guarda a escolha. Compõe o dir-picker; recebe a função
// `browse` por parâmetro, então não importa api.js nem conhece rota.
//
//   const dir = createDirField({ browse: api.fs.browse, value: cwd });
//   bar.append(dir.node);
//   iniciar({ cwd: dir.value() });

import { el } from '../core/ui.js';
import { openDirPicker } from './dir-picker.js';

/**
 * @param {object} opts
 * @param {(path?:string) => Promise<object>} opts.browse alimenta o dir-picker
 * @param {string} [opts.value] caminho inicial
 * @param {(path:string) => void} [opts.onChange]
 */
export function createDirField({ browse, value = '', onChange } = {}) {
  let current = value;
  const label = el('span', { class: 'setup-dir' }, current || '(escolha uma pasta)');
  label.title = current;
  const btn = el('button', { class: 'btn small', type: 'button' }, '📁 Escolher…');

  btn.addEventListener('click', async () => {
    const dir = await openDirPicker({ browse, start: current || undefined });
    if (dir) {
      api.set(dir);
      onChange?.(dir);
    }
  });

  const api = {
    node: el('span', { class: 'setup-dirwrap' }, label, btn),
    value: () => current,
    set(path) {
      current = path || '';
      label.textContent = current || '(escolha uma pasta)';
      label.title = current;
      return api;
    },
    setDisabled(v) { btn.disabled = v; return api; },
    destroy() { /* sem timers/listeners externos */ },
  };

  return api;
}
