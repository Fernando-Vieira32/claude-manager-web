// Bolhas de mensagem — a unidade visual de qualquer conversa na interface.
// Não conhece API nem painel: recebe dados e devolve nós.

import { el, fmt } from '../core/ui.js';
import { createActivity } from './activity.js';
import { createMarkdownText } from './markdown-text.js';

const WHO = { user: 'você', assistant: 'claude', system: 'sistema' };

/**
 * O corpo de uma bolha. **O Claude responde em markdown** — mostrar `**Criados**`, ``` e
 * `|---|` na cara de quem lê é jogar para o leitor um trabalho que é da tela.
 *
 * Só o que o CLAUDE escreve é formatado. O que VOCÊ digitou aparece como digitado: se você
 * mandou `**` literal ou uma linha começando com `-`, reformatar mudaria a sua mensagem na
 * tela — e "o que eu mandei" é o único texto aqui que não pode ser reinterpretado.
 *
 * `fromCli` é a exceção medida: a saída de um comando local (`/context`, `/cost`) é gravada
 * como turno do USUÁRIO, mas foi o CLI que a escreveu — e em markdown. Quem prova isso é o
 * serviço (`isMeta` do transcript), não um palpite pelo formato do texto.
 *
 * @returns {{node:Node, setText:Function, flush:Function, destroy:Function}} sempre a mesma
 *   forma, então quem usa a bolha não precisa saber qual dos dois caminhos caiu.
 */
function bodyOf(role, text = '', fromCli = false) {
  if (role === 'assistant' || fromCli) return createMarkdownText({ text });
  const node = el('pre', {}, text);
  return { node, setText(v) { node.textContent = v; }, flush() {}, destroy() {} };
}

/**
 * Bolha estática de uma mensagem já conhecida — **só o texto** (e imagens).
 *
 * Ferramenta e agente NÃO entram aqui: cada um é um bloco próprio na conversa
 * ([`message-items`](message-items.js)). Antes eles vinham empilhados no pé da bolha, o
 * que embrulhava tudo numa caixa só, perdia a ordem em que as coisas aconteceram e
 * enterrava um agente de doze minutos dentro de uma mensagem já terminada.
 *
 * Nó cru, sem `destroy`: o corpo desenha na hora e não deixa nada agendado. Quem cresce em
 * tempo real é a `streamBubble`, e essa tem `destroy`.
 *
 * @param {{role?:string, text?:string, at?:string, who?:string, badge?:string,
 *          images?:string[], fromCli?:boolean}} msg
 */
export function messageBubble({ role = 'assistant', text = '', at, who, badge, images, fromCli } = {}) {
  return el('div', { class: `msg ${role}` },
    el('div', { class: 'who' },
      `${who || WHO[role] || role}${at ? ` · ${fmt.when(at)}` : ''}`,
      badge ? el('span', { class: 'chip bubble-badge' }, badge) : null),
    images && images.length
      ? el('div', { class: 'msg-imgs' }, ...images.map((src) => el('img', { class: 'msg-img', src, alt: 'imagem enviada' })))
      : null,
    text ? bodyOf(role, text, fromCli).node : null);
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
export function streamBubble({ role = 'assistant', who, label = 'pensando…', startedAt = null } = {}) {
  const corpo = bodyOf(role);
  const activity = createActivity({ label, startedAt });
  const model = el('span', { class: 'chip accent', hidden: true });
  const summary = el('span', { class: 'chip ok', hidden: true });
  const extras = el('div', { class: 'bubble-extras' });   // só avisos (chips) agora
  const node = el('div', { class: `msg ${role} streaming` },
    el('div', { class: 'who' }, who || WHO[role] || role, activity.node, model, summary),
    corpo.node,
    extras);

  activity.start();
  let buffer = '';
  let done = false;
  let failed = false;

  const api = {
    node,
    text: () => buffer,
    /**
     * Terminou em erro? Quem manda a resposta precisa saber para NÃO recarregar o
     * feed em cima da bolha — recarregar apaga a explicação do erro e sobra uma tela
     * vazia sem nenhuma pista (foi bug de verdade).
     */
    get failed() { return failed; },

    append(chunk) {
      buffer += chunk;
      corpo.setText(buffer);
      return api;
    },

    setText(value) {
      buffer = value;
      corpo.setText(buffer);
      return api;
    },

    /** Troca o rótulo do indicador vivo ("pensando…" → "escrevendo…"). */
    setActivity(text) {
      activity.label(text);
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
      failed = true;
      node.classList.remove('streaming');
      node.classList.add('error');
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
      activity.stop();
      activity.node.hidden = true;
      if (text) {
        summary.textContent = text;
        summary.hidden = false;
      }
      if (!buffer.trim() && !extras.childNodes.length) corpo.setText('(sem texto)');
      // desenha o que ainda estava agendado: terminar com o último pedaço faltando na tela
      // seria o mesmo bug de "resposta apagada" por outro caminho
      corpo.flush();
      return api;
    },

    /** Obrigatório: a bolha pode sumir com o stream ainda vivo (drawer fechado). */
    destroy() {
      activity.destroy();
      corpo.destroy();
    },

    /** Tem algo escrito? Bolha viva que ficou vazia sai do feed em vez de virar "(sem texto)". */
    get empty() { return !buffer.trim() && !extras.childNodes.length; },
  };

  return api;
}
