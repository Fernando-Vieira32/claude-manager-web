// O que pode acontecer quando uma resposta termina — a regra que impede a tela de
// apagar informação que o usuário precisava ver (public/js/core/response-end.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { afterResponse, turnOnDisk, waitTurnOnDisk } from '../public/js/core/response-end.js';

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

// O bug que isto impede: a resposta terminava de ser escrita na tela, o feed recarregava
// na hora, e o disco ainda não tinha a resposta — ela desaparecia, e o que sobrava era a
// resposta ANTERIOR acima da mensagem recém-enviada. Reabrir a conversa "consertava".
describe('turnOnDisk', () => {
  const ENVIO = Date.parse('2026-08-31T14:18:07.000Z');
  const antes = { role: 'assistant', at: '2026-08-31T14:11:21.000Z' };
  const depois = { role: 'assistant', at: '2026-08-31T14:18:26.000Z' };

  describe('sem envio pendente', () => {
    it('o disco é confiável e não há o que esperar', () => {
      assert.equal(turnOnDisk(undefined, 0), true);
    });
  });

  describe('com envio pendente', () => {
    it('a última do disco ainda é a MINHA mensagem: o turno não chegou', () => {
      assert.equal(turnOnDisk({ role: 'user', at: '2026-08-31T14:18:07.500Z' }, ENVIO), false);
    });

    it('a última é a resposta ANTERIOR: também não chegou (era o bug na tela)', () => {
      assert.equal(turnOnDisk(antes, ENVIO), false);
    });

    it('a última é uma resposta posterior ao envio: chegou', () => {
      assert.equal(turnOnDisk(depois, ENVIO), true);
    });

    it('disco sem mensagem nenhuma: não chegou', () => {
      assert.equal(turnOnDisk(undefined, ENVIO), false);
    });

    it('resposta sem data legível: aceita, para não travar o recarregamento para sempre', () => {
      assert.equal(turnOnDisk({ role: 'assistant', at: 'ontem' }, ENVIO), true);
    });
  });
});

describe('waitTurnOnDisk', () => {
  const ENVIO = 1_000_000;
  const chegou = { role: 'assistant', at: new Date(ENVIO + 500).toISOString() };
  const naoChegou = { role: 'user', at: new Date(ENVIO + 10).toISOString() };

  /** Disco que só passa a ter o turno depois de `n` consultas. */
  function discoQueDemora(n) {
    const dormidas = [];
    let consultas = 0;
    return {
      dormidas,
      consultas: () => consultas,
      fetchLast: async () => { consultas += 1; return consultas > n ? chegou : naoChegou; },
      sleep: async (ms) => { dormidas.push(ms); },
    };
  }

  describe('o turno aparece na terceira consulta', () => {
    it('devolve true e dorme só as duas vezes necessárias', async () => {
      const disco = discoQueDemora(2);
      const ok = await waitTurnOnDisk({ ...disco, sentAt: ENVIO, waitMs: 150 });
      assert.equal(ok, true);
      assert.equal(disco.consultas(), 3);
      assert.deepEqual(disco.dormidas, [150, 150]);
    });
  });

  describe('o turno nunca aparece', () => {
    it('devolve false — quem chamou NÃO recarrega, e a tela mantém a resposta', async () => {
      const disco = discoQueDemora(Infinity);
      const ok = await waitTurnOnDisk({ ...disco, sentAt: ENVIO, tries: 4, waitMs: 10 });
      assert.equal(ok, false);
      assert.equal(disco.consultas(), 4);
      assert.equal(disco.dormidas.length, 3);   // não dorme depois da última tentativa
    });
  });

  describe('sem envio pendente', () => {
    it('nem consulta o disco: recarregar é seguro', async () => {
      const disco = discoQueDemora(Infinity);
      const ok = await waitTurnOnDisk({ ...disco, sentAt: 0 });
      assert.equal(ok, true);
      assert.equal(disco.consultas(), 0);
    });
  });
});
