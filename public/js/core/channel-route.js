// Para onde vai cada evento do CANAL da conversa.
//
// O canal existe porque coisas acontecem na conversa sem você pedir: o Claude começa
// turnos por conta própria (agente em segundo plano que volta) e o TERMINAL trabalha na
// mesma conversa. Isso não pertence a nenhum envio seu — não tem bolha, não tem stream
// próprio — e antes era simplesmente DESCARTADO: a tela congelava enquanto o Claude
// seguia trabalhando por dez minutos.
//
// Regra pura de propósito (sem DOM, sem transporte): recebe o evento e o estado, diz o
// que fazer. É o que permite ter spec de verdade em vez de só conferência no navegador.

/**
 * @param {object} event evento vindo do canal (`hello`, `autoStart`, `autoEnd`, `peer`,
 *   `agentStart`/`agentEnd`, `busy`, `gone`, ou um evento normal de stream)
 * @param {{auto:boolean, hello:boolean}} state `auto` = já há bolha de turno espontâneo
 *   aberta; `hello` = já houve uma conexão antes (então a próxima é RE-conexão)
 * @returns {{state:{auto:boolean,hello:boolean}, actions:string[]}} ações, na ordem:
 *   `open` abre a bolha do turno espontâneo · `feed` entrega o evento a ela ·
 *   `close` encerra a bolha · `peer` põe no feed uma fala vinda do terminal ·
 *   `agent` trata um agente que não é de turno nenhum · `busy` atualiza "está
 *   respondendo" · `resync` relê a conversa do disco · `gone` avisa que o processo encerrou
 */
export function routeChannelEvent(event, state = { auto: false, hello: false }) {
  const type = event?.type;
  const auto = Boolean(state?.auto);
  const hello = Boolean(state?.hello);
  const mesmo = (actions) => ({ state: { auto, hello }, actions });

  if (!type) return mesmo([]);

  // Conexão aberta. A PRIMEIRA só informa estado; uma SEGUNDA significa que o canal caiu
  // e voltou (servidor reiniciado, máquina suspensa, rede) — e o que o terminal escreveu
  // durante a queda não passou por aqui. O seguidor novo começa a olhar do FIM do arquivo,
  // então sem reler o disco a janela ficaria silenciosamente desatualizada: o furo que
  // fazia a conversa "não estar em tempo real" sem nenhum aviso.
  if (type === 'hello') {
    return { state: { auto, hello: true }, actions: hello ? ['busy', 'resync'] : ['busy'] };
  }

  if (type === 'busy') return mesmo(['busy']);

  if (type === 'autoStart') return { state: { auto: true, hello }, actions: ['open'] };

  // AGENTE em segundo plano. Ele nasce num turno e volta em OUTRO (dez minutos depois),
  // então o cartão dele não pertence a nenhuma bolha: se há uma aberta, o bloco entra no
  // fluxo dela; se não há, vai para os agentes da conversa — e NÃO abre turno, senão a
  // vista ficaria "respondendo" para sempre por causa de um aviso.
  if (type === 'agentStart' || type === 'agentEnd') return mesmo([auto ? 'feed' : 'agent']);

  // Fala que apareceu na conversa sem passar por aqui: alguém digitou NO TERMINAL. Não é
  // conteúdo de turno — é uma mensagem nova no feed —, então não abre nem fecha bolha.
  // Quem escreve no terminal durante uma resposta continua com a resposta em andamento.
  if (type === 'peer') return mesmo(['peer']);

  // fim do turno espontâneo (ou morte do processo com um aberto): a bolha para de
  // "trabalhar" — deixá-la pulsando para sempre seria mentir
  if (type === 'autoEnd') return { state: { auto: false, hello }, actions: auto ? ['close'] : [] };
  if (type === 'gone') {
    return { state: { auto: false, hello }, actions: auto ? ['close', 'gone'] : ['gone'] };
  }

  // Evento normal de stream. O canal só carrega o que é de turno espontâneo, então isto
  // é conteúdo para a bolha dele. Chegou sem `autoStart` (canal aberto no meio do
  // turno, ou aviso perdido)? Abre a bolha: melhor mostrar solto que sumir — é a mesma
  // escolha do aninhamento de subagente.
  return { state: { auto: true, hello }, actions: auto ? ['feed'] : ['open', 'feed'] };
}
