// Um processo `claude` VIVO por conversa — e o TURNO CORRENTE dele.
//
// Escrever no stdin durante um turno é aceito na hora: o PRÓPRIO CLI enfileira o turno
// seguinte. Mas ele também COMEÇA TURNOS SOZINHO — subagente de segundo plano que
// termina vira um `<task-notification>` enfileirado como se fosse mensagem do usuário
// (readme/10-chat.md). Isso derrubou o desenho antigo ("a linha é sempre do turno da
// CABEÇA da fila"): turno que nasce sozinho não tem SSE dono e TODA a saída dele ia
// para o lixo, com a tela congelada e o Claude ainda trabalhando.
//
// Daí o turno CORRENTE explícito: NOSSO (veio de `send`) ou ESPONTÂNEO (nasceu no CLI),
// e o espontâneo fala pelo canal da conversa (`channel.js`), que não é de ninguém.
//
// Não conhece rota nem HTTP: recebe `args` prontos, um `sse` por turno, um `publish`
// para o canal e (para o teste) o próprio `spawn`.

import { forward } from './stream.js';
import { startChild } from './child.js';
import { createTimers } from './timers.js';
import { publish as publishToChannel } from './channel.js';
import { userLine, interruptLine } from './protocol.js';

const TURN_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 15 * 60 * 1000);
const IDLE_MS = Number(process.env.CHAT_IDLE_MS || 5 * 60 * 1000);
const QUIET_MS = Number(process.env.CHAT_QUIET_MS || 30 * 1000);
const GIVE_UP_MS = Number(process.env.CHAT_GIVEUP_MS || 30 * 1000);

export function createRunner({
  conversationId, sessionId, cwd, args, signature, mode, spawn,
  idleMs = IDLE_MS, turnTimeoutMs = TURN_TIMEOUT_MS, quietMs = QUIET_MS, giveUpMs = GIVE_UP_MS,
  publish = (event) => publishToChannel(conversationId, event), onExit,
}) {
  const queue = [];   // turnos NOSSOS em ordem de chegada; [0] é o mais antigo
  const exits = [];   // quem espera o processo sair (close())
  const channelSink = { send: (event) => publish(event) };
  let current = null; // { turn } (nosso) | { auto: true } (nasceu no CLI) | null
  let alive = true;
  let reqSeq = 0;
  let sentSpawnError = false;
  let lastOutputAt = Date.now();
  let told = { busy: null, pending: null };
  let desistindo = false;   // já pedimos ao processo que saia; o próximo passo é matar

  const isAuto = () => Boolean(current?.auto);
  const isBusy = () => queue.length > 0 || isAuto();
  /** Trabalhando = tem turno OU acabou de escrever algo (subagente também escreve). */
  const isWorking = () => isBusy() || Date.now() - lastOutputAt < quietMs;

  /** Para onde vão os eventos do turno corrente: o SSE dele, ou o canal se nasceu sozinho. */
  const sink = () => (current ? (current.turn ? current.turn.sse : channelSink) : null);
  /** Quem ouve um aviso que não é de turno nenhum (stderr, tempo limite antes da 1ª linha). */
  const anySink = () => sink() || queue[0]?.sse;

  /** O painel só mantém o "Parar" honesto se souber quando isto muda. */
  function tellBusy() {
    const busy = isBusy();
    if (busy === told.busy && queue.length === told.pending) return;
    told = { busy, pending: queue.length };
    publish({ type: 'busy', busy, pending: queue.length });
  }

  const timers = createTimers({
    idleMs,
    turnTimeoutMs,
    giveUpMs,
    hasWork: () => Boolean(queue.length || current),
    onIdle: () => child.stdin.end(),
    onTurnTimeout: () => {
      anySink()?.send({ type: 'notice', message: 'tempo limite do turno excedido; interrompendo' });
      interrupt();
      timers.startGiveUp();   // interromper é PEDIR; alguém tem de cobrar a resposta
    },
    onGiveUp: () => giveUp(),
  });

  /**
   * O CLI não fechou o turno nem depois do interrupt. Aconteceu de verdade: última linha
   * às 08:54, nenhum `result` depois, e a conversa ficou presa — cada envio caía em 409
   * ("respondendo com outro modo") ou numa fila atrás de um turno morto, sem saída pela
   * tela. Então paramos de esperar por ele: primeiro fechando o stdin, que é como um
   * processo saudável sai; se nem isso, SIGTERM. Sair libera a fila no `onClose`.
   */
  function giveUp() {
    if (!alive) return;
    if (desistindo) { child.kill?.('SIGTERM'); return; }
    desistindo = true;
    child.stdin.end();
    timers.startGiveUp();
  }

  /** Chegou linha e ninguém é dono: ou é a vez do primeiro da fila, ou o turno nasceu sozinho. */
  function beginCurrent() {
    if (queue.length) {
      current = { turn: queue[0] };
      queue[0].sse.send({ type: 'turnStart' });
    } else {
      current = { auto: true };
      publish({ type: 'autoStart' });
    }
    timers.startTurn();
    tellBusy();
  }

  /** O `result` fecha o turno CORRENTE — e só ele: nada de encerrar quem nem começou. */
  function finishCurrent(line, parsed) {
    timers.endTurn();
    desistindo = false;
    const ending = current;
    current = null;
    // turno cortado pelo "Parar": o CLI devolve `error_during_execution`, que para quem
    // clicou seria mentira. Trocamos por `interrupted`.
    const cut = ending.turn ? ending.turn.interrupted : ending.interrupted;
    const linha = cut ? JSON.stringify({ ...parsed, subtype: 'interrupted' }) : line;
    if (ending.turn) {
      const turn = queue.shift();
      forward(linha, turn.sse);
      turn.sse.send({ type: 'done', code: null });
      turn.sse.close();
      turn.resolve();
    } else {
      forward(linha, channelSink);
      publish({ type: 'autoEnd' });
    }
    timers.keepAwake();
    tellBusy();
  }

  function handleLine(line) {
    if (!line.trim()) return;   // linha vazia não é sinal de vida nem começa turno
    lastOutputAt = Date.now();
    timers.keepAwake();
    if (!current) beginCurrent();
    let parsed = null;
    try { parsed = JSON.parse(line.trim()); } catch { /* linha não-JSON: forward trata */ }
    if (parsed?.type === 'result') return finishCurrent(line, parsed);
    forward(line, sink());
  }

  function onStderr(text) {
    const target = anySink();
    if (text && target) target.send({ type: 'notice', message: text.slice(0, 500) });
  }

  function onSpawnError(message) {
    sentSpawnError = true;
    for (const turn of queue) turn.sse.send({ type: 'error', message });
  }

  /** Processo saiu: quem estava esperando não pode ficar pendurado para sempre. */
  function onClose(code, signal) {
    alive = false;
    timers.stop();
    if (isAuto()) publish({ type: 'autoEnd' });
    current = null;
    for (const turn of queue.splice(0)) {
      if (!sentSpawnError) {
        turn.sse.send({ type: 'error', message: `o processo do claude encerrou antes de responder (code ${code})` });
      }
      turn.sse.send({ type: 'done', code, signal: signal || null });
      turn.sse.close();
      turn.resolve();
    }
    tellBusy();
    publish({ type: 'gone' });
    onExit?.();
    for (const resolve of exits.splice(0)) resolve();
  }

  /**
   * Enfileira um turno e escreve a mensagem no stdin JÁ. O `turnStart` NÃO sai daqui: sai
   * na primeira linha DESTE turno, porque só então se sabe que o CLI responde a ele.
   * @returns {Promise<void>} resolve quando o `result` deste turno chegar.
   */
  function send({ text = '', images = [], sse, kind = 'message' }) {
    if (!alive) throw new Error('o processo desta conversa já encerrou');
    timers.holdAwake();
    sse.send({ type: 'init', conversationId, sessionId, cwd, mode, kind, images: images.length, pid: child.pid });
    const ahead = (isAuto() ? 1 : 0) + queue.length;
    if (ahead) sse.send({ type: 'queued', ahead });
    const turn = { sse, resolve: null, interrupted: false };
    const done = new Promise((resolve) => { turn.resolve = resolve; });
    queue.push(turn);
    child.stdin.write(userLine(text, images));
    // nada em curso: o relógio do tempo limite começa agora, senão um turno que nunca
    // escreve linha nenhuma ficaria pendurado sem quem o estourasse
    if (!current && queue.length === 1) timers.startTurn();
    tellBusy();
    return done;
  }

  /** Corta o turno CORRENTE (nosso ou espontâneo). NÃO descarta a fila nem mata nada. */
  function interrupt() {
    if (!alive) return false;
    const target = current || (queue.length ? { turn: queue[0] } : null);
    if (!target) return false;
    (target.turn || target).interrupted = true;
    child.stdin.write(interruptLine(++reqSeq));
    return true;
  }

  /** Fecha o stdin e resolve quando o processo sair (troca de modo, /compact). */
  function close() {
    if (!alive) return Promise.resolve();
    timers.holdAwake();
    child.stdin.end();
    return new Promise((resolve) => exits.push(resolve));
  }

  const child = startChild({ args, cwd, spawn, onLine: handleLine, onStderr, onSpawnError, onClose });

  return {
    conversationId,
    signature,
    startedAt: Date.now(),
    send,
    interrupt,
    close,
    get pid() { return child.pid; },
    get alive() { return alive; },
    get busy() { return isBusy(); },
    get working() { return isWorking(); },
    get auto() { return isAuto(); },
    get pending() { return queue.length; },
    get lastOutputAt() { return lastOutputAt; },
  };
}
