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
  const rotulos = [];
  const falas = [];
  let bolhas = 0;
  const chat = {
    log,
    rotulos,
    falas,
    trabalhando: working,
    working: () => chat.trabalhando,
    composer: { setBusy: (v) => log.push(`busy:${v}`) },
    peer: (fala) => { falas.push(fala); log.push('fala no feed'); },
    agentEvent: (e) => { log.push(`agente:${e.type}`); },
    resync: () => { log.push('releu do disco'); },
    reload: () => { log.push('reload'); },
    watch(opts = {}) {
      bolhas += 1;
      rotulos.push(opts.label ?? null);
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

  describe('a conversa está sendo conduzida no terminal', () => {
    it('o turno de lá abre bolha com rótulo próprio — não é "retomou sozinho"', () => {
      obs.handle({ type: 'autoStart', source: 'terminal' });
      assert.deepEqual(chat.rotulos, ['no terminal…']);
    });

    it('turno sem procedência declarada mantém o rótulo padrão da bolha', () => {
      obs.handle({ type: 'autoStart' });
      assert.deepEqual(chat.rotulos, [null]);
    });

    it('a fala digitada lá entra no feed como mensagem, sem abrir bolha', () => {
      obs.handle({ type: 'peer', role: 'user', text: 'olha isso', at: '2026-08-25T19:00:00.000Z' });

      assert.deepEqual(chat.log, ['fala no feed']);
      assert.equal(chat.bolhas, 0);
      assert.equal(chat.falas[0].text, 'olha isso');
      assert.equal(chat.falas[0].at, '2026-08-25T19:00:00.000Z');
    });

    it('e a fala não interrompe a resposta que está chegando', () => {
      obs.handle({ type: 'autoStart', source: 'terminal' });
      obs.handle({ type: 'peer', role: 'user', text: 'mais uma coisa' });
      obs.handle({ type: 'delta', text: 'continuo' });

      assert.deepEqual(chat.log, ['abriu bolha', 'fala no feed', 'evento:delta']);
      assert.equal(chat.bolhas, 1);
    });
  });

  describe('agente em segundo plano', () => {
    it('chega pelo canal e vai para os agentes da conversa, sem abrir bolha', () => {
      obs.handle({ type: 'agentStart', id: 'a1', name: 'Lane 1' });
      obs.handle({ type: 'agentEnd', id: 'a1', result: 'fechou' });

      assert.deepEqual(chat.log, ['agente:agentStart', 'agente:agentEnd']);
      assert.equal(chat.bolhas, 0);
    });

    it('com um turno aberto, o bloco entra na bolha dele', () => {
      obs.handle({ type: 'autoStart', source: 'terminal' });
      obs.handle({ type: 'agentStart', id: 'a1', name: 'Lane 1' });

      assert.deepEqual(chat.log, ['abriu bolha', 'evento:agentStart']);
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

  describe('o canal caiu e voltou', () => {
    it('a primeira conexão não relê nada', () => {
      obs.handle({ type: 'hello', busy: false, pending: 0 });
      assert.deepEqual(chat.log, ['busy:false']);
    });

    it('a segunda pede para reler a conversa do disco', () => {
      obs.handle({ type: 'hello', busy: false, pending: 0 });
      obs.handle({ type: 'hello', busy: false, pending: 0 });
      assert.deepEqual(chat.log, ['busy:false', 'busy:false', 'releu do disco']);
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
