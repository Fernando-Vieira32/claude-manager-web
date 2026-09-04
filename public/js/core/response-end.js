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

/**
 * O turno que você acabou de ver chegar já está no DISCO?
 *
 * O CLI grava o `.jsonl` **depois** de fechar o stream — medido nesta máquina: no
 * instante do `result` o arquivo só tinha a mensagem do usuário, e a resposta apareceu
 * ~500 ms mais tarde. Como recarregar o feed é `replaceChildren`, recarregar nessa
 * janela trocava a bolha que tinha a resposta por uma página que ainda não a tinha: a
 * resposta **desaparecia da tela** e só voltava ao reabrir a conversa.
 *
 * @param {{role?:string, at?:string}} [last] última mensagem que o disco devolve
 * @param {number} [sentAt] instante (ms) do envio cujo turno pode não ter sido gravado;
 *   `0`/ausente significa "nada nosso pendente" — aí o disco é sempre confiável
 * @returns {boolean}
 */
export function turnOnDisk(last, sentAt) {
  if (!sentAt) return true;
  if (!last || last.role !== 'assistant') return false;
  const at = Date.parse(last.at || '');
  // sem data legível não dá para comparar: aceitar é melhor que travar o recarregamento
  return Number.isFinite(at) ? at >= sentAt : true;
}

/**
 * Espera — com teto — o disco ter o turno. Recebe COMO buscar e COMO dormir, então não
 * tem `fetch` nem timer aqui dentro: dá teste de verdade em vez de conferência no
 * navegador. Estourou o teto? Devolve `false`, e quem chamou **não** recarrega — manter
 * na tela a resposta que a pessoa viu chegar é mais honesto que trocá-la por nada.
 *
 * @param {object} opts
 * @param {() => Promise<object|undefined>} opts.fetchLast última mensagem do disco
 * @param {number} [opts.sentAt] o mesmo de `turnOnDisk`
 * @param {number} [opts.tries] tentativas (padrão 12)
 * @param {number} [opts.waitMs] espera entre tentativas (padrão 150 ms)
 * @param {(ms:number) => Promise<void>} opts.sleep
 * @returns {Promise<boolean>}
 */
export async function waitTurnOnDisk({ fetchLast, sentAt, tries = 12, waitMs = 150, sleep }) {
  if (!sentAt) return true;
  for (let i = 0; i < tries; i += 1) {
    if (turnOnDisk(await fetchLast(), sentAt)) return true;
    if (i < tries - 1) await sleep(waitMs);
  }
  return false;
}
