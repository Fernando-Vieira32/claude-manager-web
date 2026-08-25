// Mostra na vista o que chega pelo CANAL da conversa — isto é, o que o Claude faz
// **sem** você pedir: ele começa turnos por conta própria quando um agente que soltou
// em segundo plano termina (o porquê está em readme/10-chat.md).
//
// Antes esse trabalho não tinha para onde ir e era descartado: a janela congelava na
// última resposta enquanto o Claude seguia trabalhando por dez minutos, e o botão
// "Parar" desaparecia — nem interromper dava.
//
// Fica fora do `conversation-window` porque é responsabilidade própria e, sem DOM
// nenhum (só chama métodos do `chat`), tem teste de verdade na suíte.
//
//   const observador = createAutoTurnWatcher({ chat });
//   const canal = watch(observador.handle);   // transporte entra por parâmetro
//   // ao fechar: canal.close(); observador.destroy();

import { routeChannelEvent } from '../core/channel-route.js';

/**
 * @param {object} opts
 * @param {object} opts.chat a vista de conversa (`watch()`, `working()`, `composer`)
 * @returns {{handle:(event:object) => void, destroy:Function}}
 */
export function createAutoTurnWatcher({ chat } = {}) {
  let rota = { auto: false };
  let auto = null;

  /** Só LIGAR vem do canal: desligar é do `chat`, que sabe se há envio SEU em voo. */
  function marcarOcupado(ocupado) {
    if (ocupado) chat.composer.setBusy(true);
    else if (!chat.working()) chat.composer.setBusy(false);
  }

  const acoes = {
    open: () => { auto = auto || chat.watch(); },
    feed: (event) => auto?.onEvent(event),
    close: () => { auto?.finish(); auto = null; },
    busy: (event) => marcarOcupado(Boolean(event.busy)),
    // processo encerrou (normal depois da ociosidade): nada visível, só destrava
    gone: () => marcarOcupado(false),
  };

  const api = {
    /** Um evento do canal entra; o que aparece na tela sai. */
    handle(event) {
      const { state, actions } = routeChannelEvent(event, rota);
      rota = state;
      for (const acao of actions) acoes[acao]?.(event);
      return api;
    },

    /** A bolha viva tem timer: fechar a janela sem isto deixaria o timer rodando. */
    destroy() {
      auto?.destroy();
      auto = null;
      rota = { auto: false };
      return api;
    },
  };

  return api;
}
