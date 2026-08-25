// O que aparece na vista quando chega algo pelo canal da conversa
// (public/js/components/auto-turn-watcher.js).
//
// O caso que dói: o Claude começa um turno por conta própria (um agente em segundo
// plano voltou). Antes isso não tinha para onde ir e era DESCARTADO — a janela
// congelava na última resposta com ele ainda trabalhando.
//
// Não precisa de DOM: o observador só chama métodos do `chat`, então um `chat` de
// mentira basta e o teste vive na suíte de verdade.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoTurnWatcher } from '../public/js/components/auto-turn-watcher.js';

/** `chat` de mentira: grava o que foi pedido a ele. */
function fakeChat({ working = false } = {}) {
  const log = [];
  let bolhas = 0;
  const chat = {
    log,
    trabalhando: working,
    working: () => chat.trabalhando,
    composer: { setBusy: (v) => log.push(`busy:${v}`) },
    watch() {
      bolhas += 1;
      log.push('abriu bolha');
      return {
        onEvent: (e) => log.push(`evento:${e.type}`),
        finish: () => log.push('encerrou bolha'),
        destroy: () => log.push('destruiu bolha'),
      };
    },
    get bolhas() { return bolhas; },
  };
  return chat;
}

describe('createAutoTurnWatcher', () => {
  let chat;
  let obs;

  beforeEach(() => {
    chat = fakeChat();
    obs = createAutoTurnWatcher({ chat });
  });

  describe('turno que o Claude começa sozinho', () => {
    beforeEach(() => {
      obs.handle({ type: 'autoStart' });
      obs.handle({ type: 'tool', name: 'Bash' });
      obs.handle({ type: 'delta', text: 'oi' });
    });

    it('abre UMA bolha e entrega os eventos a ela', () => {
      assert.deepEqual(chat.log, ['abriu bolha', 'evento:tool', 'evento:delta']);
    });

    it('não abre uma segunda bolha para o mesmo turno', () => {
      obs.handle({ type: 'delta', text: 'mais' });
      assert.equal(chat.bolhas, 1);
    });

    it('encerra a bolha no fim do turno', () => {
      obs.handle({ type: 'autoEnd' });
      assert.equal(chat.log.at(-1), 'encerrou bolha');
    });

    it('e um turno espontâneo NOVO depois disso ganha bolha nova', () => {
      obs.handle({ type: 'autoEnd' });
      obs.handle({ type: 'autoStart' });
      assert.equal(chat.bolhas, 2);
    });
  });

  describe('conteúdo chegando sem o aviso de início', () => {
    it('abre a bolha e mostra — melhor solto que sumido', () => {
      obs.handle({ type: 'delta', text: 'já estava trabalhando' });
      assert.deepEqual(chat.log, ['abriu bolha', 'evento:delta']);
    });
  });

  describe('o "Parar" (setBusy)', () => {
    it('liga quando o canal diz que está respondendo', () => {
      obs.handle({ type: 'busy', busy: true });
      assert.deepEqual(chat.log, ['busy:true']);
    });

    it('desliga quando o canal diz que parou e a vista não tem nada em voo', () => {
      obs.handle({ type: 'busy', busy: false });
      assert.deepEqual(chat.log, ['busy:false']);
    });

    it('NÃO desliga se a vista ainda tem um envio SEU em voo', () => {
      chat.trabalhando = true;
      obs.handle({ type: 'busy', busy: false });
      assert.deepEqual(chat.log, []);
    });

    it('o `hello` da conexão também acerta o estado', () => {
      obs.handle({ type: 'hello', pid: 7, busy: true, pending: 0 });
      assert.deepEqual(chat.log, ['busy:true']);
    });
  });

  describe('o processo da conversa encerra', () => {
    it('com turno espontâneo aberto: encerra a bolha e destrava', () => {
      obs.handle({ type: 'autoStart' });
      obs.handle({ type: 'gone' });
      assert.deepEqual(chat.log, ['abriu bolha', 'encerrou bolha', 'busy:false']);
    });

    it('sem nada aberto: só destrava, sem sujar a tela', () => {
      obs.handle({ type: 'gone' });
      assert.deepEqual(chat.log, ['busy:false']);
    });
  });

  describe('destroy', () => {
    it('destrói a bolha aberta (ela tem timer vivo)', () => {
      obs.handle({ type: 'autoStart' });
      obs.destroy();
      assert.equal(chat.log.at(-1), 'destruiu bolha');
    });

    it('sem bolha aberta não faz nada', () => {
      obs.destroy();
      assert.deepEqual(chat.log, []);
    });

    it('depois de destruído, um turno novo abre bolha nova', () => {
      obs.handle({ type: 'autoStart' });
      obs.destroy();
      obs.handle({ type: 'autoStart' });
      assert.equal(chat.bolhas, 2);
    });
  });

  describe('evento estranho', () => {
    it('nulo não estoura nem mexe na tela', () => {
      obs.handle(null);
      assert.deepEqual(chat.log, []);
    });
  });
});
