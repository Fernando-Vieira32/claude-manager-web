// Manifesto do serviço de sessões. O core só conhece este formato.

import { listSessions, killSession } from './repo.js';

export default {
  id: 'sessions',
  title: 'Sessões',
  description: 'Processos do Claude Code em execução nesta máquina',
  basePath: '/api/sessions',
  routes: [
    {
      method: 'GET',
      path: '/',
      summary: 'lista sessões abertas (?q= filtra)',
      handler: async ({ query }) => ({ items: await listSessions({ q: query.q || '' }) }),
    },
    {
      method: 'POST',
      path: '/:pid/kill',
      summary: 'encerra uma sessão (body: { signal })',
      handler: async ({ params, body }) => killSession(params.pid, body.signal || 'SIGTERM'),
    },
  ],
};
