// Medidor de contexto: quanto do "cérebro" da conversa já está ocupado, com um
// botão de compactar. Genérico — recebe números e um callback, não sabe de API.
//
//   const meter = createContextMeter({ onCompact: () => compactar() });
//   footer.prepend(meter.node);
//   meter.set({ tokens: 230000, window: 1_000_000 });
//
// Compactar é uma operação OPACA (o /compact não reporta progresso), então
// enquanto roda mostramos atividade viva + tempo em vez de uma % falsa, e ao
// terminar o próprio `set()` com o novo total já revela o quanto caiu.

import { el, fmt } from '../core/ui.js';
import { createActivity } from './activity.js';

/**
 * @param {object} opts
 * @param {() => void} [opts.onCompact] se existir, mostra o botão "Compactar"
 * @param {number} [opts.warnAt=0.75] fração a partir da qual a barra fica de alerta
 */
export function createContextMeter({ onCompact, warnAt = 0.75 } = {}) {
  const label = el('span', { class: 'ctx-label' }, 'contexto —');
  const fill = el('span', { class: 'ctx-fill' });
  const bar = el('span', { class: 'ctx-bar' }, fill);
  const activity = createActivity({ label: 'Compactando…', bar: true });
  activity.node.hidden = true;

  const compactBtn = onCompact
    ? el('button', { class: 'btn small', type: 'button', title: 'Resumir o histórico e liberar contexto (/compact)' },
        '⤢ Compactar')
    : null;
  if (compactBtn) compactBtn.addEventListener('click', () => onCompact());

  const node = el('div', { class: 'ctx-meter' }, label, bar, activity.node, compactBtn);

  let lastTokens = null;

  const api = {
    node,

    /** @param {{tokens:number|null, window:number|null, note?:string}} state */
    set({ tokens, window, note } = {}) {
      lastTokens = tokens;
      if (tokens == null) {
        label.textContent = note ? `contexto — · ${note}` : 'contexto —';
        fill.style.width = '0%';
        bar.hidden = true;
        return api;
      }
      // Sem janela conhecida não há porcentagem honesta: mostra o total e para.
      // (Antes caía num `|| 200_000` fixo, que desenhava uma barra inventada.)
      const win = Number.isFinite(window) && window > 0 ? window : null;
      if (!win) {
        bar.hidden = true;
        label.textContent = `contexto ${fmt.compact(tokens)}${note ? ` · ${note}` : ''}`;
        return api;
      }

      bar.hidden = false;
      const frac = Math.min(tokens / win, 1);
      fill.style.width = `${Math.max(frac * 100, 2)}%`;
      bar.classList.toggle('warn', frac >= warnAt);
      bar.title = `${tokens.toLocaleString('pt-BR')} de ~${fmt.compact(win)} tokens (${Math.round(frac * 100)}%)`;
      label.textContent = `contexto ${fmt.compact(tokens)} / ${fmt.compact(win)}${note ? ` · ${note}` : ''}`;
      return api;
    },

    /** Tokens do último `set()` — para quem quiser calcular o "antes/depois". */
    tokens() { return lastTokens; },

    /** Liga/desliga o estado "compactando": troca a barra estática pela atividade. */
    setBusy(value, text) {
      const on = !!value;
      label.hidden = on;
      bar.hidden = on ? true : lastTokens == null;
      activity.node.hidden = !on;
      if (on) activity.start(text || 'Compactando…');
      else activity.stop();
      if (compactBtn) {
        compactBtn.disabled = on;
        compactBtn.textContent = on ? (text || 'Compactando…') : '⤢ Compactar';
      }
      return api;
    },

    /** Obrigatório: a atividade tem um timer que precisa ser liberado. */
    destroy() { activity.destroy(); },
  };

  return api;
}
