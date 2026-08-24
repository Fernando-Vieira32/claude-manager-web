// Etiqueta de procedência: mostra um valor **e** se ele é certeza ou palpite.
//
// Existe porque "este número é palpite" já apareceu em dois lugares do painel (a
// janela de contexto vinda da API x estimada pelo nome do modelo; a conversa de uma
// sessão declarada no comando x deduzida pelo arquivo mais recente). Sem uma peça
// só, cada lugar inventava sua marcação — e o projeto já tomou esse tombo uma vez.
//
// Fábrica de nó, como o `messageBubble`: não guarda estado, não registra listener,
// então não precisa de `destroy()`.
//
//   meta.append(sourceTag({ text: `conversa ${id}`, certain: false, title: 'por quê' }));

import { el } from '../core/ui.js';

/**
 * @param {object} opts
 * @param {string} opts.text o valor em si
 * @param {boolean} [opts.certain=true] false = esmaece e acrescenta o rótulo
 * @param {string} [opts.title] explicação (por que é certeza / por que é palpite)
 * @param {string} [opts.guessLabel='palpite']
 * @returns {Node}
 */
export function sourceTag({ text = '', certain = true, title = '', guessLabel = 'palpite' } = {}) {
  return el('span', {
    class: certain ? 'src-tag' : 'src-tag guess',
    title: title || null,
  }, certain ? text : `${text} (${guessLabel})`);
}
