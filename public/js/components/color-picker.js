// Paleta de cores: um botão que mostra a cor atual e abre um popover com amostras
// prontas + um seletor livre. Dispara `onChange(cor)` a cada escolha; a string
// vazia '' significa "voltar ao padrão" (sem cor).
//
// Burro e isolado: recebe as amostras e a cor atual por parâmetro; não sabe de
// API, rota nem para que serve a cor. Registra um listener de clique-fora, então
// tem `destroy()` de verdade.
//
//   const cp = createColorPicker({
//     value: '#ff6a45',
//     swatches: ['#ff6a45', '#17c964', '#3b82f6'],
//     onChange: (cor) => salvar(cor),   // cor pode ser '' (padrão)
//   });

import { el } from '../core/ui.js';

/**
 * @param {object} opts
 * @param {string} [opts.value] cor atual (#hex) ou '' para "padrão"
 * @param {string[]} [opts.swatches] amostras prontas (#hex)
 * @param {(color:string) => void} [opts.onChange] chamado a cada escolha ('' = padrão)
 * @param {string} [opts.title] dica do botão
 */
export function createColorPicker({ value = '', swatches = [], onChange, title = 'Cor da janela' } = {}) {
  let current = value || '';

  const dot = el('span', { class: 'cp-dot' });
  const btn = el('button', { class: 'cp-btn icon-btn', type: 'button', title, 'aria-label': title }, dot);

  const grid = el('div', { class: 'cp-grid' },
    ...swatches.map((hex) => el('button', {
      class: 'cp-swatch', type: 'button', title: hex, style: `--sw:${hex}`,
      onclick: () => pick(hex),
    })));
  const custom = el('input', { type: 'color', class: 'cp-custom', title: 'Cor personalizada', 'aria-label': 'Cor personalizada' });
  const clear = el('button', { class: 'cp-clear', type: 'button' }, 'Padrão');
  const pop = el('div', { class: 'cp-pop', hidden: true }, grid, el('div', { class: 'cp-row' }, custom, clear));

  const node = el('span', { class: 'cp' }, btn, pop);

  function paint() {
    dot.style.background = current || 'transparent';
    node.classList.toggle('cp-empty', !current);
  }
  paint();

  function onOutside(e) {
    if (!node.contains(e.target)) setOpen(false);
  }
  function setOpen(open) {
    pop.hidden = !open;
    if (open) {
      if (current) custom.value = current;          // o <input type=color> exige um #hex
      document.addEventListener('mousedown', onOutside);
    } else {
      document.removeEventListener('mousedown', onOutside);
    }
  }

  function pick(hex) {
    current = hex || '';
    paint();
    setOpen(false);
    onChange?.(current);
  }

  btn.addEventListener('click', () => setOpen(pop.hidden));
  custom.addEventListener('change', () => pick(custom.value));
  clear.addEventListener('click', () => pick(''));

  return {
    node,
    value() { return current; },
    set(v) { current = v || ''; paint(); return this; },
    destroy() { document.removeEventListener('mousedown', onOutside); },
  };
}
