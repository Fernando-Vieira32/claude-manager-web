import { openSse } from '../../core/http.js';
import {
  sendMessage, compactConversation, startConversation, stopRun, listRunning, isRunning, chatState,
  watchTranscript,
} from './repo.js';
import { subscribe } from './channel.js';

// Um canal fica aberto por horas; navegador e proxy derrubam conexão ociosa sem tráfego.
const KEEPALIVE_MS = 25_000;

/**
 * Abre o SSE e transmite o que `run(sse)` produzir.
 *
 * Duas coisas moram aqui de propósito:
 *  - o erro de validação vira EVENTO, não status HTTP: o stream já respondeu 200;
 *  - cliente que vai embora só perde o stream. Antes o `close` matava o processo;
 *    agora um processo serve vários turnos e vários clientes, então fechar a aba
 *    apenas marca este SSE como morto — o Claude termina e grava no `.jsonl`.
 */
async function stream(res, run) {
  const sse = openSse(res);
  const drop = () => sse.close();
  res.on('close', drop);
  res.on('error', drop);
  try {
    await run(sse);
  } catch (err) {
    sse.send({ type: 'error', message: err.message });
    sse.send({ type: 'done', code: null });
    sse.close();
  }
}

/**
 * O canal da conversa: um SSE que NÃO é de um turno nosso. Por ele chegam os turnos que
 * o CLI começa sozinho (`autoStart` → eventos → `result` → `autoEnd`), o que está sendo
 * feito NO TERMINAL nesta mesma conversa (o servidor acompanha o .jsonl enquanto alguém
 * ouve), o `busy` honesto e o `gone`. Fechar a aba só desinscreve — jamais mata processo.
 */
function events(res, id) {
  const sse = openSse(res);
  const off = subscribe(id, sse);
  const unfollow = follow(sse, id);
  sse.send({ type: 'hello', ...chatState(id) });
  const ping = setInterval(() => { if (!sse.closed) res.write(': keep-alive\n\n'); }, KEEPALIVE_MS);
  ping.unref?.();
  return new Promise((resolve) => {
    const bye = () => { clearInterval(ping); off(); unfollow(); sse.close(); resolve(); };
    res.on('close', bye);
    res.on('error', bye);
  });
}

/** Acompanhar o arquivo é bônus: se falhar, o canal continua servindo o resto. */
function follow(sse, id) {
  try {
    return watchTranscript(id);
  } catch (err) {
    sse.send({ type: 'notice', message: `não deu para acompanhar o arquivo desta conversa: ${err.message}` });
    return () => {};
  }
}

export default {
  id: 'chat',
  title: 'Chat',
  description: 'Continuar uma conversa existente pelo navegador (claude --resume)',
  basePath: '/api/chat',
  routes: [
    {
      method: 'GET',
      path: '/',
      summary: 'processos de chat vivos (busy = respondendo agora)',
      handler: () => ({ items: listRunning() }),
    },
    {
      method: 'POST',
      path: '/',
      summary: 'inicia uma conversa nova (body: { cwd, text, mode, model }) e transmite em SSE',
      handler: ({ body, res }) => stream(res, (sse) => startConversation(
        { cwd: body.cwd, text: body.text, mode: body.mode, model: body.model, images: body.images },
        sse,
      )),
    },
    {
      method: 'GET',
      path: '/:id/events',
      summary: 'canal da conversa em SSE: turnos que o CLI começa sozinho, busy, gone',
      handler: ({ params, res }) => events(res, params.id),
    },
    {
      method: 'GET',
      path: '/:id/status',
      summary: 'diz se esta conversa está respondendo agora',
      handler: ({ params }) => ({ id: params.id, running: isRunning(params.id) }),
    },
    {
      method: 'POST',
      path: '/:id',
      summary: 'envia mensagem e transmite a resposta em SSE (body: { text, mode, model })',
      handler: ({ params, body, res }) => stream(res, (sse) => sendMessage(
        { id: params.id, text: body.text, mode: body.mode, model: body.model, images: body.images },
        sse,
      )),
    },
    {
      method: 'POST',
      path: '/:id/compact',
      summary: 'compacta o contexto da conversa (/compact) e transmite em SSE',
      handler: ({ params, body, res }) => stream(res, (sse) => compactConversation({ id: params.id, model: body.model }, sse)),
    },
    {
      method: 'POST',
      path: '/:id/stop',
      summary: 'interrompe o turno em andamento (a fila da conversa continua)',
      handler: ({ params }) => stopRun(params.id),
    },
  ],
};
