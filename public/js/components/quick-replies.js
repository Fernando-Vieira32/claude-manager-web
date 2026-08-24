// Respostas rápidas: mostra as opções detectadas na pergunta do Claude como
// botões. Clicar num botão manda aquela opção. Pura apresentação — recebe as
// opções e callbacks, não sabe de API nem de chat. Reutilizável (sugestões no
// editor amanhã).
//
//   const qr = createQuickReplies({
//     options: [{ label:'Sim', value:'Sim' }, { label:'Não', value:'Não' }],
//     onPick: (value) => enviar(value),
//     onWrite: () => composer.focus(),   // "escrever outra"
//   });
//   host.append(qr.node);

import { el } from '../core/ui.js';

/**
 * @param {object} opts
 * @param {Array<{label:string,value:string,full?:string}>} opts.options
 * @param {(value:string) => void} opts.onPick
 * @param {() => void} [opts.onWrite] mostra "escrever outra" que foca a caixa
 */
export function createQuickReplies({ options = [], onPick, onWrite } = {}) {
  const buttons = options.map((o, i) => {
    const btn = el('button', {
      class: 'qr-btn', type: 'button', title: o.full || o.label,
      style: `--i:${i}`,
    }, o.label);
    btn.addEventListener('click', () => onPick?.(o.value));
    return btn;
  });

  const write = onWrite
    ? (() => {
        const b = el('button', { class: 'qr-btn qr-write', type: 'button', style: `--i:${options.length}` },
          '✎ escrever outra');
        b.addEventListener('click', () => onWrite());
        return b;
      })()
    : null;

  const node = el('div', { class: 'qr' },
    el('span', { class: 'qr-cue' }, '💬 sugestões'),
    el('div', { class: 'qr-opts' }, ...buttons, write));

  return {
    node,
    destroy() { /* listeners morrem com os nós */ },
  };
}
