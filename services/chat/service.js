import { openSse } from '../../core/http.js';
import { sendMessage, compactConversation, startConversation, stopRun, listRunning, isRunning } from './repo.js';

export default {
  id: 'chat',
  title: 'Chat',
  description: 'Continuar uma conversa existente pelo navegador (claude --resume)',
  basePath: '/api/chat',
  routes: [
    {
      method: 'GET',
      path: '/',
      summary: 'execuções em andamento',
      handler: () => ({ items: listRunning() }),
    },
    {
      method: 'POST',
      path: '/',
      summary: 'inicia uma conversa nova (body: { cwd, text, mode, model }) e transmite em SSE',
      handler: async ({ body, req, res }) => {
        const sse = openSse(res);
        try {
          await startConversation(
            { cwd: body.cwd, text: body.text, mode: body.mode, model: body.model, images: body.images },
            sse,
            req,
          );
        } catch (err) {
          sse.send({ type: 'error', message: err.message });
          sse.send({ type: 'done', code: null });
          sse.close();
        }
      },
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
      handler: async ({ params, body, req, res }) => {
        const sse = openSse(res);
        try {
          await sendMessage(
            { id: params.id, text: body.text, mode: body.mode, model: body.model, images: body.images },
            sse,
            req,
          );
        } catch (err) {
          // o stream já está aberto: o erro vai como evento, não como status HTTP
          sse.send({ type: 'error', message: err.message });
          sse.send({ type: 'done', code: null });
          sse.close();
        }
      },
    },
    {
      method: 'POST',
      path: '/:id/compact',
      summary: 'compacta o contexto da conversa (/compact) e transmite em SSE',
      handler: async ({ params, body, req, res }) => {
        const sse = openSse(res);
        try {
          await compactConversation({ id: params.id, model: body.model }, sse, req);
        } catch (err) {
          sse.send({ type: 'error', message: err.message });
          sse.send({ type: 'done', code: null });
          sse.close();
        }
      },
    },
    {
      method: 'POST',
      path: '/:id/stop',
      summary: 'interrompe a resposta em andamento',
      handler: ({ params }) => stopRun(params.id),
    },
  ],
};
