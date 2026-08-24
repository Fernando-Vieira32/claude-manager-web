// Bolhas de mensagem — a unidade visual de qualquer conversa na interface.
// Não conhece API nem painel: recebe dados e devolve nós.

import { el, fmt } from '../core/ui.js';
import { createActivity } from './activity.js';
import { createToolCall } from './tool-call.js';

const WHO = { user: 'você', assistant: 'claude', system: 'sistema' };

/**
 * Bolha estática de uma mensagem já conhecida.
 * @param {{role?:string, text?:string, at?:string, who?:string, badge?:string, images?:string[]}} msg
 *        images: URLs (data:...) para miniatura das imagens enviadas.
 */
export function messageBubble({ role = 'assistant', text = '', at, who, badge, images } = {}) {
  return el('div', { class: `msg ${role}` },
    el('div', { class: 'who' },
      `${who || WHO[role] || role}${at ? ` · ${fmt.when(at)}` : ''}`,
      badge ? el('span', { class: 'chip' }, badge) : null),
    images && images.length
      ? el('div', { class: 'msg-imgs' }, ...images.map((src) => el('img', { class: 'msg-img', src, alt: 'imagem enviada' })))
      : null,
    text ? el('pre', {}, text) : null);
}

/**
 * Bolha que cresce em tempo real (streaming de texto, ferramentas, avisos).
 * Devolve controles em vez de um nó "cru", para quem escuta um stream apenas
 * chamar append/setActivity/setError sem tocar no DOM.
 *
 * O cabeçalho tem três coisas independentes: a ATIVIDADE (indicador vivo do que
 * está acontecendo agora), o CHIP DE MODELO e, ao terminar, o RESUMO. Antes o
 * modelo substituía o indicador e dava a impressão de que nada estava rodando.
 */
export function streamBubble({ role = 'assistant', who, label = 'pensando…' } = {}) {
  const pre = el('pre', {}, '');
  const activity = createActivity({ label });
  const model = el('span', { class: 'chip accent', hidden: true });
  const summary = el('span', { class: 'chip ok', hidden: true });
  const extras = el('div', { class: 'bubble-extras' });
  const node = el('div', { class: `msg ${role} streaming` },
    el('div', { class: 'who' }, who || WHO[role] || role, activity.node, model, summary),
    pre,
    extras);

  activity.start();
  let buffer = '';
  let done = false;
  const tools = new Map();   // id do tool_use -> tool-call, para casar o resultado
  const pendentes = [];      // todas as chamadas, para resolver e destruir no fim

  const api = {
    node,
    text: () => buffer,

    append(chunk) {
      buffer += chunk;
      pre.textContent = buffer;
      return api;
    },

    setText(value) {
      buffer = value;
      pre.textContent = buffer;
      return api;
    },

    /** Troca o rótulo do indicador vivo ("pensando…" → "escrevendo…"). */
    setActivity(text) {
      activity.label(text);
      return api;
    },

    /**
     * Registra uso de ferramenta. Compõe o `tool-call`, que é clicável e mostra o
     * que foi pedido e o que voltou — inclusive de um subagente.
     */
    addTool(name, { id, input, inputTruncated, onToggle } = {}) {
      const call = createToolCall({ name, input, inputTruncated, onToggle });
      if (id) tools.set(id, call);
      pendentes.push(call);
      extras.append(call.node);
      return api;
    },

    /** Casa o resultado com a chamada pelo id do `tool_use`. */
    setToolResult(id, payload) {
      tools.get(id)?.setResult(payload);
      return api;
    },

    addNotice(message) {
      extras.append(el('span', { class: 'chip warn' }, message));
      return api;
    },

    /** Chip de metadado ao lado do indicador (hoje: o modelo escolhido). */
    setStatus(textValue, kind = 'accent') {
      model.className = `chip ${kind}`;
      model.textContent = textValue;
      model.hidden = !textValue;
      return api;
    },

    setError(message) {
      done = true;
      node.classList.remove('streaming');
      node.classList.add('error');
      pendentes.forEach((c) => c.settle());
      activity.stop();
      activity.node.hidden = true;
      summary.className = 'chip warn';
      summary.textContent = 'erro';
      summary.hidden = false;
      extras.append(el('span', { class: 'chip warn' }, message));
      return api;
    },

    /** Encerra o estado "trabalhando": para o indicador e mostra um resumo. */
    finish(text) {
      if (done) return api;
      done = true;
      node.classList.remove('streaming');
      // ferramenta sem resultado no stream não fica "executando…" para sempre
      pendentes.forEach((c) => c.settle());
      activity.stop();
      activity.node.hidden = true;
      if (text) {
        summary.textContent = text;
        summary.hidden = false;
      }
      if (!buffer.trim() && !extras.childNodes.length) pre.textContent = '(sem texto)';
      return api;
    },

    /** Obrigatório: a bolha pode sumir com o stream ainda vivo (drawer fechado). */
    destroy() {
      pendentes.forEach((c) => c.destroy());
      activity.destroy();
    },
  };

  return api;
}
