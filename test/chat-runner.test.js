// O processo vivo por conversa (`services/chat/runner.js`): mandar mensagem enquanto o
// Claude responde tem de sair NA HORA para o stdin — a fila é do CLI, não nossa — e o
// turno que o CLI começa SOZINHO (subagente de segundo plano que volta) não pode ter a
// saída descartada, como acontecia quando "a linha era sempre da cabeça da fila".
//
// O `spawn` é injetado, então isto prova o comportamento sem chamar o CLI de verdade:
// um EventEmitter com stdout/stderr falsos e um stdin que só acumula o que foi escrito.
// O `publish` (canal da conversa) também é injetado — o canal de verdade tem spec só dele.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSandbox } from './helpers/sandbox.js';

let box, runnerMod;

before(async () => {
  box = await createSandbox();
  runnerMod = await import('../services/chat/runner.js');
});
after(() => box.cleanup());

/** Processo de mentira: `say()` empurra uma linha no stdout, `die()` encerra. */
function fakeProcess() {
  const proc = new EventEmitter();
  proc.pid = 4242;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.written = [];
  proc.stdinEnded = false;
  proc.stdin = {
    write: (line) => { proc.written.push(line); return true; },
    end: () => { proc.stdinEnded = true; },
  };
  proc.killed = null;
  proc.kill = (sinal) => { proc.killed = sinal; };
  proc.say = (obj) => proc.stdout.emit('data', `${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`);
  proc.die = (code = 1) => proc.emit('close', code, null);
  return proc;
}

/** Coletor no lugar do SSE. */
function fakeSse() {
  const events = [];
  const sse = {
    events,
    closed: false,
    send: (e) => events.push(e),
    close: () => { sse.closed = true; },
    types: () => events.map((e) => e.type),
    last: () => events[events.length - 1],
    of: (type) => events.find((e) => e.type === type),
  };
  return sse;
}

const resultLine = (extra = {}) => ({ type: 'result', subtype: 'success', result: 'ok', ...extra });
const deltaLine = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const textLine = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

/** Falha rápido em vez de pendurar a suíte quando o turno não resolve. */
const withTimeout = (p, ms = 500) => Promise.race([
  p,
  new Promise((_, reject) => setTimeout(() => reject(new Error('a promessa do turno não resolveu')), ms)),
]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc, runner, exits, published;

function given({ idleMs = 60_000, turnTimeoutMs = 60_000, quietMs = 60_000, giveUpMs = 60_000 } = {}) {
  proc = fakeProcess();
  exits = 0;
  published = [];
  runner = runnerMod.createRunner({
    conversationId: '-tmp-teste:sessao-1',
    sessionId: 'sessao-1',
    cwd: '/tmp/teste',
    mode: 'none',
    signature: 'none|',
    args: ['-p', '--input-format', 'stream-json'],
    spawn: () => proc,
    idleMs,
    turnTimeoutMs,
    quietMs,
    giveUpMs,
    publish: (event) => published.push(event),
    onExit: () => { exits += 1; },
  });
  return runner;
}

function send(sse, text) {
  return runner.send({ text, images: [], sse, kind: 'message' });
}

/** O que foi ao canal da conversa. `busy` é ruído nas asserções de sequência. */
const chan = () => published.map((e) => e.type);
const chanNoBusy = () => published.filter((e) => e.type !== 'busy').map((e) => e.type);
const chanOf = (type) => published.find((e) => e.type === type);

describe('mandar mensagem durante a resposta', () => {
  let sse1, sse2, turno1, turno2;

  beforeEach(() => {
    given();
    sse1 = fakeSse();
    sse2 = fakeSse();
    turno1 = send(sse1, 'primeira');
    turno2 = send(sse2, 'segunda');
  });

  // o ponto da mudança: nada fica preso no servidor esperando o turno anterior
  it('escreve as DUAS linhas no stdin na hora, com o turno 1 em voo', () => {
    assert.equal(proc.written.length, 2);
    assert.match(proc.written[0], /"primeira"/);
    assert.match(proc.written[1], /"segunda"/);
  });

  it('a linha do stdin é uma mensagem de usuário em stream-json', () => {
    const linha = JSON.parse(proc.written[0]);
    assert.equal(linha.type, 'user');
    assert.deepEqual(linha.message, { role: 'user', content: [{ type: 'text', text: 'primeira' }] });
  });

  // o `turnStart` mudou de hora: no envio ninguém sabe se a próxima linha é deste turno
  // ou de um que o CLI começou sozinho
  it('o turnStart sai na primeira linha do turno, não no envio', () => {
    assert.deepEqual(sse1.types(), ['init']);
    proc.say(deltaLine('oi'));
    assert.deepEqual(sse1.types(), ['init', 'turnStart', 'delta']);
  });

  it('quem chega atrás sabe quantos estão na frente', () => {
    assert.deepEqual(sse2.types(), ['init', 'queued']);
    assert.equal(sse2.of('queued').ahead, 1);
  });

  it('os eventos do turno em voo não vazam para quem espera', () => {
    proc.say(deltaLine('oi'));
    assert.deepEqual(sse1.types(), ['init', 'turnStart', 'delta']);
    assert.deepEqual(sse2.types(), ['init', 'queued']);
  });

  it('o result fecha o SSE daquele turno e resolve a promessa dele', async () => {
    proc.say(resultLine());
    await withTimeout(turno1);
    assert.deepEqual(sse1.types().slice(-2), ['result', 'done']);
    assert.equal(sse1.closed, true);
    assert.equal(sse2.closed, false);
  });

  it('o turno seguinte assume e passa a receber os eventos', async () => {
    proc.say(resultLine());
    await withTimeout(turno1);
    assert.deepEqual(sse2.types(), ['init', 'queued']);

    proc.say(deltaLine('sua vez'));
    assert.deepEqual(sse2.types(), ['init', 'queued', 'turnStart', 'delta']);
    assert.equal(sse2.last().text, 'sua vez');

    proc.say(resultLine());
    await withTimeout(turno2);
    assert.equal(sse2.closed, true);
  });

  it('a conversa deixa de estar respondendo quando a fila esvazia', async () => {
    assert.equal(runner.busy, true);
    assert.equal(runner.pending, 2);
    proc.say(resultLine());
    proc.say(resultLine());
    await withTimeout(Promise.all([turno1, turno2]));
    assert.equal(runner.busy, false);
    assert.equal(runner.pending, 0);
  });
});

// O bug de verdade: o CLI enfileira um `<task-notification>` quando um subagente de
// segundo plano termina e abre um turno NOVO por conta própria. Sem SSE dono, tudo o que
// ele produzia ia para o lixo.
describe('turno que o CLI começa sozinho', () => {
  it('linha com a fila vazia nasce como turno espontâneo no canal, e nada é descartado', () => {
    given();
    proc.say(deltaLine('voltei do agente'));
    proc.say(textLine('relatório do subagente'));
    proc.say(resultLine());

    assert.deepEqual(chanNoBusy(), ['autoStart', 'delta', 'message', 'result', 'autoEnd']);
    assert.equal(chanOf('delta').text, 'voltei do agente');
    assert.equal(chanOf('message').text, 'relatório do subagente');
  });

  it('a fila vazia com turno espontâneo em curso é busy — e o canal avisa', () => {
    given();
    assert.equal(runner.busy, false);
    proc.say(deltaLine('trabalhando'));
    assert.equal(runner.busy, true);
    assert.equal(runner.auto, true);
    assert.equal(runner.pending, 0);
    assert.deepEqual(chanOf('busy'), { type: 'busy', busy: true, pending: 0 });
  });

  it('o result dele NÃO fecha nem consome um turno nosso que espera', async () => {
    given();
    proc.say(deltaLine('voltei do agente'));   // espontâneo em curso
    const sse = fakeSse();
    let resolvido = false;
    const turno = send(sse, 'minha pergunta');
    turno.then(() => { resolvido = true; });

    assert.deepEqual(sse.types(), ['init', 'queued']);
    assert.equal(sse.of('queued').ahead, 1);

    proc.say(resultLine({ result: 'resposta ao subagente' }));
    await Promise.resolve();
    assert.equal(resolvido, false, 'o result do espontâneo não pode resolver o nosso turno');
    assert.equal(sse.closed, false);
    assert.deepEqual(sse.types(), ['init', 'queued']);
    assert.equal(runner.pending, 1);
    assert.equal(chanOf('result').text, 'resposta ao subagente');
  });

  it('o turno nosso só começa depois do autoEnd, e aí recebe a resposta dele', async () => {
    given();
    proc.say(deltaLine('voltei do agente'));
    const sse = fakeSse();
    const turno = send(sse, 'minha pergunta');
    proc.say(resultLine());
    assert.deepEqual(chanNoBusy().slice(-1), ['autoEnd']);

    proc.say(deltaLine('agora sim'));
    assert.deepEqual(sse.types(), ['init', 'queued', 'turnStart', 'delta']);
    proc.say(resultLine({ result: 'a sua resposta' }));
    await withTimeout(turno);
    assert.equal(sse.of('result').text, 'a sua resposta');
    assert.equal(sse.closed, true);
  });

  it('o canal avisa que o processo encerrou, e o turno espontâneo em voo termina', () => {
    given();
    proc.say(deltaLine('trabalhando'));
    proc.die(0);
    assert.deepEqual(chanNoBusy().slice(-2), ['autoEnd', 'gone']);
    assert.deepEqual(chan().slice(-2), ['busy', 'gone']);
    assert.equal(published.at(-2).busy, false);
  });
});

describe('working (o processo está trabalhando?)', () => {
  it('continua verdadeiro no rastro da última linha e cai depois do silêncio', async () => {
    given({ quietMs: 20 });
    proc.say(deltaLine('x'));
    proc.say(resultLine());
    assert.equal(runner.busy, false);
    assert.equal(runner.working, true, 'linha recém-escrita é sinal de vida');
    await wait(45);
    assert.equal(runner.working, false);
  });

  it('turno na fila é trabalho, mesmo sem uma linha sequer', () => {
    given({ quietMs: 1 });
    send(fakeSse(), 'oi');
    assert.equal(runner.working, true);
  });
});

describe('interromper', () => {
  it('escreve o control_request e o turno cortado sai como interrompido', async () => {
    given();
    const sse = fakeSse();
    const turno = send(sse, 'faz aí');

    assert.equal(runner.interrupt(), true);
    const pedido = JSON.parse(proc.written[1]);
    assert.equal(pedido.type, 'control_request');
    assert.equal(pedido.request.subtype, 'interrupt');

    proc.say({ type: 'control_response', response: { subtype: 'success' } });
    proc.say(resultLine({ subtype: 'error_during_execution', is_error: true, result: '' }));
    await withTimeout(turno);

    const result = sse.of('result');
    assert.equal(result.subtype, 'interrupted');
    assert.equal(result.ok, false);
    assert.match(result.message, /interrompido/);
  });

  // o CLI não descarta o que está no stdin: o próximo turno continua valendo
  it('não descarta quem está na fila', async () => {
    given();
    const sse1 = fakeSse();
    const sse2 = fakeSse();
    const turno1 = send(sse1, 'longa');
    send(sse2, 'a próxima');

    runner.interrupt();
    proc.say(resultLine({ subtype: 'error_during_execution', is_error: true }));
    await withTimeout(turno1);

    assert.equal(sse2.closed, false);
    proc.say(deltaLine('sua vez'));
    assert.deepEqual(sse2.types(), ['init', 'queued', 'turnStart', 'delta']);
  });

  it('interrompe o turno espontâneo, que é o que está rodando', () => {
    given();
    proc.say(deltaLine('agente'));
    assert.equal(runner.interrupt(), true);
    assert.equal(JSON.parse(proc.written[0]).request.subtype, 'interrupt');

    proc.say(resultLine({ subtype: 'error_during_execution', is_error: true }));
    assert.equal(chanOf('result').subtype, 'interrupted');
  });

  it('sem turno nenhum não há o que interromper', () => {
    given();
    assert.equal(runner.interrupt(), false);
    assert.equal(proc.written.length, 0);
  });
});

describe('o processo morrer no meio', () => {
  it('todo turno pendente recebe error e done, e o runner sai do mapa', async () => {
    given();
    const sse1 = fakeSse();
    const sse2 = fakeSse();
    const turnos = Promise.all([send(sse1, 'a'), send(sse2, 'b')]);

    proc.die(1);
    await withTimeout(turnos);

    for (const sse of [sse1, sse2]) {
      assert.deepEqual(sse.types().slice(-2), ['error', 'done']);
      assert.match(sse.of('error').message, /encerrou/);
      assert.equal(sse.closed, true);
    }
    assert.equal(runner.alive, false);
    assert.equal(exits, 1);
  });
});

describe('ociosidade e tempo limite', () => {
  it('fila vazia fecha o stdin, e o processo sai sozinho', async () => {
    given({ idleMs: 15 });
    const sse = fakeSse();
    const turno = send(sse, 'oi');
    proc.say(resultLine());
    await withTimeout(turno);

    assert.equal(proc.stdinEnded, false, 'não pode fechar antes de o turno acabar');
    await wait(40);
    assert.equal(proc.stdinEnded, true);
  });

  it('mensagem nova cancela a ociosidade', async () => {
    given({ idleMs: 30 });
    const primeiro = fakeSse();
    const turno = send(primeiro, 'oi');
    proc.say(resultLine());
    await withTimeout(turno);

    await wait(15);
    send(fakeSse(), 'de novo');
    await wait(40);
    assert.equal(proc.stdinEnded, false);
  });

  // era o item 3 do bug: o temporizador armado "quando a fila esvazia" fechava o stdin no
  // meio de um turno espontâneo de vários minutos
  it('não fecha o stdin enquanto a saída continua chegando', async () => {
    given({ idleMs: 20 });
    proc.say(deltaLine('agente trabalhando'));
    for (let i = 0; i < 4; i += 1) {
      await wait(12);
      proc.say(deltaLine(`passo ${i}`));
    }
    assert.equal(proc.stdinEnded, false);
    assert.equal(runner.busy, true);
  });

  // silêncio NÃO é fim de turno: o CLI pode ficar minutos pensando sem escrever nada, e
  // fechar o stdin ali cortaria o trabalho no meio
  it('turno em curso sem saída nenhuma também não fecha o stdin', async () => {
    given({ idleMs: 15 });
    proc.say(deltaLine('agente'));
    await wait(45);
    assert.equal(proc.stdinEnded, false);
    assert.equal(runner.auto, true);
  });

  it('fecha o stdin depois do silêncio, quando não sobrou turno', async () => {
    given({ idleMs: 20 });
    proc.say(deltaLine('agente trabalhando'));
    proc.say(resultLine());
    assert.equal(proc.stdinEnded, false);
    await wait(50);
    assert.equal(proc.stdinEnded, true);
  });

  // matar o processo levaria embora a fila e a sessão quente: o turno estourado é
  // apenas interrompido
  it('turno que estoura o tempo limite é interrompido, não morto', async () => {
    given({ turnTimeoutMs: 15 });
    const sse = fakeSse();
    send(sse, 'demora');

    await wait(40);
    assert.match(sse.of('notice').message, /tempo limite/);
    assert.equal(JSON.parse(proc.written[1]).request.subtype, 'interrupt');
    assert.equal(proc.stdinEnded, false);
    assert.equal(runner.alive, true);
  });

  it('tempo limite do turno espontâneo avisa no canal e não mata o processo', async () => {
    given({ turnTimeoutMs: 15 });
    proc.say(deltaLine('agente'));

    await wait(40);
    assert.match(chanOf('notice').message, /tempo limite/);
    assert.equal(JSON.parse(proc.written[0]).request.subtype, 'interrupt');
    assert.equal(proc.stdinEnded, false);
    assert.equal(runner.alive, true);
  });
});

// Visto na prática: CLI mudo às 08:54, nenhum `result` depois, e a conversa ficou presa —
// todo envio caindo em 409 ou numa fila atrás de um turno morto. Interromper é PEDIR;
// sem prazo, quem não responde bloqueia a conversa para sempre.
describe('turno que não fecha nem depois do interrupt', () => {
  it('passado o prazo, fecha o stdin — que é como um processo saudável sai', async () => {
    given({ turnTimeoutMs: 10, giveUpMs: 40 });
    send(fakeSse(), 'trava');

    await wait(70);
    assert.equal(proc.stdinEnded, true);
    assert.equal(proc.killed, null, 'não mata antes de pedir para sair');
  });

  it('se nem fechar o stdin resolve, manda SIGTERM', async () => {
    given({ turnTimeoutMs: 10, giveUpMs: 40 });
    send(fakeSse(), 'trava');

    await wait(130);
    assert.equal(proc.killed, 'SIGTERM');
  });

  it('e ao sair, a fila é liberada: a conversa deixa de estar ocupada', async () => {
    given({ turnTimeoutMs: 10, giveUpMs: 40 });
    const sse = fakeSse();
    const turno = send(sse, 'trava');

    await wait(70);
    proc.die(143);
    await withTimeout(turno);
    assert.equal(runner.busy, false);
    assert.equal(runner.pending, 0);
  });

  // O outro lado da moeda: o interrupt FUNCIONOU e o CLI fechou o turno dentro do prazo.
  // Aqui o relógio da desistência está armado — e desarmá-lo é o que separa "processo
  // travado" de "processo saudável que foi interrompido".
  it('CLI que atende ao interrupt no prazo continua vivo', async () => {
    given({ turnTimeoutMs: 10, giveUpMs: 40 });
    const turno = send(fakeSse(), 'demora mas obedece');

    await wait(25);                 // tempo limite já estourou: prazo da desistência correndo
    proc.say(resultLine({ subtype: 'interrupted' }));
    await withTimeout(turno);

    await wait(80);                 // passa da hora em que a desistência agiria
    assert.equal(proc.stdinEnded, false);
    assert.equal(proc.killed, null);
  });
});

describe('stderr e imagens', () => {
  it('stderr do CLI vira aviso no turno em voo', () => {
    given();
    const sse = fakeSse();
    send(sse, 'oi');
    proc.stderr.emit('data', '  algum aviso  ');
    assert.equal(sse.last().type, 'notice');
    assert.match(sse.last().message, /algum aviso/);
  });

  it('stderr durante um turno espontâneo vai para o canal', () => {
    given();
    proc.say(deltaLine('agente'));
    proc.stderr.emit('data', 'aviso do CLI');
    assert.match(chanOf('notice').message, /aviso do CLI/);
  });

  it('imagem vai como bloco base64 na mesma linha da mensagem', () => {
    given();
    const sse = fakeSse();
    runner.send({
      text: 'que erro é esse?',
      images: [{ media_type: 'image/png', data: 'AAAA' }],
      sse,
      kind: 'message',
    });

    const content = JSON.parse(proc.written[0]).message.content;
    assert.deepEqual(content.map((b) => b.type), ['text', 'image']);
    assert.deepEqual(content[1].source, { type: 'base64', media_type: 'image/png', data: 'AAAA' });
    assert.equal(sse.of('init').images, 1);
  });
});
