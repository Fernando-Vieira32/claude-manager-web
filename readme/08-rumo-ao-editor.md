# 08 · Rumo ao editor no navegador

[← sumário](README.md)

O objetivo do projeto é chegar a um editor de código rodando no navegador. Este é o
caminho que a arquitetura atual já suporta, em ordem de dependência — cada etapa é
um serviço + um painel, e nenhuma exige reescrever o que existe.

## 0. `chat` — feito ✔

Continuar conversas pelo navegador já está no ar (`services/chat` + componentes
`feed`/`composer`/`chat`). Ver [10 · Chat](10-chat.md). O que ele deixou pronto para
as próximas etapas: streaming SSE ponta a ponta, componente de conversa reutilizável
e o padrão de "transporte injetado".

## 1. `files` — navegar e ler

Serviço com `GET /api/files?path=` e `GET /api/files/read?path=`, raiz permitida
explícita. Painel com árvore/lista e leitura no drawer.
Passo a passo pronto em [04](04-servico-novo.md) e [05](05-painel-novo.md).

## 2. `editor` — editar e salvar

- Editor: **CodeMirror 6** entra por ES module e combina com "sem build"
  (Monaco pede bundler e worker; deixe para depois se quiser IntelliSense).
- Rota `PUT /api/files` com escrita atômica (`.tmp` + `rename`).
- Detecção de conflito: mande o `mtime` que você leu; o servidor recusa (409) se o
  arquivo mudou no disco desde então.
- Atalhos: `Ctrl+S` salvar, `Ctrl+P` abrir arquivo — registre no painel e limpe no
  `destroy()`.

## 3. `git` — contexto do que mudou

`GET /api/git/status`, `GET /api/git/diff?path=`, e commit só depois que status e
diff estiverem sólidos. Use `execFile('git', [...])` com `cwd` do projeto, nunca
string de shell. Painel: lista de arquivos alterados + diff no drawer.

## 4. `terminal` — o pulo do gato

Aqui entra a primeira dependência real: WebSocket (`ws`) + PTY (`node-pty`), com
`xterm.js` no front. O `server.js` precisa tratar `upgrade`; o resto do core não
muda. Se quiser continuar sem dependências, uma alternativa mais pobre é
`POST /api/exec` com comando fixo em allowlist e resposta por SSE.

## 5. `projects` — abrir um workspace

Um serviço que guarda "projetos abertos" (nome + caminho) num JSON em
`~/.config/claude-manager-web/`, e um seletor no topo que troca a raiz usada por
`files`, `editor` e `git`. É o que transforma quatro painéis num ambiente.

## Coisas que vão ser necessárias em algum momento

| Necessidade | Onde encaixa |
| --- | --- |
| eventos em tempreal (arquivo mudou, sessão morreu) | SSE em `core/`, consumido por `api.js`; substitui o polling de 5s |
| estado compartilhado entre painéis (projeto atual) | um `core/store.js` mínimo com `subscribe/set` |
| lembrar preferências | já existe o padrão: `localStorage['cmw:*']` |
| testes | `node --test` em `services/**/repo.test.js`; os repos são funções puras, fáceis de testar |
| histórico de undo do editor | responsabilidade do CodeMirror, não invente |

## Duas armadilhas conhecidas

1. **Ligação processo → conversa é palpite.** Se o editor ganhar "abrir a conversa
   desta sessão", ela pode errar com duas sessões no mesmo diretório. Só o próprio
   Claude Code sabe o id da sessão dele.
2. **Polling não escala.** Com quatro painéis atualizando sozinhos, troque por SSE
   antes de o ventilador ligar.

## Ordem sugerida de commits

```
feat(chat): continuar conversa via CLI headless com SSE   # feito
feat(files): serviço de leitura com raiz confinada
feat(files): painel de navegação + leitura no drawer
feat(editor): CodeMirror com salvar e detecção de conflito
feat(git): status e diff
feat(projects): seletor de workspace
feat(terminal): pty via websocket
```
