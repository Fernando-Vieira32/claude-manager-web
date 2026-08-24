import { getSettings, saveSettings, deleteSettings, listAllSettings } from './repo.js';

export default {
  id: 'settings',
  title: 'Configurações',
  description: 'Preferências por conversa (modo, cor…), gravadas em data/conversas/',
  basePath: '/api/settings',
  routes: [
    // ANTES de '/:id': o router casa na ordem de registro, e '/all' também casaria
    // como se 'all' fosse um id.
    {
      method: 'GET',
      path: '/all',
      summary: 'lê a config de todas as conversas de uma vez (para listas): { items: [{ id, settings }] }',
      handler: async () => ({ items: await listAllSettings() }),
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
