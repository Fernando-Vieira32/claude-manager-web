import { listModels, refreshModels, modelById } from './repo.js';

export default {
  id: 'models',
  title: 'Modelos',
  description: 'Catálogo da API (janela de contexto real), em cache em data/models.json',
  basePath: '/api/models',
  routes: [
    {
      method: 'GET',
      path: '/',
      summary: 'catálogo de modelos (busca da API se o cache venceu): { fetchedAt, models, stale }',
      handler: () => listModels(),
    },
    {
      method: 'POST',
      path: '/refresh',
      summary: 'força a busca na API e regrava o cache',
      handler: () => refreshModels(),
    },
    {
      method: 'GET',
      path: '/:id',
      summary: 'um modelo pelo id (maxInputTokens = janela de contexto)',
      handler: ({ params }) => modelById(params.id),
    },
  ],
};
