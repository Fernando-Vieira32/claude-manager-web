// O lugar dos botões de resposta rápida: um só nó no rodapé que aparece quando a
// última resposta terminou com uma pergunta de opções, e desaparece no envio seguinte.
//
// Saiu do `chat.js` porque é responsabilidade própria — detectar as opções, montar os
// botões, limpar na hora certa e destruir o que registrou. O `chat` só diz "ofereça
// para este texto" e "limpe".

import { el } from '../core/ui.js';
import { createQuickReplies } from './quick-replies.js';
import { detectOptions } from '../core/detect-options.js';

/**
 * @param {object} opts
 * @param {(value:string) => void} opts.onPick escolheu uma opção
 * @param {() => void} [opts.onWrite] preferiu escrever à mão
 * @returns {{node:Node, offer:Function, clear:Function, destroy:Function}}
 */
export function createQuickReplyHost({ onPick, onWrite } = {}) {
  const node = el('div', { class: 'qr-host' });
  let atual = null;

  const api = {
    node,

    /** Nada de opções no texto = nada na tela. Não inventa botão que não existe. */
    offer(text) {
      const options = detectOptions(text);
      if (!options.length) return api;
      atual = createQuickReplies({
        options,
        onPick: (value) => { api.clear(); onPick?.(value); },
        onWrite,
      });
      node.replaceChildren(atual.node);
      return api;
    },

    clear() {
      atual?.destroy();
      atual = null;
      node.replaceChildren();
      return api;
    },

    destroy() { return api.clear(); },
  };

  return api;
}
