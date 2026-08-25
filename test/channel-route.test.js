// Para onde vai cada evento do canal da conversa (public/js/core/channel-route.js).
//
// O caso que dói: turno que o Claude começa sozinho (agente em segundo plano voltou).
// Antes essas linhas eram descartadas e a tela congelava.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeChannelEvent } from '../public/js/core/channel-route.js';

const FECHADO = { auto: false };
const ABERTO = { auto: true };

describe('routeChannelEvent', () => {
  describe('turno espontâneo do começo ao fim', () => {
    it('o aviso de início abre a bolha', () => {
      const r = routeChannelEvent({ type: 'autoStart' }, FECHADO);
      assert.deepEqual(r, { state: ABERTO, actions: ['open'] });
    });

    it('o conteúdo seguinte alimenta a bolha já aberta, sem abrir outra', () => {
      const r = routeChannelEvent({ type: 'delta', text: 'oi' }, ABERTO);
      assert.deepEqual(r, { state: ABERTO, actions: ['feed'] });
    });

    it('o resultado também é conteúdo: a bolha mostra o fim dele', () => {
      assert.deepEqual(routeChannelEvent({ type: 'result', ok: true }, ABERTO).actions, ['feed']);
    });

    it('o aviso de fim encerra a bolha', () => {
      const r = routeChannelEvent({ type: 'autoEnd' }, ABERTO);
      assert.deepEqual(r, { state: FECHADO, actions: ['close'] });
    });
  });

  describe('conteúdo chegando sem o aviso de início', () => {
    it('abre a bolha e entrega — melhor mostrar solto que sumir', () => {
      const r = routeChannelEvent({ type: 'tool', name: 'Bash' }, FECHADO);
      assert.deepEqual(r, { state: ABERTO, actions: ['open', 'feed'] });
    });
  });

  describe('fim sem nada aberto', () => {
    it('não faz nada (não fecha bolha que não existe)', () => {
      assert.deepEqual(routeChannelEvent({ type: 'autoEnd' }, FECHADO), { state: FECHADO, actions: [] });
    });
  });

  describe('estado do processo', () => {
    it('o `hello` da conexão só atualiza "está respondendo"', () => {
      assert.deepEqual(routeChannelEvent({ type: 'hello', pid: 1, busy: true }, FECHADO).actions, ['busy']);
    });

    it('o `busy` idem, e NÃO abre bolha', () => {
      assert.deepEqual(routeChannelEvent({ type: 'busy', busy: false }, FECHADO).actions, ['busy']);
    });

    it('nenhum dos dois mexe numa bolha aberta', () => {
      assert.deepEqual(routeChannelEvent({ type: 'busy', busy: true }, ABERTO).state, ABERTO);
    });
  });

  describe('processo encerrou', () => {
    it('com bolha aberta: encerra a bolha E avisa', () => {
      const r = routeChannelEvent({ type: 'gone' }, ABERTO);
      assert.deepEqual(r, { state: FECHADO, actions: ['close', 'gone'] });
    });

    it('sem bolha aberta: só avisa', () => {
      assert.deepEqual(routeChannelEvent({ type: 'gone' }, FECHADO), { state: FECHADO, actions: ['gone'] });
    });
  });

  describe('entrada estranha', () => {
    it('evento sem tipo não faz nada', () => {
      assert.deepEqual(routeChannelEvent({}, ABERTO), { state: ABERTO, actions: [] });
    });

    it('nulo não estoura e preserva o estado', () => {
      assert.deepEqual(routeChannelEvent(null, ABERTO), { state: ABERTO, actions: [] });
    });

    it('sem estado assume que não há bolha aberta', () => {
      assert.deepEqual(routeChannelEvent({ type: 'delta', text: 'x' }).actions, ['open', 'feed']);
    });
  });
});
