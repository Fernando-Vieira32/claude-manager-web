import { getSettings, saveSettings, deleteSettings } from './repo.js';

export default {
  id: 'settings',
  title: 'Configurações',
  description: 'Preferências por conversa (modo, cor…), gravadas em data/conversas/',
  basePath: '/api/settings',
  routes: [
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
