// O que fazer quando UMA resposta termina.
//
// Parece detalhe e não é: recarregar o feed é `replaceChildren`, ou seja, apaga tudo
// o que está na tela. Duas vezes em que fazer isso DESTRÓI informação:
//
//  - com outra resposta ainda chegando, apagaria a bolha dela — a mensagem que você
//    mandou desaparece no meio do caminho;
//  - depois de uma falha, apagaria a explicação do erro, e sobra uma janela vazia sem
//    pista nenhuma ("criei a conversa e não aconteceu nada").
//
// Regra pura de propósito: sem DOM, sem componente, sem rota — dado entra, decisão sai.
// É o que permite ter teste de verdade na suíte em vez de só conferência no navegador.

/**
 * @param {object} fim
 * @param {boolean} [fim.interrupted] o envio morreu antes de terminar (abort/exceção)
 * @param {boolean} [fim.failed] terminou, mas em erro (a bolha está mostrando o motivo)
 * @param {number} [fim.inFlight] quantas OUTRAS respostas ainda estão chegando
 * @returns {{idle:boolean, reload:boolean, quickReplies:boolean}}
 *   `idle` — não há mais nada em voo: a caixa pode sair do estado "respondendo";
 *   `reload` — pode trocar as bolhas vivas pelas do disco;
 *   `quickReplies` — pode oferecer os botões de resposta rápida.
 */
export function afterResponse({ interrupted = false, failed = false, inFlight = 0 } = {}) {
  const idle = inFlight <= 0;
  const limpa = !interrupted && !failed;
  return { idle, reload: idle && limpa, quickReplies: idle && limpa };
}
