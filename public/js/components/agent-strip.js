// Os agentes em segundo plano de UMA conversa: a faixa de "rodando agora" (como o painel
// fixo no pé do terminal) **e** o registro de quem é o cartão de cada um.
//
// Os dois juntos porque o problema é o mesmo: um agente nasce num turno e volta em OUTRO,
// dez minutos depois. Se cada resposta tivesse o seu registro, o aviso de fim chegaria
// numa resposta que nunca viu o disparo — o cartão original ficaria "rodando…" para
// sempre e o relatório apareceria duplicado num cartão solto.
//
// Burra: recebe dados/callbacks, compõe `activity` (relógio vivo) e some quando vazia.
//
//   const agentes = createAgentStrip({ onPick: () => feed.scrollToEnd() });
//   agentes.track({ id, name, agentType, card });   // entrou: faixa + registro
//   agentes.end(id, { summary, result, status });    // voltou: encerra o cartão e sai
//   agentes.destroy();                               // tem timer: sempre

import { el } from '../core/ui.js';
import { createActivity } from './activity.js';

/**
 * @param {object} [opts]
 * @param {(id:string) => void} [opts.onPick] clique numa linha (ex.: rolar até o cartão)
 */
export function createAgentStrip({ onPick } = {}) {
  const titulo = el('span', { class: 'agents-title' }, '');
  const lista = el('div', { class: 'agents-list' });
  const node = el('div', { class: 'agents-strip', hidden: true }, titulo, lista);

  const vivos = new Map();   // id do disparo -> { row, activity, card }
  const porAgente = new Map();  // id ESTÁVEL do agente -> id do disparo

  const pintar = () => {
    const n = vivos.size;
    node.hidden = n === 0;
    titulo.textContent = n === 1 ? '1 agente em segundo plano' : `${n} agentes em segundo plano`;
  };

  /** Tira da faixa (o cartão continua na conversa, é o histórico). */
  function soltar(id, { destruir = false } = {}) {
    const item = vivos.get(id);
    if (!item) return false;
    item.activity.destroy();
    item.row.remove();
    if (destruir) item.card?.destroy?.();
    vivos.delete(id);
    pintar();
    return true;
  }

  const api = {
    node,
    get size() { return vivos.size; },
    /** Quem está rodando agora — para quem precisa decidir com base nisso. */
    ids: () => [...vivos.keys()],
    has: (id) => vivos.has(id),

    /**
     * Liga o id ESTÁVEL do agente ao disparo dele. O aviso de fim casa por esse id — e num
     * agente RETOMADO ele vem com o id da chamada que o retomou, que não é o do disparo.
     * Sem esse laço, o relatório de doze minutos não achava dono.
     */
    alias(agentId, id) {
      if (agentId && vivos.has(id)) porAgente.set(agentId, id);
      return api;
    },

    /**
     * Registra um agente que começou. `card` é o cartão dele na conversa (opcional): é
     * por ele que o aviso de fim, que pode chegar muito depois, acha onde escrever.
     */
    track({ id, name = 'agente', agentType = '', card = null, startedAt = null } = {}) {
      if (!id) return api;
      const jaTem = vivos.get(id);
      if (jaTem) {
        // já estava na faixa sem cartão (veio do resumo da conversa) e agora o bloco dele
        // foi desenhado: liga os dois, senão o aviso de fim não teria onde escrever
        if (!jaTem.card && card) jaTem.card = card;
        return api;
      }
      const activity = createActivity({ label: '', startedAt: emMs(startedAt) });
      const row = el('button', { class: 'agents-row', type: 'button', title: name },
        el('span', { class: 'agents-name' }, name),
        agentType ? el('span', { class: 'chip agent-type' }, agentType) : null,
        activity.node);
      if (onPick) row.addEventListener('click', () => onPick(id));
      activity.start();
      lista.append(row);
      vivos.set(id, { row, activity, card });
      pintar();
      return api;
    },

    /**
     * O agente voltou: encerra o cartão dele e sai da faixa.
     * @returns {boolean} achamos o agente? `false` = ele começou antes desta tela existir,
     *   e quem chamou decide o que fazer com o relatório (não jogar fora).
     */
    end(id, fim = {}, agentId = null) {
      const alvo = vivos.has(id) ? id : porAgente.get(agentId);
      if (!alvo) return false;
      vivos.get(alvo)?.card?.finish?.(fim);
      porAgente.delete(agentId);
      return soltar(alvo);
    },

    /** Esvazia a faixa (ex.: o feed vai ser redesenhado do disco). */
    clear({ destruir = false } = {}) {
      for (const id of [...vivos.keys()]) soltar(id, { destruir });
      porAgente.clear();
      return api;
    },

    /** Obrigatório: cada linha tem um relógio, e os cartões registrados também. */
    destroy() {
      api.clear({ destruir: true });
      return api;
    },
  };

  return api;
}

/** ISO ou ms -> ms; nada reconhecível vira `null` (o relógio começa agora). */
function emMs(valor) {
  if (!valor) return null;
  const ms = typeof valor === 'number' ? valor : Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}
