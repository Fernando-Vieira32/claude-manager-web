// Vista de conversa: histórico paginado (feed) + caixa de escrever (composer) +
// consumo de um stream de resposta.
//
// É o componente que junta as peças, e continua sem saber DE QUEM vêm os dados:
// recebe `fetchPage` (histórico) e `send` (transporte do stream). Hoje é ligado ao
// serviço de conversas + chat; amanhã serve para o editor conversar sobre um
// arquivo, ou para um agente qualquer.
//
// Cada resposta na tela é um `live-answer` (bolha viva + tradutor de eventos); o
// contrato dos eventos está em readme/10-chat.md.

import { el } from '../core/ui.js';
import { createFeed } from './feed.js';
import { createComposer } from './composer.js';
import { messageBubble } from './bubble.js';
import { createLiveAnswer } from './live-answer.js';
import { createQuickReplyHost } from './quick-reply-host.js';
import { afterResponse } from '../core/response-end.js';

/**
 * @param {object} opts
 * @param {(args:{limit:number,before?:number}) => Promise<object>} opts.fetchPage
 * @param {(text:string, values:object, images:Array, onEvent:Function, signal:AbortSignal) => Promise<void>} opts.send
 * @param {() => Promise<any>} [opts.onStop] cancelamento do lado do servidor
 * @param {Array} [opts.fields] campos do composer (ver composer.js)
 * @param {(item:any) => Node} [opts.renderMessage]
 * @param {(state:object) => void} [opts.onState]
 * @param {() => void} [opts.onFinish] chamado ao terminar cada resposta
 * @param {(text:string, values:object) => string} [opts.beforeSend] última chance de
 *   mexer no texto antes de virar mensagem (ex.: a frase fixa do fim). O `chat` não
 *   sabe o que a transformação faz — só que o resultado é o que vai para a tela E
 *   para o servidor, nessa ordem
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
  beforeSend,
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

  // Respostas em andamento — pode haver mais de uma: escrever durante uma resposta
  // manda a mensagem NA HORA, e quem a segura até a vez dela é o outro lado.
  const emVoo = new Set();  // { controller, bubble }
  // Respostas que NÃO nasceram de uma mensagem sua (o Claude retomou por conta
  // própria). Contam como "em voo" para nada recarregar o feed em cima delas.
  const autos = new Set();  // { bubble }
  // botões de resposta rápida: peça própria (detecta as opções e se limpa sozinha)
  const respostasRapidas = createQuickReplyHost({
    onPick: (value) => enviar(value, composer.values()),
    onWrite: () => composer.focus(),
  });

  const composer = createComposer({
    placeholder,
    fields,
    submitLabel,
    allowImages,
    onStop: onStop || send ? () => cancel() : undefined,
    onSubmit: (text, values, images) => enviar(text, values, images),
  });

  /**
   * Interrompe a resposta que está sendo escrita agora. Quem corta é o outro lado
   * (`onStop`), não o navegador: assim o "interrompido" ainda chega na bolha, e as
   * mensagens que você já mandou continuam valendo. Desligar só a conexão daqui
   * seria fechar os olhos — do outro lado o trabalho continuaria.
   */
  async function cancel() {
    const atual = [...emVoo][0];   // a mais antiga é a que está sendo respondida
    if (!onStop) {
      atual?.controller.abort();
      return;
    }
    try {
      await onStop();
    } catch {
      atual?.controller.abort();   // não deu para cortar lá: desliga o stream daqui
    }
  }

  /**
   * Envia — SEMPRE na hora, mesmo com uma resposta em andamento. É o comportamento
   * do terminal: a mensagem vai direto para quem responde, e ele a pega quando
   * termina o passo atual. Antes a fila era AQUI e a mensagem só saía quando a
   * resposta anterior acabava; agora a espera acontece do outro lado, e a bolha da
   * mensagem nova mostra "na fila" enquanto isso (evento `queued` do stream).
   */
  async function enviar(cru, values, images = []) {
    // transforma ANTES de tudo: a bolha que aparece na tela e o que sai no envio
    // têm de ser o mesmo texto — mostrar uma coisa e mandar outra seria mentira
    const text = beforeSend ? beforeSend(cru, values) : cru;
    respostasRapidas.clear();
    composer.setBusy(true);
    composer.setHint('enviando…');

    const urls = images.map((im) => `data:${im.media_type};base64,${im.data}`);
    feed.append(messageBubble({ role: 'user', text, at: new Date().toISOString(), images: urls }));

    // bolha viva + tradutor do stream vêm juntos no `live-answer` (a mesma peça que
    // mostra a resposta que o Claude começa por conta própria)
    const resposta = createLiveAnswer({ feed, onHint: (t) => composer.setHint(t) });
    const voo = { controller: new AbortController(), resposta };
    emVoo.add(voo);

    let interrupted = false;
    try {
      await send(text, values, images, resposta.onEvent, voo.controller.signal);
    } catch (err) {
      interrupted = true;
      if (err.name === 'AbortError') resposta.bubble.addNotice('interrompido');
      else resposta.bubble.setError(err.message || String(err));
      composer.setHint('');   // senão fica "enviando…" para sempre depois da falha
    } finally {
      emVoo.delete(voo);
      resposta.finish();
      // a decisão é regra pura e mora no core/response-end.js (com teste na suíte):
      // recarregar o feed em cima de uma resposta em voo, ou de um erro, apaga da tela
      // informação que o usuário precisava ver
      const fim = afterResponse({
        interrupted, failed: resposta.bubble.failed, inFlight: emVoo.size + autos.size,
      });
      if (fim.idle) composer.setBusy(false);
      if (fim.reload) onFinish?.();
      if (fim.quickReplies) respostasRapidas.offer(resposta.bubble.text());
    }
  }

  return {
    /** vai no corpo rolável */
    node: feed.node,
    /** vai no rodapé fixo: respostas rápidas (quando houver) + caixa de escrever */
    footer: el('div', { class: 'chat-foot' }, respostasRapidas.node, composer.node),
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
    submit(text, images = []) { return enviar(text, composer.values(), images); },

    /** Aviso acima da caixa de escrever (ex.: conversa aberta num terminal). */
    notice(text, kind) { composer.setNotice(text, kind); return this; },

    /** Há resposta chegando nesta vista? (a sua ou uma que o Claude começou sozinho) */
    working: () => emVoo.size + autos.size > 0,

    /**
     * Abre uma bolha para uma resposta que **não** nasceu de uma mensagem sua — o
     * Claude retomou por conta própria (um agente em segundo plano voltou). Devolve o
     * mesmo `onEvent` do stream normal, então quem observa o canal da conversa não
     * precisa saber desenhar nada; e enquanto ela existe, o feed não é recarregado em
     * cima dela.
     */
    watch({ label = 'retomou sozinho…' } = {}) {
      const resposta = createLiveAnswer({ feed, label });
      const voo = { resposta };
      autos.add(voo);
      return {
        onEvent: resposta.onEvent,
        /** Encerra a bolha: sem isto o indicador vivo pulsaria para sempre. */
        finish(resumo) { autos.delete(voo); resposta.finish(resumo); },
        destroy() { autos.delete(voo); resposta.destroy(); },
      };
    },

    /**
     * Encerra a vista. `abort: false` NÃO interrompe as respostas em andamento —
     * deixa o Claude terminar em segundo plano (grava no .jsonl); fechar a janela
     * não mata o processo. `abort: true` (padrão) cancela de fato.
     *
     * O `destroy()` das bolhas acontece nos dois casos: elas saem da tela junto com
     * o feed, e o indicador vivo tem um timer que precisa parar de qualquer jeito.
     */
    destroy({ abort = true } = {}) {
      for (const voo of emVoo) {
        if (abort) voo.controller.abort();
        voo.bubble.destroy();
      }
      emVoo.clear();
      for (const voo of autos) voo.bubble.destroy();   // têm timer: sempre parar
      autos.clear();
      respostasRapidas.destroy();
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
