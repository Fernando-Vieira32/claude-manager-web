// Para onde vai cada evento do canal da conversa (public/js/core/channel-route.js).
//
// O caso que dói: turno que o Claude começa sozinho (agente em segundo plano voltou).
// Antes essas linhas eram descartadas e a tela congelava.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeChannelEvent } from '../public/js/core/channel-route.js';

// o estado carrega duas coisas: bolha de turno espontâneo aberta, e "já houve conexão"
const FECHADO = { auto: false, hello: false };
const ABERTO = { auto: true, hello: false };
const RECONECTADO = { auto: false, hello: true };

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

  describe('fala digitada no terminal', () => {
    it('vai para o feed e não abre bolha de turno', () => {
      const r = routeChannelEvent({ type: 'peer', role: 'user', text: 'olha isso' }, FECHADO);
      assert.deepEqual(r, { state: FECHADO, actions: ['peer'] });
    });

    it('com uma resposta em andamento, não a encerra — no terminal a mensagem entra na fila', () => {
      const r = routeChannelEvent({ type: 'peer', role: 'user', text: 'mais uma' }, ABERTO);
      assert.deepEqual(r, { state: ABERTO, actions: ['peer'] });
    });
  });

  describe('agente em segundo plano', () => {
    it('sem bolha aberta, vai para os agentes da conversa — e NÃO abre turno', () => {
      const r = routeChannelEvent({ type: 'agentStart', id: 'a1', name: 'Lane 1' }, FECHADO);
      assert.deepEqual(r, { state: FECHADO, actions: ['agent'] });
    });

    it('o fim dele idem: um aviso não pode acender bolha que nada apaga', () => {
      const r = routeChannelEvent({ type: 'agentEnd', id: 'a1', result: 'fechou' }, FECHADO);
      assert.deepEqual(r, { state: FECHADO, actions: ['agent'] });
    });

    it('com uma resposta em andamento, o bloco entra no fluxo dela', () => {
      assert.deepEqual(routeChannelEvent({ type: 'agentStart', id: 'a1' }, ABERTO),
        { state: ABERTO, actions: ['feed'] });
      assert.deepEqual(routeChannelEvent({ type: 'agentEnd', id: 'a1' }, ABERTO),
        { state: ABERTO, actions: ['feed'] });
    });
  });

  describe('estado do processo', () => {
    it('o `hello` da conexão só atualiza "está respondendo"', () => {
      assert.deepEqual(routeChannelEvent({ type: 'hello', pid: 1, busy: true }, FECHADO).actions, ['busy']);
    });

    it('e marca que já houve conexão', () => {
      assert.deepEqual(routeChannelEvent({ type: 'hello', busy: false }, FECHADO).state, RECONECTADO);
    });

    it('o `busy` idem, e NÃO abre bolha', () => {
      assert.deepEqual(routeChannelEvent({ type: 'busy', busy: false }, FECHADO).actions, ['busy']);
    });

    it('nenhum dos dois mexe numa bolha aberta', () => {
      assert.deepEqual(routeChannelEvent({ type: 'busy', busy: true }, ABERTO).state, ABERTO);
    });
  });

  describe('o canal caiu e voltou', () => {
    it('o segundo `hello` pede para reler a conversa do disco', () => {
      const r = routeChannelEvent({ type: 'hello', busy: false }, RECONECTADO);
      assert.deepEqual(r.actions, ['busy', 'resync']);
    });

    it('porque o que o terminal escreveu na queda não passou pelo canal', () => {
      // o seguidor novo começa do FIM do arquivo: sem reler, a janela fica desatualizada
      // em silêncio — era o furo que fazia a conversa "não estar em tempo real"
      let estado = { auto: false, hello: false };
      const acoes = [];
      for (const _ of [1, 2, 3]) {
        const r = routeChannelEvent({ type: 'hello', busy: false }, estado);
        estado = r.state;
        acoes.push(r.actions.join('+'));
      }
      assert.deepEqual(acoes, ['busy', 'busy+resync', 'busy+resync']);
    });

    it('reconectar não mexe numa bolha aberta', () => {
      const r = routeChannelEvent({ type: 'hello', busy: true }, { auto: true, hello: true });
      assert.deepEqual(r.state, { auto: true, hello: true });
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
