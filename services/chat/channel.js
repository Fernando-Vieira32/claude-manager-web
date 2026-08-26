// O quadro de avisos de uma conversa.
//
// Existe por causa de um bug real: o CLI COMEÇA TURNOS SOZINHO (um subagente em
// segundo plano que termina vira um `<task-notification>` enfileirado como se fosse
// mensagem do usuário). Esse turno não tem SSE dono — e o que não tem dono precisa de
// um lugar para chegar ao navegador, senão vira lixo (era o que acontecia).
//
// Vive fora do runner de propósito: o processo da conversa morre e nasce, o canal
// continua. E não conhece HTTP: de um inscrito ele só usa `send(evento)` e `closed`,
// então o teste inscreve um coletor.

/** conversationId -> Set<sse> */
const channels = new Map();

function drop(conversationId, sse) {
  const set = channels.get(conversationId);
  if (!set) return;
  set.delete(sse);
  if (!set.size) channels.delete(conversationId);
}

/**
 * Inscreve um SSE no canal da conversa.
 * @returns {() => void} desinscreve — quem inscreve é quem chama (a rota, no `close`).
 */
export function subscribe(conversationId, sse) {
  const set = channels.get(conversationId) || new Set();
  channels.set(conversationId, set);
  set.add(sse);
  return () => drop(conversationId, sse);
}

/**
 * Manda o evento para todos os inscritos vivos. Inscrito já fechado (ou que estoura ao
 * escrever) sai da lista aqui mesmo: ninguém precisa varrer o mapa depois.
 * @returns {number} quantos receberam — canal sem inscrito é normal, não é erro.
 */
export function publish(conversationId, event) {
  const set = channels.get(conversationId);
  if (!set) return 0;
  let entregues = 0;
  for (const sse of [...set]) {
    if (sse.closed) { drop(conversationId, sse); continue; }
    try {
      sse.send(event);
      entregues += 1;
    } catch {
      drop(conversationId, sse);
    }
  }
  return entregues;
}

/** Quantos ouvem esta conversa — para teste e diagnóstico. */
export const subscriberCount = (conversationId) => channels.get(conversationId)?.size || 0;
