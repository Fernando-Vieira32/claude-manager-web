// Continuar uma conversa do Claude Code pelo navegador.
//
// Uma conversa = UM processo `claude` vivo (`runner.js`), alimentado por stdin em
// `--input-format stream-json`. Mandar mensagem enquanto o Claude responde é
// permitido: a linha vai para o stdin na hora e o próprio CLI enfileira o turno —
// a espera é dentro do Claude, como no terminal, e não numa fila do navegador.
//
// Com `--resume`/`--session-id` o session_id é preservado e as mensagens são
// gravadas no MESMO .jsonl — então o leitor do painel (e o terminal, se você
// reabrir por lá) vê a continuação. Nada de banco nem de histórico paralelo.
//
// Aqui mora só a cola: validação, resolução da conversa e o mapa de runners.

import { randomUUID } from 'node:crypto';
import { resolveConversationId, cwdOfConversation, encodeProject } from '../../core/claude-paths.js';
import { notFound, conflict } from '../../core/http.js';
import { MODE_POLICIES, modeArgs, runnerArgs, oneshotArgs } from './args.js';
import { createRunner } from './runner.js';
import { runOnce } from './oneshot.js';
import { validMessage, validImages, validDir } from './validate.js';
import { createRunnerRegistry } from './runners.js';
import { followTranscript } from './follow.js';

/** conversationId -> runner (processo vivo, pode estar ocioso); regras em runners.js */
const runners = createRunnerRegistry();
/** conversationId -> { child, startedAt } — só o /compact, que é execução única */
const oneshots = new Map();

/**
 * "Está trabalhando AGORA" — o `working` do runner, não o `busy`: o CLI começa turnos
 * sozinho, e nesses ele trabalha com a fila vazia. Dizer `false` ali escondia o "Parar"
 * no exato momento em que ele era necessário.
 */
export function isRunning(id) {
  return runners.working(id) || oneshots.has(id);
}

export function listRunning() {
  const fromRunners = runners.list().map((r) => ({
    id: r.conversationId,
    pid: r.pid,
    startedAt: new Date(r.startedAt).toISOString(),
    kind: 'chat',
    busy: r.busy,
    working: r.working,
    auto: r.auto,
    pending: r.pending,
    lastOutputAt: new Date(r.lastOutputAt).toISOString(),
  }));
  const fromOneshots = [...oneshots.entries()].map(([id, run]) => ({
    id,
    pid: run.child.pid,
    startedAt: new Date(run.startedAt).toISOString(),
    kind: 'compact',
    busy: true,
    working: true,
    auto: false,
    pending: 1,
    lastOutputAt: null,
  }));
  return [...fromRunners, ...fromOneshots];
}

/** O `hello` do canal: o que o navegador precisa saber ao (re)conectar. */
export function chatState(id) {
  const once = oneshots.get(id);
  if (once) return { pid: once.child.pid, busy: true, pending: 1 };
  const runner = runners.get(id);
  if (!runner?.alive) return { pid: null, busy: false, pending: 0 };
  return { pid: runner.pid, busy: runner.busy, pending: runner.pending };
}

/**
 * Acompanha o arquivo desta conversa enquanto alguém ouve o canal — é assim que o que
 * você faz NO TERMINAL aparece na janela do navegador sem fechar e abrir.
 *
 * Pausa enquanto o processo é NOSSO: aí a resposta já sai pelo SSE do próprio turno, e
 * publicar o arquivo também mostraria tudo em dobro.
 *
 * @returns {() => void} para de acompanhar (a rota chama ao fechar o canal).
 */
export function watchTranscript(id) {
  const { file } = resolveConversationId(id);
  return followTranscript(id, {
    file,
    // Calado só enquanto o NOSSO processo trabalha — aí ele já publica cada linha no canal
    // e seguir o arquivo duplicaria tudo. A pergunta era `alive`, e isso furava: um runner
    // OCIOSO (sobrevive minutos depois da última resposta) calava o seguidor enquanto a
    // conversa seguia sendo conduzida no TERMINAL. As linhas do terminal eram puladas para
    // sempre — quatro agentes ficaram com relógio correndo na tela com o terminal já os
    // mostrando terminados. Ocioso não publica nada, então ocioso não cala ninguém.
    paused: () => isRunning(id),
  });
}

/**
 * Para a resposta em andamento. No chat isso é um `interrupt` no processo vivo (não
 * SIGTERM): o turno em voo é cortado, mas o processo, a sessão quente e as mensagens
 * já enfileiradas continuam valendo. O `/compact`, sendo execução única, só morre.
 *
 * A porta é o `working`, o mesmo critério do `/status`: se o painel mostra o "Parar",
 * clicar nele não pode dar 404. Sem nada para cortar, a resposta é `stopped: false` —
 * que é a verdade, não um erro.
 */
export function stopRun(id) {
  const runner = runners.get(id);
  if (runner?.working) return { id, stopped: runner.interrupt(), pid: runner.pid, pending: runner.pending };
  const once = oneshots.get(id);
  if (once) {
    once.child.kill('SIGTERM');
    return { id, stopped: true, pid: once.child.pid };
  }
  throw notFound('não há execução em andamento para esta conversa');
}

/**
 * Envia uma mensagem e transmite a resposta via SSE.
 * Eventos: init, queued, turnStart, system, delta, message, tool, notice, result,
 * error, done.
 */
export async function sendMessage({ id, text, mode = 'none', model, images }, sse) {
  const imgs = validImages(images);
  const message = validMessage(text, imgs.length);
  const extraArgs = modeArgs(mode);

  // Processo vivo? Então já sabemos sessão e pasta, e reler o transcript seria pior
  // que inútil: numa conversa RECÉM-CRIADA o .jsonl ainda não existe, e era aí que a
  // segunda mensagem morria com "conversa não encontrada". Só quem precisa spawnar
  // vai ao disco.
  const vivo = runners.reusable(id, `${mode}|${model || ''}`);
  if (vivo) return vivo.send({ text: message, images: imgs, sse, kind: 'message' });

  const { sessionId, cwd } = await resolveExisting(id);
  const runner = await runnerFor({ conversationId: id, sessionId, cwd, extraArgs, mode, model });
  return runner.send({ text: message, images: imgs, sse, kind: 'message' });
}

/**
 * Inicia uma conversa NOVA numa pasta escolhida. Geramos o session-id (uuid) e o
 * passamos ao CLI com --session-id, então já sabemos o id da conversa antes mesmo
 * de o Claude responder — sem --resume, um .jsonl novo nasce em ~/.claude/projects.
 */
export async function startConversation({ cwd, text, mode = 'none', model, images }, sse) {
  const imgs = validImages(images);
  const message = validMessage(text, imgs.length);
  const extraArgs = modeArgs(mode);
  const dir = await validDir(cwd);

  const sessionId = randomUUID();
  const conversationId = `${encodeProject(dir)}:${sessionId}`;
  const runner = await runnerFor({ conversationId, sessionId, cwd: dir, extraArgs, mode, model, isNew: true });
  return runner.send({ text: message, images: imgs, sse, kind: 'new' });
}

/**
 * Compacta a conversa — equivale ao /compact do terminal: resume o histórico e
 * grava um marcador no mesmo transcript, reduzindo o contexto. Sem ferramentas.
 * É execução única de propósito: dois processos reescrevendo o mesmo transcript se
 * atropelariam, então o runner da conversa é fechado antes.
 */
export async function compactConversation({ id, model }, sse) {
  const { sessionId, cwd } = await resolveExisting(id);
  if (oneshots.has(id)) throw conflict('esta conversa já está compactando');
  await freeConversation(id, 'compactar');
  const args = oneshotArgs({ prompt: '/compact', sessionId, extraArgs: MODE_POLICIES.none(), model });
  const { child, done } = runOnce({ conversationId: id, sessionId, cwd, mode: 'none', kind: 'compact', args }, sse);
  oneshots.set(id, { child, startedAt: Date.now() });
  try {
    await done;
  } finally {
    oneshots.delete(id);
  }
}

/* ------------------------------------------------------------- runners */

/**
 * O runner de uma conversa, criando-o se preciso. Modo e modelo viram a
 * "assinatura" do processo: eles são flags de linha de comando, então trocar de
 * modo exige processo novo. Enquanto a assinatura é a mesma, mensagem nova só
 * entra na fila — este é o caminho normal e não pode dar 409.
 */
async function runnerFor({ conversationId, sessionId, cwd, extraArgs, mode, model, isNew = false }) {
  const signature = `${mode}|${model || ''}`;
  const reusable = runners.reusable(conversationId, signature);
  if (reusable) return reusable;

  const existing = runners.get(conversationId);
  if (existing?.alive) {
    // ocioso com outra assinatura: sai do mapa ANTES de fechar, porque um envio que
    // chegue durante o fechamento não pode pegar um processo com o stdin a caminho
    // do fim — a mensagem sumiria
    runners.forget(conversationId, existing);
    await existing.close();
  }
  if (oneshots.has(conversationId)) throw conflict('esta conversa está compactando; espere terminar');

  const runner = createRunner({
    conversationId,
    sessionId,
    cwd,
    mode,
    signature,
    args: runnerArgs({ sessionId, isNew, extraArgs, model }),
    onExit: () => runners.forget(conversationId, runner),
  });
  runners.remember(conversationId, runner);
  return runner;
}

/** Libera a conversa para uma execução única: recusa se está respondendo, fecha se ociosa. */
async function freeConversation(id, acao) {
  const runner = runners.get(id);
  if (!runner?.alive) return;
  if (runner.busy) throw conflict(`esta conversa está respondendo; espere terminar para ${acao}`);
  await runner.close();
}

/** Resolve uma conversa existente no par (sessionId, cwd). */
async function resolveExisting(id) {
  const { sessionId, file } = resolveConversationId(id);
  const cwd = await cwdOfConversation(file);
  if (!cwd) throw notFound('conversa não encontrada (ou sem cwd no transcript)');
  return { sessionId, cwd };
}
