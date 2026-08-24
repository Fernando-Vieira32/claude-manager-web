import {
  getSettings,
  saveSettings,
  deleteSettings,
  getGlobalSettings,
  saveGlobalSettings,
} from './repo.js';

export default {
  id: 'settings',
  title: 'Configurações',
  description: 'Preferências chave/valor: globais (data/settings.json) e por conversa (data/conversas/)',
  basePath: '/api/settings',
  routes: [
    {
      method: 'GET',
      path: '/',
      summary: 'lê a configuração global do app (objeto chave/valor)',
      handler: () => getGlobalSettings(),
    },
    {
      method: 'PUT',
      path: '/',
      summary: 'mescla e grava a configuração global (body: objeto chave/valor; valor "" remove a chave)',
      handler: ({ body }) => saveGlobalSettings(body),
    },
    {
      method: 'GET',
      path: '/:id',
      summary: 'lê a configuração de uma conversa (objeto chave/valor)',
      handler: ({ params }) => getSettings(params.id),
    },
    {
      method: 'PUT',
      path: '/:id',
      summary: 'mescla e grava a configuração (body: objeto chave/valor; valor "" remove a chave)',
      handler: ({ params, body }) => saveSettings(params.id, body),
    },
    {
      method: 'DELETE',
      path: '/:id',
      summary: 'apaga a config da conversa (devolve o que existia); usado ao deletar a conversa',
      handler: ({ params }) => deleteSettings(params.id),
    },
  ],
};
