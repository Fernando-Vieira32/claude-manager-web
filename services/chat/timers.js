// Os dois relógios do processo vivo: quando desligar um processo ocioso e quando
// desistir de um turno. Ficam fora do runner.js porque são a única parte dele que fala
// de tempo — e porque errar aqui é caro: foi um destes que matou o stdin no meio de um
// turno que o CLI havia começado sozinho.
//
// A ociosidade conta SILÊNCIO, não "fila vazia": um turno espontâneo (subagente em
// segundo plano) tem a fila vazia e ainda assim está trabalhando.

/**
 * @param {object} p
 * @param {() => boolean} p.hasWork há turno em curso ou na fila? (então não é ocioso)
 * @param {() => void} p.onIdle silêncio suficiente: hora de fechar o stdin
 * @param {() => void} p.onTurnTimeout o turno corrente passou do limite
 * @param {() => void} p.onGiveUp o turno não fechou nem depois do interrupt
 */
export function createTimers({ idleMs, turnTimeoutMs, giveUpMs, hasWork, onIdle, onTurnTimeout, onGiveUp }) {
  let idle = null;
  let turn = null;
  let giveUp = null;

  const api = {
    /** Sinal de vida: adia a ociosidade por mais um período. */
    keepAwake() {
      clearTimeout(idle);
      idle = setTimeout(() => (hasWork() ? api.keepAwake() : onIdle()), idleMs);
      idle.unref?.();   // processo só esperando não é motivo para o servidor não sair
      return api;
    },

    /** Desarma a ociosidade sem prometer quando ela volta (quem manda mensagem faz isso). */
    holdAwake() { clearTimeout(idle); return api; },

    startTurn() {
      clearTimeout(turn);
      turn = setTimeout(onTurnTimeout, turnTimeoutMs);
      turn.unref?.();
      return api;
    },

    /**
     * O prazo que corre DEPOIS do interrupt. Existe porque interromper é um pedido: se o
     * CLI travou, ele não fecha o turno, nenhum outro relógio é re-armado e a conversa
     * fica presa para sempre atrás de um turno morto.
     */
    startGiveUp() {
      clearTimeout(giveUp);
      giveUp = setTimeout(onGiveUp, giveUpMs);
      giveUp.unref?.();
      return api;
    },

    endTurn() { clearTimeout(turn); clearTimeout(giveUp); return api; },
    stop() { clearTimeout(idle); clearTimeout(turn); clearTimeout(giveUp); return api; },
  };
  return api;
}
