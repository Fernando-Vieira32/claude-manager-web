// Quando um processo vivo pode ser reaproveitado (services/chat/runners.js).
//
// É a regra que faz a segunda mensagem de uma conversa NOVA funcionar: havendo runner
// vivo, ninguém precisa (nem pode) ler o transcript, que ainda não existe.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRunnerRegistry } from '../services/chat/runners.js';

const ID = 'projeto:11111111-2222-3333-4444-555555555555';
const runner = ({ signature = 'none|', alive = true, busy = false, working = busy } = {}) => ({
  conversationId: ID, signature, alive, busy, working, pid: 42, pending: busy ? 1 : 0,
});

describe('createRunnerRegistry', () => {
  describe('conversa sem processo', () => {
    it('não tem o que reaproveitar', () => {
      assert.equal(createRunnerRegistry().reusable(ID, 'none|'), null);
    });
  });

  describe('processo vivo com a MESMA assinatura', () => {
    const reg = createRunnerRegistry();
    const vivo = runner();
    reg.remember(ID, vivo);

    it('devolve o próprio processo, mesmo respondendo (a mensagem entra na fila dele)', () => {
      vivo.busy = true;
      assert.equal(reg.reusable(ID, 'none|'), vivo);
    });

    it('e também quando está ocioso (processo quente)', () => {
      vivo.busy = false;
      assert.equal(reg.reusable(ID, 'none|'), vivo);
    });
  });

  describe('assinatura diferente', () => {
    it('respondendo: recusa com 409 em vez de trocar o modo no meio', () => {
      const reg = createRunnerRegistry();
      reg.remember(ID, runner({ signature: 'none|', busy: true }));
      assert.throws(() => reg.reusable(ID, 'auto|'), (err) => {
        assert.equal(err.status, 409);
        assert.match(err.message, /outro modo\/modelo/);
        return true;
      });
    });

    it('ocioso: não reaproveita, mas também não recusa — quem chamou troca o processo', () => {
      const reg = createRunnerRegistry();
      reg.remember(ID, runner({ signature: 'none|' }));
      assert.equal(reg.reusable(ID, 'auto|'), null);
    });
  });

  describe('processo já morto', () => {
    const reg = createRunnerRegistry();
    reg.remember(ID, runner({ alive: false }));

    it('não é reaproveitado nem com a mesma assinatura', () => {
      assert.equal(reg.reusable(ID, 'none|'), null);
    });
  });

  describe('esquecer', () => {
    it('esquece o runner que está registrado', () => {
      const reg = createRunnerRegistry();
      const velho = runner();
      reg.remember(ID, velho).forget(ID, velho);
      assert.equal(reg.get(ID), undefined);
    });

    it('NÃO apaga o substituto quando o antigo sai depois (a ordem inverte na prática)', () => {
      const reg = createRunnerRegistry();
      const velho = runner();
      const novo = runner({ signature: 'auto|' });
      reg.remember(ID, velho).remember(ID, novo);
      reg.forget(ID, velho);           // o `onExit` do velho chega atrasado
      assert.equal(reg.get(ID), novo);
    });
  });

  // O bug que isto tranca: `paused` do seguidor do .jsonl perguntava `alive`. Um runner
  // OCIOSO (ele sobrevive minutos depois da última resposta) calava o seguidor enquanto a
  // conversa seguia sendo conduzida NO TERMINAL — e as linhas do terminal eram puladas para
  // sempre. Na tela, quatro agentes com relógio correndo; no terminal, já terminados.
  describe('está trabalhando agora?', () => {
    it('processo vivo mas OCIOSO não está trabalhando (então não cala o seguidor)', () => {
      const reg = createRunnerRegistry();
      reg.remember(ID, runner({ alive: true, working: false }));
      assert.equal(reg.working(ID), false);
    });

    it('processo trabalhando está trabalhando', () => {
      const reg = createRunnerRegistry();
      reg.remember(ID, runner({ working: true }));
      assert.equal(reg.working(ID), true);
    });

    it('conversa sem processo nenhum', () => {
      assert.equal(createRunnerRegistry().working(ID), false);
    });
  });

  describe('listar', () => {
    it('devolve os processos vivos e os ociosos, sem duplicar por conversa', () => {
      const reg = createRunnerRegistry();
      reg.remember(ID, runner()).remember(ID, runner({ signature: 'auto|' }));
      reg.remember('outra:2', runner());
      assert.equal(reg.list().length, 2);
    });
  });
});
