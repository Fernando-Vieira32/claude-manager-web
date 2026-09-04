// Os PASSOS de um agente — o "o que ele está fazendo".
//
// Existe porque abrir um agente mostrava só "relatório: trabalhando…". O trabalho dele está
// gravado num arquivo próprio (ver `services/conversations/subagent.js`), no mesmo formato
// das conversas — então quem desenha conversa desenha isto: `message-items`, os mesmos
// blocos de texto e de ferramenta. Nenhum componente novo de desenho.
//
// Duas peças, porque os passos aparecem em DOIS lugares (o cartão na conversa e a linha da
// faixa do rodapé) e a lógica de "abre, busca uma vez, avisa se falhou" não pode ser escrita
// duas vezes:
//
//   const passos = createAgentSteps({ fetch: (ref) => api.conversations.agentSteps(id, ref) });
//   const caixa = createStepsBox({ ref, onOpen: passos });   // a caixa que abre e se enche
//
// Burro do jeito de sempre: recebe COMO buscar por parâmetro, não conhece api nem rota.

import { el } from '../core/ui.js';
import { messageItems } from './message-items.js';

/**
 * @param {object} opts
 * @param {(ref:string) => Promise<{messages?:Array, total?:number, from?:number}>} opts.fetch
 * @returns {(ref:string, alvo:{addChild:Function}) => Promise<number>} quantos passos entraram
 */
export function createAgentSteps({ fetch } = {}) {
  return async function carregar(ref, alvo) {
    if (!fetch) throw new Error('esta tela não sabe buscar passos de agente');
    const page = await fetch(ref);
    const msgs = page?.messages || [];

    // veio cortado pelo teto? dizer isso é obrigatório — mostrar 400 de 900 calado seria
    // deixar a pessoa achar que ele fez só isso
    if (page?.from > 0) {
      alvo.addChild(nota(`· mostrando os últimos ${msgs.length} de ${page.total} passos ·`));
    }
    for (const msg of msgs) {
      for (const node of messageItems(msg)) alvo.addChild(node);
    }
    return msgs.length;
  };
}

/**
 * A caixa onde os passos aparecem: escondida até você abrir, e a busca acontece **na
 * primeira abertura** — transcrito de agente passa de 800 KB, e pré-carregar isso para cada
 * agente da tela seria absurdo. Falhou? A próxima abertura tenta de novo e o motivo fica no
 * lugar dos passos.
 *
 * @param {object} opts
 * @param {string} [opts.ref] por qual id se pedem os passos (o id do DISPARO do agente)
 * @param {(ref:string, alvo:object) => Promise<number>} [opts.onOpen] quem busca
 * @param {string} [opts.label] título do bloco
 * @returns {{node:Node, addChild:Function, load:Function, get vazia:boolean}}
 */
export function createStepsBox({ ref = null, onOpen, label = 'passos' } = {}) {
  const aviso = el('span', { class: 'tool-none', hidden: true });
  const lista = el('div', { class: 'agent-kids' });
  const node = el('div', { class: 'tool-block', hidden: true },
    el('span', { class: 'tool-key' }, label), aviso, lista);

  let buscou = false;
  let quantos = 0;

  const dizer = (texto) => {
    node.hidden = false;
    aviso.hidden = false;
    aviso.textContent = texto;
  };

  const api = {
    node,
    get vazia() { return quantos === 0; },

    /** Um passo (nó já montado). Serve também para o que chega ao vivo, pelo stream. */
    addChild(child) {
      if (!child) return api;
      quantos += 1;
      node.hidden = false;
      lista.append(child);
      return api;
    },

    /** Busca os passos, se ainda não buscou. Idempotente e sem exceção para fora. */
    async load() {
      if (buscou || !onOpen) return api;
      if (!ref) {
        dizer('não sei por qual id pedir os passos deste agente');
        return api;
      }
      buscou = true;
      dizer('buscando o que ele fez…');
      try {
        const n = await onOpen(ref, api);
        if (n) aviso.hidden = true;
        else dizer('ele ainda não escreveu nada');
      } catch (err) {
        buscou = false;
        dizer(`não deu para ler os passos: ${err?.message || err}`);
      }
      return api;
    },
  };

  return api;
}

/** Uma linha de aviso no meio dos passos (mesmo tom do rodapé do feed). */
const nota = (texto) => el('div', { class: 'agent-steps-note' }, texto);
