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
  let rota = { auto: false, hello: false };
  let auto = null;

  /** Só LIGAR vem do canal: desligar é do `chat`, que sabe se há envio SEU em voo. */
  function marcarOcupado(ocupado) {
    if (ocupado) chat.composer.setBusy(true);
    else if (!chat.working()) chat.composer.setBusy(false);
  }

  const acoes = {
    open: (event) => { auto = auto || chat.watch(rotulo(event)); },
    feed: (event) => auto?.onEvent(event),
    close: () => { auto?.finish(); auto = null; },
    // fala digitada no terminal: entra no feed como mensagem, com a marca de onde veio
    peer: (event) => chat.peer(event),
    // agente em segundo plano: é da conversa, não de um turno (ver channel-route)
    agent: (event) => chat.agentEvent(event),
    // o canal caiu e voltou: o que passou durante a queda só está no disco
    resync: () => chat.resync(),
    busy: (event) => marcarOcupado(Boolean(event.busy)),
    // processo encerrou (normal depois da ociosidade): nada visível, só destrava
    gone: () => marcarOcupado(false),
  };

  /**
   * De onde veio o turno decide o rótulo do indicador. Trabalho que está acontecendo no
   * TERMINAL não é "retomou sozinho" — chamar assim confundiria as duas coisas.
   */
  const rotulo = (event) => (event?.source === 'terminal' ? { label: 'no terminal…' } : {});

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
      rota = { auto: false, hello: false };
      return api;
    },
  };

  return api;
}
