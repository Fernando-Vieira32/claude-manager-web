// O quadro de avisos por conversa (`services/chat/channel.js`): o que não pertence a um
// turno nosso — turno que o CLI começou sozinho, `busy`, `gone` — precisa chegar a quem
// estiver ouvindo, sem depender de o processo estar vivo.
//
// O canal só usa `send(evento)` e `closed` de um inscrito, então aqui o inscrito é um
// coletor. Cada teste usa uma conversa própria: o mapa é de módulo, como em produção.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { subscribe, publish, subscriberCount } from '../services/chat/channel.js';

let seq = 0;
const conversa = () => `-tmp-canal:sessao-${(seq += 1)}`;

function fakeSse() {
  const events = [];
  const sse = {
    events,
    closed: false,
    send: (e) => events.push(e),
    types: () => events.map((e) => e.type),
  };
  return sse;
}

describe('canal da conversa', () => {
  it('publicar sem inscrito não estoura e não entrega a ninguém', () => {
    assert.equal(publish(conversa(), { type: 'autoStart' }), 0);
  });

  it('dois inscritos recebem o mesmo evento', () => {
    const id = conversa();
    const a = fakeSse();
    const b = fakeSse();
    subscribe(id, a);
    subscribe(id, b);

    assert.equal(publish(id, { type: 'autoStart' }), 2);
    assert.deepEqual(a.types(), ['autoStart']);
    assert.deepEqual(b.types(), ['autoStart']);
  });

  it('cada conversa tem o seu canal', () => {
    const um = conversa();
    const outro = conversa();
    const a = fakeSse();
    subscribe(um, a);
    publish(outro, { type: 'gone' });
    assert.deepEqual(a.types(), []);
  });

  it('desinscrever para de receber', () => {
    const id = conversa();
    const a = fakeSse();
    const off = subscribe(id, a);

    off();
    assert.equal(publish(id, { type: 'busy', busy: true, pending: 0 }), 0);
    assert.deepEqual(a.types(), []);
    assert.equal(subscriberCount(id), 0);
  });

  // aba fechada não deixa lixo no mapa: quem publica é quem faz a limpeza
  it('SSE já fechado sai da lista sozinho', () => {
    const id = conversa();
    const morto = fakeSse();
    const vivo = fakeSse();
    subscribe(id, morto);
    subscribe(id, vivo);

    morto.closed = true;
    assert.equal(publish(id, { type: 'autoEnd' }), 1);
    assert.equal(subscriberCount(id), 1);
    assert.deepEqual(morto.types(), []);
    assert.deepEqual(vivo.types(), ['autoEnd']);
  });

  it('inscrito que estoura ao escrever também sai da lista', () => {
    const id = conversa();
    const quebrado = { closed: false, send: () => { throw new Error('escrita em conexão morta'); } };
    subscribe(id, quebrado);

    assert.equal(publish(id, { type: 'gone' }), 0);
    assert.equal(subscriberCount(id), 0);
  });
});
