# 02 · Arquitetura

[← sumário](README.md)

## A ideia

O objetivo declarado é crescer até um editor de código no navegador. Isso só se
sustenta se **nada for central**: o core não sabe o que é "sessão" nem "conversa".
Ele só carrega serviços e serve arquivos. Cada recurso é uma pasta no backend e um
arquivo no front.

## Árvore

```
server.js                bootstrap: http + router + registry + estáticos
core/
  config.js              porta, host e caminhos (fonte única de verdade)
  router.js              rotas com padrões '/api/sessions/:pid/kill'
  http.js                ApiError, sendJson, readJsonBody
  registry.js            descobre services/*/service.js e monta as rotas
  static.js              serve public/ com mime types
  claude-paths.js        o que se sabe sobre ~/.claude (layout, ids, fold de acentos)
services/
  sessions/service.js    MANIFESTO (id, basePath, routes)
  sessions/repo.js       regra de negócio: ps, /proc, kill
  conversations/service.js
  conversations/repo.js  leitura dos .jsonl, lixeira, restore, renomear
  chat/service.js
  chat/repo.js           inicia/continua a conversa via CLI headless (SSE), imagens
  fs/service.js
  fs/repo.js             navegação de pastas (escolher onde a conversa roda)
  settings/service.js
  settings/repo.js       preferências chave/valor: global e por conversa, em arquivo
data/
  settings.json          config global do app (1 arquivo); criado sozinho, fora do git
  conversas/             1 arquivo JSON por conversa (config); criado sozinho, fora do git
public/
  index.html             casca: sidebar, topbar, drawer, modal, toasts
                         (as janelas de conversa nascem soltas no <body>)
  css/tokens.css         cores, raios, fontes
  css/app.css            layout e componentes
  js/core/api.js         única camada que fala HTTP
  js/core/ui.js          el(), fmt, toast, confirmAction, drawer, states
  js/core/chat-fields.js opções de modo e modelo (compartilhadas entre painéis)
  js/core/detect-options.js  detecta pergunta+opções (respostas rápidas)
  js/components/*.js     peças reutilizáveis: feed, bubble, composer, chat, floating-window…
  js/core/app.js         registra painéis, navegação, busca, tema, health
  js/panels/index.js     MANIFESTO dos painéis
  js/panels/*.js         um arquivo por painel
readme/                  esta documentação
```

## Caminho de uma requisição

```
navegador
  └─ js/panels/sessions.js        chama api.sessions.list('docker')
      └─ js/core/api.js           GET /api/sessions?q=docker
          └─ server.js            é /api/* → router.match('GET', '/api/sessions')
              └─ core/router.js   devolve o handler + params
                  └─ services/sessions/service.js   handler do manifesto
                      └─ services/sessions/repo.js  ps + /proc + filtro
              ←── retorna { items: [...] }
          ←── sendJson(res, 200, ...)
      ←── render na tabela
```

Requisições que **não** começam com `/api/` caem em `core/static.js` e viram
arquivos de `public/`.

## Boot

1. `server.js` cria o router e registra `/api/_services` e `/api/_health`.
2. `await loadServices(router)` — `core/registry.js` lê `services/`, importa cada
   `service.js`, valida o manifesto (precisa de `id` e `routes`) e monta as rotas
   sob `basePath`.
3. `server.listen(config.port, config.host)`.

Log do boot:

```
[registry] serviço "chat" em /api/chat (6 rotas)
[registry] serviço "conversations" em /api/conversations (7 rotas)
[registry] serviço "fs" em /api/fs (1 rotas)
[registry] serviço "sessions" em /api/sessions (2 rotas)
[registry] serviço "settings" em /api/settings (5 rotas)
```

Se um serviço não aparecer nessa lista, ele não foi carregado — confira o nome do
arquivo (`service.js`) e se o `export default` tem `id` e `routes`.

## Contrato do serviço (backend)

```js
export default {
  id: 'sessions',                    // obrigatório, único
  title: 'Sessões',                  // rótulo humano
  description: '...',                // aparece no painel Serviços
  basePath: '/api/sessions',         // opcional (padrão: /api/<id>)
  routes: [
    {
      method: 'GET',
      path: '/',                     // '/' = o próprio basePath
      summary: 'lista sessões',      // vira documentação em /api/_services
      handler: async ({ params, query, body, req, res }) => ({ items: [] }),
    },
  ],
};
```

O `handler` devolve **dados** (serializados como JSON 200) ou
`{ status, data }` para escolher o código. Para erro, lance
`ApiError`/`badRequest`/`notFound`/`conflict` de `core/http.js` — o `server.js`
converte em `{ "error": "...", "details": ... }` com o status certo.

## Contrato do painel (front)

```js
export default {
  id: 'sessions',
  icon: '◉',
  title: 'Sessões abertas',
  navTitle: 'Sessões',                 // opcional: rótulo curto na sidebar
  description: 'texto do cabeçalho',
  searchPlaceholder: 'filtrar…',       // false esconde a busca
  mount(root, ctx) {
    // ctx.search()  -> termo atual
    // ctx.setCount(n) -> badge na sidebar
    // ctx.toast, ctx.go(id)
    return {
      onSearch(termo) {},               // usuário digitou na busca
      refresh() {},                     // botão Atualizar ou tecla "r"
      destroy() {},                     // saiu do painel: limpe timers/listeners
    };
  },
};
```

## Regras que mantêm o acoplamento baixo

- serviço **não** importa outro serviço — o que é comum vai para `core/`;
- serviço **não** toca em `req`/`res`: devolve dados ou lança `ApiError`;
- painel **não** usa `fetch`: só `api.*` de `js/core/api.js`;
- painel **não** conhece outro painel: navegação é `ctx.go(id)`;
- painel **não** desenha à mão o que pode ser componente: lógica visual reutilizável
  vai para `js/components/` e recebe dados por parâmetro ([11](11-componentes.md));
- componente **não** importa `api.js`: transporte entra como callback;
- caminho, porta e diretórios só saem de `core/config.js`.

Se você seguir essas cinco linhas, apagar uma pasta de `services/` ou um arquivo
de `js/panels/` nunca quebra o resto — só remove o recurso.
