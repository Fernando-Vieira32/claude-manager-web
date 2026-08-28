// Uma mensagem lida do disco -> os BLOCOS dela na tela, na ordem em que aconteceram.
//
// Existe porque uma mensagem não é uma caixa só: é prosa, chamada de ferramenta e agente,
// em sequência. Empilhar tudo numa bolha (o desenho antigo) embrulhava o que o terminal
// mostra separado, perdia a ordem e enterrava um agente de doze minutos no pé de uma
// mensagem já terminada.
//
// Burro: recebe a mensagem (como o serviço a devolve) e callbacks, devolve NÓS. Compõe
// `bubble`, `tool-call` e `agent-card` — não conhece api, rota nem painel.
//
//   feed = createFeed({ renderItem: (m) => messageItems(m, { onToggle }) })

import { messageBubble } from './bubble.js';
import { createToolCall } from './tool-call.js';
import { createAgentCard } from './agent-card.js';

/**
 * @param {{role:string, at?:string, blocks?:Array<object>, badge?:string}} msg
 * @param {object} [opts]
 * @param {Function} [opts.onToggle] avisa quando um bloco abre/fecha (reajuste de scroll)
 * @param {(card:object, block:object) => void} [opts.keep] recebe o que tem TIMER (cartão
 *   de agente ainda rodando) e o bloco de origem, para quem monta poder destruí-lo ao
 *   recarregar o feed — nó removido da tela com relógio vivo é vazamento — e colocá-lo na
 *   faixa de "rodando agora"
 * @returns {Array<Node>} um nó por bloco — o feed achata a lista
 */
export function messageItems(msg = {}, { onToggle, keep } = {}) {
  const { role = 'assistant', at, badge, blocks } = msg;
  // mensagem antiga (ou de outro caminho) sem blocos: continua desenhando como texto
  if (!Array.isArray(blocks)) return [messageBubble(msg)];

  let primeiro = true;
  const nodes = [];
  for (const block of blocks) {
    const node = render(block, { role, at: primeiro ? at : null, badge, onToggle, keep });
    if (!node) continue;
    nodes.push(node);
    primeiro = false;    // só o primeiro bloco leva o cabeçalho com quem falou e quando
  }
  return nodes;
}

function render(block, { role, at, badge, onToggle, keep }) {
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
  if (block?.kind === 'agent') {
    const card = createAgentCard({
      name: block.name,
      agentType: block.agentType,
      model: block.model,
      running: Boolean(block.running),
      summary: block.summary || '',
      report: block.report || '',
      durationMs: block.durationMs ?? null,
      startedAt: block.startedAt || null,
      status: block.status || 'completed',
      onToggle,
    });
    // rodando = relógio vivo: quem montou precisa poder pará-lo
    if (card.running) keep?.(card, block);
    return bloco('agent', card.node);
  }
  return null;
}

/** Um bloco solto na conversa (fora de bolha): é o que o terminal faz. */
const bloco = (tipo, node) => {
  node.classList.add('feed-block', `feed-${tipo}`);
  return node;
};
