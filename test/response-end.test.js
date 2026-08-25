// O que pode acontecer quando uma resposta termina — a regra que impede a tela de
// apagar informação que o usuário precisava ver (public/js/core/response-end.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { afterResponse } from '../public/js/core/response-end.js';

describe('afterResponse', () => {
  describe('terminou limpo e não sobrou nada em voo', () => {
    const fim = afterResponse({ inFlight: 0 });

    it('libera tudo: caixa livre, feed recarregado, botões oferecidos', () => {
      assert.deepEqual(fim, { idle: true, reload: true, quickReplies: true });
    });
  });

  describe('ainda há OUTRA resposta chegando', () => {
    const fim = afterResponse({ inFlight: 1 });

    it('não recarrega o feed (apagaria a bolha da outra)', () => {
      assert.equal(fim.reload, false);
    });

    it('não oferece resposta rápida (a próxima resposta apagaria os botões)', () => {
      assert.equal(fim.quickReplies, false);
    });

    it('e a caixa continua no estado "respondendo"', () => {
      assert.equal(fim.idle, false);
    });
  });

  describe('terminou em erro', () => {
    const fim = afterResponse({ failed: true, inFlight: 0 });

    it('não recarrega o feed — recarregar apagaria a explicação do erro', () => {
      assert.equal(fim.reload, false);
    });

    it('mas a caixa sai de "respondendo": não há mais nada chegando', () => {
      assert.equal(fim.idle, true);
    });
  });

  describe('foi interrompido', () => {
    const fim = afterResponse({ interrupted: true, inFlight: 0 });

    it('não recarrega nem oferece botões', () => {
      assert.deepEqual(fim, { idle: true, reload: false, quickReplies: false });
    });
  });

  describe('erro COM outra resposta em voo', () => {
    const fim = afterResponse({ failed: true, inFlight: 2 });

    it('nada de recarregar, e a caixa segue respondendo', () => {
      assert.deepEqual(fim, { idle: false, reload: false, quickReplies: false });
    });
  });

  describe('sem argumento nenhum', () => {
    it('assume o caso limpo — chamada sem dado não pode virar exceção na tela', () => {
      assert.deepEqual(afterResponse(), { idle: true, reload: true, quickReplies: true });
    });
  });

  describe('inFlight negativo (contador que escorregou)', () => {
    it('conta como vazio em vez de travar a caixa para sempre', () => {
      assert.equal(afterResponse({ inFlight: -1 }).idle, true);
    });
  });
});
