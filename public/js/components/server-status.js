// server-status: indicador vivo do estado do servidor + controles.
//
// Verde = no ar, vermelho = fora, âmbar = aguarde (reiniciando). Componente burro:
// não sabe de rota nem de api.js; recebe callbacks e é atualizado via set(estado).
// Quem monta (app.js) faz o ping de saúde e chama set('up'|'down'|'wait').
//
// Nota honesta: quando está fora, a página NÃO consegue religar o servidor (o
// navegador não abre programas do PC). Por isso, no estado 'down', o controle vira
// "ligar" que apenas dispara onStart — quem monta trata (ex.: copiar o comando).

import { el } from '../core/ui.js';

const LABEL = { up: 'servidor no ar', down: 'servidor fora', wait: 'reiniciando…' };

export function createServerStatus({ onRestart, onStop, onStart } = {}) {
  const dot = el('span', { class: 'dot' });
  const label = el('span', { class: 'srv-label' });

  const restartBtn = el('button', { class: 'srv-btn', type: 'button', title: 'Reiniciar o servidor' }, '↻');
  const stopBtn = el('button', { class: 'srv-btn srv-danger', type: 'button', title: 'Desligar o servidor' }, '⏻');
  const startBtn = el('button', { class: 'srv-btn srv-start', type: 'button', title: 'Como ligar o servidor' }, '▶ ligar');

  restartBtn.addEventListener('click', () => onRestart?.());
  stopBtn.addEventListener('click', () => onStop?.());
  startBtn.addEventListener('click', () => onStart?.());

  const upActions = el('div', { class: 'srv-actions' }, restartBtn, stopBtn);
  const node = el('div', { class: 'srv' }, dot, label, upActions, startBtn);

  /** state: 'up' | 'down' | 'wait' — encadeável (return api). */
  function set(state) {
    dot.className = `dot ${state === 'up' ? 'on' : state === 'down' ? 'off' : 'wait'}`;
    label.textContent = LABEL[state] || LABEL.wait;
    node.dataset.state = state;
    const busy = state !== 'up';
    restartBtn.disabled = busy;
    stopBtn.disabled = busy;
    return api;
  }

  const api = { node, set, destroy() { /* listeners morrem com os nós */ } };
  return set('wait');
}
