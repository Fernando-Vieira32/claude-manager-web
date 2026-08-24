# Claude Manager Web

Painel local para gerenciar o Claude Code: **sessões abertas** (listar e encerrar),
**conversas salvas** (listar, filtrar, ler em janelas e **continuar a conversa pelo
navegador**) e **lixeira** (restaurar).
Node puro + ES modules — sem dependências, sem build.

```bash
./start.sh          # sobe o servidor e abre http://127.0.0.1:7788
npm run dev         # servidor com --watch
```

## Documentação

A documentação está em **[`readme/`](readme/README.md)** — um arquivo por assunto,
para nenhum ficar gigante:

| # | Documento | Para quê |
| --- | --- | --- |
| 01 | [Começar](readme/01-comecar.md) | requisitos, subir, abrir, parar, variáveis de ambiente |
| 02 | [Arquitetura](readme/02-arquitetura.md) | divisão em core/services/panels, caminho de uma requisição, contratos |
| 03 | [API](readme/03-api.md) | todas as rotas com exemplos `curl` e formatos |
| 04 | [Criar um serviço](readme/04-servico-novo.md) | passo a passo do backend |
| 05 | [Criar um painel](readme/05-painel-novo.md) | passo a passo do front |
| 06 | [Interface](readme/06-interface.md) | tema, tokens, componentes, atalhos |
| 07 | [Segurança](readme/07-seguranca.md) | o que é permitido e por quê |
| 08 | [Rumo ao editor](readme/08-rumo-ao-editor.md) | plano de evolução até um editor no navegador |
| 09 | [Problemas](readme/09-problemas.md) | erros comuns |
| 10 | [Chat](readme/10-chat.md) | continuar a conversa pelo navegador |
| 11 | [Componentes](readme/11-componentes.md) | peças reutilizáveis da interface |

## Estrutura em 10 linhas

```
server.js      bootstrap (http + router + registry + estáticos)
core/          config, router, http, registry, static, claude-paths
services/      um recurso por pasta: service.js (manifesto) + repo.js (regra)
public/        index.html, css/tokens.css, css/app.css
public/js/core       api.js (único fetch), ui.js (casca), app.js (boot)
public/js/components peças reutilizáveis: feed, bubble, composer, chat, data-table
public/js/panels     um arquivo por aba + index.js (manifesto); só compõe
readme/        esta documentação
```

Adicionar recurso no backend = criar `services/<novo>/service.js` (o registry acha
sozinho). Adicionar aba na interface = criar `public/js/panels/<novo>.js` e somar
uma linha em `panels/index.js`. Nada no core muda.

## Escopo e limites

- escuta só em `127.0.0.1`, sem autenticação — não exponha na rede;
- só encerra PIDs reconhecidos como sessões do Claude, só com `SIGTERM`/`SIGINT`/`SIGKILL`;
- deletar conversa **move** para `~/.claude/.trash-conversas` (nunca apaga);
- o chat usa `claude --resume` e grava no mesmo transcript; ferramentas completas só
  com `CHAT_ALLOW_FULL_TOOLS=1`;
- a coluna "conversa provável" de uma sessão é palpite (o `.jsonl` mais recente do projeto).
