// Indicador de "algo está acontecendo agora" — bolinha pulsando + rótulo + tempo
// decorrido, com barra indeterminada opcional. Genérico de propósito: não sabe O
// QUE está acontecendo, só mostra que está e há quanto tempo.
//
// Serve para qualquer operação de duração desconhecida cujo progresso não dá para
// medir: o Claude pensando no chat, o /compact rodando, um deploy depois. Quando
// não dá para mostrar "quantos %", mostrar "está vivo e faz Ns" é a próxima melhor
// coisa — e é honesto.
//
//   const act = createActivity({ label: 'pensando…' });
//   who.append(act.node);
//   act.start();                 // começa a contar
//   act.label('escrevendo…');    // troca o texto sem zerar o relógio
//   act.stop();                  // para (e libera o timer) — sempre no fim

import { el } from '../core/ui.js';

/** 8 -> "8s"; 75 -> "1m 15s". */
function elapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * @param {object} opts
 * @param {string} [opts.label='trabalhando…'] texto inicial
 * @param {boolean} [opts.bar=false] mostra a barra indeterminada (para rodapés)
 */
export function createActivity({ label = 'trabalhando…', bar = false, startedAt: desde = null } = {}) {
  const dot = el('span', { class: 'activity-dot' });
  const labelNode = el('span', { class: 'activity-label' }, label);
  const timeNode = el('span', { class: 'activity-time' }, '');
  const barNode = bar
    ? el('span', { class: 'activity-bar' }, el('span', { class: 'activity-bar-fill' }))
    : null;
  const node = el('span', { class: `activity${bar ? ' has-bar' : ''}` },
    dot, labelNode, timeNode, barNode);

  let timer = null;
  let inicio = desde || 0;

  const tick = () => { timeNode.textContent = elapsed(Date.now() - inicio); };

  const api = {
    node,

    /**
     * (Re)inicia o relógio e a animação. `text` opcional troca o rótulo.
     *
     * `opts.startedAt` (ou o do construtor) faz o relógio contar de um começo que NÃO é
     * agora — é como um indicador novo mostra o tempo do TURNO, e não o seu próprio: o
     * turno continua o mesmo quando a bolha viva é trocada por causa de um bloco novo.
     */
    start(text, { startedAt = inicio || desde } = {}) {
      if (text) labelNode.textContent = text;
      node.classList.remove('done');
      inicio = startedAt || Date.now();
      tick();
      if (!timer) timer = setInterval(tick, 1000);
      return api;
    },

    /** Troca o texto sem mexer no relógio (ex.: "pensando…" → "escrevendo…"). */
    label(text) { labelNode.textContent = text; return api; },

    /** Para o relógio e a animação. `text` opcional deixa um rótulo final. */
    stop(text) {
      if (timer) { clearInterval(timer); timer = null; }
      if (text != null) labelNode.textContent = text;
      node.classList.add('done');
      return api;
    },

    /** Obrigatório se o nó puder sumir enquanto ainda roda (fecha o drawer). */
    destroy() { if (timer) { clearInterval(timer); timer = null; } },
  };

  return api;
}
