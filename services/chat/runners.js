// O registro dos processos vivos, um por conversa.
//
// Existe separado do repo.js por causa de UM bug: a rota de mensagem resolvia
// `(sessionId, cwd)` lendo o transcript ANTES de olhar se a conversa já tinha processo
// vivo. Numa conversa recém-criada esse arquivo ainda não existe enquanto a primeira
// resposta corre, então a segunda mensagem morria com "conversa não encontrada" — e os
// 190 testes passavam, porque nenhum deles via esse caminho.
//
// A regra "dá para reaproveitar este processo?" é decidível sem disco, sem spawn e sem
// HTTP. Aqui ela é pura o suficiente para ter teste de verdade na suíte.

import { conflict } from '../../core/http.js';

/**
 * @returns {{ get, remember, forget, list, reusable }} um registro isolado — a fábrica
 *   existe para o teste ter o seu, em vez de compartilhar um mapa de módulo.
 */
export function createRunnerRegistry() {
  const runners = new Map();

  const api = {
    get: (conversationId) => runners.get(conversationId),
    remember(conversationId, runner) { runners.set(conversationId, runner); return api; },

    /** Só esquece se ainda for ESTE runner: um substituto já registrado não pode ser apagado. */
    forget(conversationId, runner) {
      if (!runner || runners.get(conversationId) === runner) runners.delete(conversationId);
      return api;
    },

    list: () => [...runners.values()],
    has: (conversationId) => runners.has(conversationId),

    /**
     * O processo que serve esta conversa, se der para reaproveitá-lo. Modo e modelo são
     * flags de linha de comando, então formam a "assinatura": trocar de modo exige
     * processo novo.
     *
     * Quem recebe um runner daqui **não deve tocar no disco**: sessão e pasta já são
     * conhecimento do processo vivo.
     *
     * @returns o runner reaproveitável, ou `null` quando é preciso spawnar outro.
     * @throws {ApiError} 409 se está respondendo com outra assinatura — trocar de modo
     *   no meio de uma resposta é a hora em que um acidente passaria despercebido.
     */
    reusable(conversationId, signature) {
      const existing = runners.get(conversationId);
      if (!existing?.alive) return null;
      if (existing.signature === signature) return existing;
      if (existing.busy) {
        throw conflict('esta conversa está respondendo com outro modo/modelo; espere terminar para trocar');
      }
      return null;   // ocioso com outra assinatura: quem chamou troca o processo
    },
  };

  return api;
}
