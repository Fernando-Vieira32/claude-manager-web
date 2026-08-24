// Vista de conversa: histórico paginado (feed) + caixa de escrever (composer) +
// consumo de um stream de resposta.
//
// É o componente que junta as peças, e continua sem saber DE QUEM vêm os dados:
// recebe `fetchPage` (histórico) e `send` (transporte do stream). Hoje é ligado ao
// serviço de conversas + chat; amanhã serve para o editor conversar sobre um
// arquivo, ou para um agente qualquer.
//
// Os eventos que `send` entrega a `onEvent` (o que o /api/chat emite) são
// traduzidos pelo `stream-sink.js`; o contrato está em readme/10-chat.md.

import { el } from '../core/ui.js';
import { createFeed } from './feed.js';
import { createComposer } from './composer.js';
import { messageBubble, streamBubble, clearBadge } from './bubble.js';
import { createQuickReplies } from './quick-replies.js';
import { createStreamSink } from './stream-sink.js';
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
  let rodando = false;      // uma resposta por vez
  const fila = [];          // mensagens digitadas durante a resposta
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

  /**
   * Envia — ou ENFILEIRA, se uma resposta já está correndo. É o comportamento do
   * terminal: você digita durante a resposta e a mensagem espera a vez. Antes a
   * caixa travava até a resposta acabar.
   */
  function run(text, values, images = []) {
    if (rodando) {
      const urls = images.map((im) => `data:${im.media_type};base64,${im.data}`);
      const node = messageBubble({
        role: 'user', text, at: new Date().toISOString(), images: urls, badge: 'na fila',
      });
      feed.append(node);
      feed.scrollToEnd();
      fila.push({ text, values, images, node });
      return Promise.resolve();
    }
    return ciclo(text, values, images, null);
  }

  /** Uma resposta por vez: termina uma, puxa a próxima da fila, até esvaziar. */
  async function ciclo(text, values, images, node) {
    rodando = true;
    let atual = { text, values, images, node };
    try {
      while (atual) {
        await enviar(atual.text, atual.values, atual.images, atual.node);
        atual = fila.shift() || null;
      }
    } finally {
      rodando = false;
    }
  }

  async function enviar(text, values, images = [], jaNaTela = null) {
    clearQuickReplies();
    composer.setBusy(true);
    composer.setHint('enviando…');

    // se veio da fila, a bolha já está na tela: só tira o "na fila"
    if (jaNaTela) clearBadge(jaNaTela);
    else {
      const urls = images.map((im) => `data:${im.media_type};base64,${im.data}`);
      feed.append(messageBubble({ role: 'user', text, at: new Date().toISOString(), images: urls }));
    }

    const bubble = streamBubble({ role: 'assistant' });
    liveBubble = bubble;
    feed.append(bubble.node);
    feed.scrollToEnd();

    controller = new AbortController();
    // a tradução dos eventos do stream vive no `stream-sink` (peça separada)
    const onEvent = createStreamSink({
      bubble,
      onHint: (t) => composer.setHint(t),
      onScroll: () => feed.scrollToEnd(),
    });

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
      // com fila cheia continuamos "respondendo": não pisca o rótulo para "Enviar"
      if (!fila.length) composer.setBusy(false);
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

    /**
     * Envia um texto por código, com os valores atuais dos campos — o mesmo
     * caminho do clique em "Enviar" e das respostas rápidas. Serve para quem abre
     * a vista já com uma primeira mensagem (e imagens) em mão.
     */
    submit(text, images = []) { return run(text, composer.values(), images); },

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
      // quem foi fechado não continua mandando: a fila morre com a vista
      fila.length = 0;
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
