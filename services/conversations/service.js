import {
  listConversations,
  getConversation,
  deleteConversation,
  renameConversation,
} from './repo.js';
import { listTrash, restoreFromTrash, purgeTrash } from './trash.js';
import { getAgentSteps } from './subagent.js';

export default {
  id: 'conversations',
  title: 'Conversas',
  description: 'Transcrições salvas em ~/.claude/projects',
  basePath: '/api/conversations',
  routes: [
    {
      method: 'GET',
      path: '/',
      summary: 'lista conversas (?q= filtra)',
      handler: async ({ query }) => ({ items: await listConversations({ q: query.q || '' }) }),
    },
    {
      method: 'GET',
      path: '/trash',
      summary: 'lista a lixeira',
      handler: async () => ({ items: await listTrash() }),
    },
    {
      method: 'POST',
      path: '/trash/restore',
      summary: 'restaura da lixeira (body: { name })',
      handler: async ({ body }) => restoreFromTrash(body.name),
    },
    {
      method: 'POST',
      path: '/trash/purge',
      summary: 'apaga da lixeira o que é mais velho que a retenção (body: { value, unit, dryRun })',
      handler: async ({ body }) => purgeTrash(body),
    },
    {
      method: 'GET',
      path: '/:id/agents/:ref',
      summary: 'os passos de um subagente pelo id do disparo (?limit=400), em blocos',
      handler: async ({ params, query }) =>
        getAgentSteps(params.id, params.ref, { limit: Number(query.limit) || undefined }),
    },
    {
      method: 'GET',
      path: '/:id',
      summary: 'lê uma conversa em janelas (?limit=20&before=<índice>)',
      handler: async ({ params, query }) =>
        getConversation(params.id, {
          limit: Number(query.limit) || 20,
          before: query.before === undefined ? undefined : Number(query.before),
        }),
    },
    {
      method: 'POST',
      path: '/:id/rename',
      summary: 'renomeia a conversa (body: { name }) — o mesmo que /rename no terminal',
      handler: async ({ params, body }) => renameConversation(params.id, body.name),
    },
    {
      method: 'DELETE',
      path: '/:id',
      summary: 'move a conversa para a lixeira',
      handler: async ({ params }) => deleteConversation(params.id),
    },
  ],
};
