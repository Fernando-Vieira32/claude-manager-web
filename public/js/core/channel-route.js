// Para onde vai cada evento do CANAL da conversa.
//
// O canal existe porque o Claude começa turnos por conta própria: quando um agente em
// segundo plano termina, o CLI trata o aviso como uma mensagem nova e responde sem que
// você tenha pedido nada. Esse trabalho não pertence a nenhum envio seu — não tem
// bolha, não tem stream próprio — e antes ele era simplesmente DESCARTADO: a tela
// congelava enquanto o Claude seguia trabalhando por dez minutos.
//
// Regra pura de propósito (sem DOM, sem transporte): recebe o evento e o estado, diz o
// que fazer. É o que permite ter spec de verdade em vez de só conferência no navegador.

/** Eventos que só informam estado, e nunca abrem bolha. */
const ESTADO = { hello: 'busy', busy: 'busy' };

/**
 * @param {object} event evento vindo do canal (`autoStart`, `autoEnd`, `busy`, `gone`,
 *   ou um evento normal de stream: `delta`, `tool`, `result`…)
 * @param {{auto:boolean}} state `auto` = já há uma bolha de turno espontâneo aberta
 * @returns {{state:{auto:boolean}, actions:string[]}} ações, na ordem:
 *   `open` abre a bolha do turno espontâneo · `feed` entrega o evento a ela ·
 *   `close` encerra a bolha · `busy` atualiza "está respondendo" ·
 *   `gone` avisa que o processo da conversa encerrou
 */
export function routeChannelEvent(event, state = { auto: false }) {
  const type = event?.type;
  const auto = Boolean(state?.auto);
  if (!type) return { state: { auto }, actions: [] };

  if (ESTADO[type]) return { state: { auto }, actions: [ESTADO[type]] };

  if (type === 'autoStart') return { state: { auto: true }, actions: ['open'] };

  // fim do turno espontâneo (ou morte do processo com um aberto): a bolha para de
  // "trabalhar" — deixá-la pulsando para sempre seria mentir
  if (type === 'autoEnd') return { state: { auto: false }, actions: auto ? ['close'] : [] };
  if (type === 'gone') return { state: { auto: false }, actions: auto ? ['close', 'gone'] : ['gone'] };

  // Evento normal de stream. O canal só carrega o que é de turno espontâneo, então isto
  // é conteúdo para a bolha dele. Chegou sem `autoStart` (canal aberto no meio do
  // turno, ou aviso perdido)? Abre a bolha: melhor mostrar solto que sumir — é a mesma
  // escolha do aninhamento de subagente.
  return { state: { auto: true }, actions: auto ? ['feed'] : ['open', 'feed'] };
}
