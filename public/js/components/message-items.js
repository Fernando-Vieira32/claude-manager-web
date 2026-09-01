// Uma mensagem lida do disco -> os BLOCOS dela na tela, na ordem em que aconteceram.
//
// Existe porque uma mensagem não é uma caixa só: é prosa, chamada de ferramenta e agente,
// em sequência. Empilhar tudo numa bolha (o desenho antigo) embrulhava o que o terminal
// mostra separado, perdia a ordem e enterrava um agente de doze minutos no pé de uma
// mensagem já terminada.
//
// Burro: recebe a mensagem (como o serviço a devolve) e callbacks, devolve NÓS. Compõe
// `bubble` e `tool-call` — não conhece api, rota nem painel. **Agente não entra aqui**: ele
// vive na faixa do rodapé (ver o comentário em `render`).
//
//   feed = createFeed({ renderItem: (m) => messageItems(m, { onToggle }) })

import { messageBubble } from './bubble.js';
import { createToolCall } from './tool-call.js';

/**
 * @param {{role:string, at?:string, blocks?:Array<object>, badge?:string}} msg
 * @param {object} [opts]
 * @param {Function} [opts.onToggle] avisa quando um bloco abre/fecha (reajuste de scroll)
 * @returns {Array<Node>} um nó por bloco — o feed achata a lista
 */
export function messageItems(msg = {}, { onToggle } = {}) {
  const { role = 'assistant', at, badge, blocks } = msg;
  // mensagem antiga (ou de outro caminho) sem blocos: continua desenhando como texto
  if (!Array.isArray(blocks)) return [messageBubble(msg)];

  let primeiro = true;
  const nodes = [];
  for (const block of blocks) {
    const node = render(block, { role, at: primeiro ? at : null, badge, onToggle });
    if (!node) continue;
    nodes.push(node);
    primeiro = false;    // só o primeiro bloco leva o cabeçalho com quem falou e quando
  }
  return nodes;
}

function render(block, { role, at, badge, onToggle }) {
  if (block?.kind === 'text') {
    return messageBubble({ role, text: block.text, at, badge });
  }
  if (block?.kind === 'tool') {
    const call = createToolCall({ ...block, onToggle });
    // do disco, o que não tem resultado gravado não fica "executando…" para sempre
    if (block.result) call.setResult(block.result);
    else call.settle();
    return bloco('tool', call.node);
  }
  // AGENTE NÃO ENTRA NA CONVERSA — nem rodando, nem terminado.
  //
  // Decisão do dono em 31/08, olhando a tela: o mesmo agente aparecia com relógio no feed E
  // na faixa do rodapé. A conversa é o fio principal; quando o agente volta, quem interpreta
  // o relatório e responde ali é o Claude principal. O agente vive na faixa
  // (`agent-strip`), que abre e mostra os passos dele. Antes daqui saía um cartão por agente
  // — o porquê da mudança está em readme/10-chat.md.
  return null;
}

/** Um bloco solto na conversa (fora de bolha): é o que o terminal faz. */
const bloco = (tipo, node) => {
  node.classList.add('feed-block', `feed-${tipo}`);
  return node;
};
