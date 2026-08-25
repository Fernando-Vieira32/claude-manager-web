// Uma resposta CHEGANDO na tela: a bolha viva e o tradutor de eventos, já colados e
// já dentro do feed.
//
// Saiu do `chat.js` porque nasceram dois lugares fazendo o mesmo par bolha+tradutor:
// a resposta a uma mensagem sua e a resposta que o Claude começa por conta própria
// (agente em segundo plano que volta). Duas cópias do mesmo desenho é o tombo que o
// CLAUDE.md já registra — então o desenho passou a ter um dono só.
//
//   const resposta = createLiveAnswer({ feed, onHint: (t) => composer.setHint(t) });
//   await send(texto, valores, imagens, resposta.onEvent, sinal);
//   resposta.finish();

import { streamBubble } from './bubble.js';
import { createStreamSink } from './stream-sink.js';

/**
 * @param {object} opts
 * @param {object} opts.feed o feed onde a bolha entra (precisa de `append`/`scrollToEnd`)
 * @param {string} [opts.label] rótulo inicial do indicador vivo ("pensando…")
 * @param {(text:string) => void} [opts.onHint] rodapé (modo, custo) — opcional de
 *   propósito: uma resposta que você não pediu não deve mexer na dica da sua caixa
 * @returns {{bubble:object, onEvent:Function, finish:Function, destroy:Function}}
 */
export function createLiveAnswer({ feed, label, onHint } = {}) {
  const bubble = streamBubble({ role: 'assistant', ...(label ? { label } : {}) });
  feed.append(bubble.node);
  feed.scrollToEnd();

  const onEvent = createStreamSink({
    bubble,
    onHint,
    onScroll: () => feed.scrollToEnd(),
  });

  const api = {
    bubble,
    /** Entrega um evento do stream à bolha (é o `onEvent` do contrato do chat). */
    onEvent,

    /** Encerra o estado "trabalhando" — sem isto o indicador pulsa para sempre. */
    finish(resumo) {
      bubble.finish(resumo);
      feed.scrollToEnd();
      return api;
    },

    /** Obrigatório: o indicador vivo tem timer, e a bolha pode sair da tela antes. */
    destroy() {
      bubble.destroy();
      return api;
    },
  };

  return api;
}
