import { listDirs } from './repo.js';

export default {
  id: 'fs',
  title: 'Arquivos',
  description: 'Navegação de pastas do servidor (escolher onde uma conversa roda)',
  basePath: '/api/fs',
  routes: [
    {
      method: 'GET',
      path: '/',
      summary: 'lista as subpastas de um caminho (query: path; vazio = HOME)',
      handler: ({ query }) => listDirs(query.path),
    },
  ],
};
