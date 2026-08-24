// Vista de conversa: histórico paginado (feed) + caixa de escrever (composer) +
// consumo de um stream de resposta.
//
// É o componente que junta as peças, e continua sem saber DE QUEM vêm os dados:
// recebe `fetchPage` (histórico) e `send` (transporte do stream). Hoje é ligado ao
// serviço de conversas + chat; amanhã serve para o editor conversar sobre um
// arquivo, ou para um agente qualquer.
//
// Contrato dos eventos que `send` deve entregar a `onEvent` (é o que o
// /api/chat emite):
//   { type:'init',    sessionId, cwd, mode }       começou
//   { type:'system',  model }                      modelo escolhido
//   { type:'delta',   text }                       pedaço de texto
//   { type:'message', text }                       texto completo de um bloco
//   { type:'tool',    name }                       usou uma ferramenta
//   { type:'notice',  message }                    aviso (stderr, limite de uso)
//   { type:'result',  ok, subtype, costUsd, turns } fim da resposta
//   { type:'error',   message }                    falhou
//   { type:'done' }                                stream fechado

import { el } from '../core/ui.js';
import { createFeed } from './feed.js';
import { createComposer } from './composer.js';
import { messageBubble, streamBubble } from './bubble.js';
import { createQuickReplies } from './quick-replies.js';
import { detectOptions } from '../core/detect-options.js';

/**
 * @param {object} opts
 * @param {(args:{limit:number,before?:number}) => Promise<object>} opts.fetchPage
 * @param {(text:string, values:object, images:Array, onEvent:Function, signal:AbortSignal) => Promise<void>} opts.send
 * @param {() => Promise<any>} [opts.onStop] cancelamento do lado do servidor
 * @param {Array} [opts.fields] campos do composer (ver composer.js)
 * @param {(item:any) => Node} [opts.renderMessage]
 * @param {(state:object) => void} [opts.onState]
 * @param {() => void} [opts.onFinish] chamado ao terminar cada resposta
 * @param {string} [opts.placeholder]
 * @param {number} [opts.pageSize]
 */
export function createChat({
  fetchPage,
  send,
  onStop,
  fields = [],
  renderMessage = messageBubble,
  onState,
  onFinish,
  placeholder = 'Escreva para continuar esta conversa…  (Enter envia, Shift+Enter quebra linha)',
  submitLabel = 'Enviar',
  allowImages = true,
  pageSize = 20,
} = {}) {
  const feed = createFeed({
    fetchPage,
    renderItem: renderMessage,
    pageSize,
    onState,
    labels: { done: (total) => `· início da conversa · ${total} mensagens ·` },
  });

  let controller = null;
  let liveBubble = null;
  let quickReplies = null;
  const qrHost = el('div', { class: 'qr-host' });

  function clearQuickReplies() {
    quickReplies?.destroy();
    quickReplies = null;
    qrHost.replaceChildren();
  }

  // ao terminar uma resposta, se ela for uma pergunta com opções, oferece botões
  function offerQuickReplies(text) {
    const options = detectOptions(text);
    if (!options.length) return;
    quickReplies = createQuickReplies({
      options,
      onPick: (value) => { clearQuickReplies(); run(value, composer.values()); },
      onWrite: () => composer.focus(),
    });
    qrHost.replaceChildren(quickReplies.node);
  }

  const composer = createComposer({
    placeholder,
    fields,
    submitLabel,
    allowImages,
    onStop: onStop || send ? () => cancel() : undefined,
    onSubmit: (text, values, images) => run(text, values, images),
  });

  async function cancel() {
    controller?.abort();
    try {
      await onStop?.();
    } catch { /* já pode ter terminado */ }
  }

  async function run(text, values, images = []) {
    clearQuickReplies();
    composer.setBusy(true);
    composer.setHint('enviando…');

    const urls = images.map((im) => `data:${im.media_type};base64,${im.data}`);
    feed.append(messageBubble({ role: 'user', text, at: new Date().toISOString(), images: urls }));

    const bubble = streamBubble({ role: 'assistant' });
    liveBubble = bubble;
    feed.append(bubble.node);
    feed.scrollToEnd();

    let sawDelta = false;
    controller = new AbortController();

    const onEvent = (event) => {
      switch (event.type) {
        case 'init':
          composer.setHint(`modo: ${event.mode} · ${event.cwd || ''}`);
          break;

        case 'system':
          // modelo vira um chip ao lado do indicador — sem apagar o "pensando…"
          if (event.model) bubble.setStatus(event.model, 'accent');
          break;

        case 'delta':
          if (!sawDelta) bubble.setActivity('escrevendo…');
          sawDelta = true;
          bubble.append(event.text);
          feed.scrollToEnd();
          break;

        case 'message':
          // com streaming ligado o texto já veio em deltas; só usa se faltou
          if (!sawDelta && event.text) bubble.append(event.text);
          break;

        case 'tool':
          bubble.addTool(event.name);
          bubble.setActivity(`usando ${event.name}…`);
          sawDelta = false;   // depois da ferramenta o Claude volta a "pensar/escrever"
          break;

        case 'notice':
          bubble.addNotice(event.message);
          break;

        case 'result': {
          const parts = [];
          if (event.costUsd != null) parts.push(`$${event.costUsd.toFixed(4)}`);
          if (event.turns != null) parts.push(`${event.turns} turno(s)`);
          if (event.ok) bubble.finish(parts.join(' · ') || 'pronto');
          else bubble.setError(event.message || event.subtype || 'falhou');
          composer.setHint(parts.join(' · '));
          break;
        }

        case 'error':
          bubble.setError(event.message);
          break;

        default:
      }
    };

    let interrupted = false;
    try {
      await send(text, values, images, onEvent, controller.signal);
    } catch (err) {
      interrupted = true;
      if (err.name === 'AbortError') bubble.addNotice('interrompido');
      else bubble.setError(err.message || String(err));
    } finally {
      controller = null;
      liveBubble = null;
      bubble.finish();
      composer.setBusy(false);
      feed.scrollToEnd();
      onFinish?.();
      // se a resposta foi uma pergunta com opções, oferece botões de resposta rápida
      if (!interrupted) offerQuickReplies(bubble.text());
    }
  }

  return {
    /** vai no corpo rolável */
    node: feed.node,
    /** vai no rodapé fixo: respostas rápidas (quando houver) + caixa de escrever */
    footer: el('div', { class: 'chat-foot' }, qrHost, composer.node),
    feed,
    composer,

    attach(scroller) { feed.attach(scroller); return this; },
    start() { return feed.loadFirst(); },
    reload() { return feed.loadFirst(); },

    /** Aviso acima da caixa de escrever (ex.: conversa aberta num terminal). */
    notice(text, kind) { composer.setNotice(text, kind); return this; },

    /**
     * Encerra a vista. `abort: false` NÃO interrompe uma resposta em andamento —
     * deixa o Claude terminar em segundo plano (grava no .jsonl); fechar a janela
     * não mata o processo. `abort: true` (padrão) cancela de fato.
     */
    destroy({ abort = true } = {}) {
      if (abort) {
        controller?.abort();
        liveBubble?.destroy();
      }
      liveBubble = null;
      clearQuickReplies();
      feed.destroy();
    },
  };
}

/** Atalho para montar a vista dentro de um container simples (fora do drawer). */
export function mountChat(container, chat) {
  container.replaceChildren(el('div', { class: 'chat-wrap' }, chat.node, chat.footer));
  chat.attach(container);
  return chat.start();
}
