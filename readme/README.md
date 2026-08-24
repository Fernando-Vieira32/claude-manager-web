# Documentação — Claude Manager Web

Sumário da documentação. Cada assunto vive em um arquivo próprio para nenhum
deles ficar gigante. Comece pelo primeiro se você acabou de chegar.

| # | Documento | Para quê |
| --- | --- | --- |
| 01 | [Começar](01-comecar.md) | requisitos, subir o servidor, abrir no navegador, parar, logs |
| 02 | [Arquitetura](02-arquitetura.md) | como o projeto é dividido, o caminho de uma requisição, contratos |
| 03 | [API](03-api.md) | todas as rotas, exemplos com `curl`, formato das respostas e dos erros |
| 04 | [Criar um serviço](04-servico-novo.md) | passo a passo do backend (exemplo: serviço de arquivos) |
| 05 | [Criar um painel](05-painel-novo.md) | passo a passo do front (exemplo: painel de arquivos) |
| 06 | [Interface](06-interface.md) | layout, tema, tokens de design, componentes de `ui.js`, atalhos |
| 07 | [Segurança](07-seguranca.md) | o que é permitido, o que é bloqueado e por quê |
| 08 | [Rumo ao editor](08-rumo-ao-editor.md) | plano de evolução até um editor de código no navegador |
| 09 | [Problemas](09-problemas.md) | erros comuns e como resolver |
| 10 | [Chat](10-chat.md) | iniciar/continuar conversa pelo navegador: modos de permissão, imagens, respostas rápidas, custo |
| 11 | [Componentes](11-componentes.md) | catálogo das peças de UI (feed, chat, janela flutuante, image-tray…): contratos e como criar outra |
| 12 | [Rodar em uma máquina nova](12-rodar-em-maquina-nova.md) | runbook de setup para a outra máquina: pré-requisitos, subir, verificar (Linux/Mac/Windows) |

## Em uma frase

Painel local (`127.0.0.1`) que lista e encerra sessões do Claude Code; lista, lê,
**inicia** e continua conversas num chat (com modos de permissão, imagens e respostas
rápidas, em janelas flutuantes), renomeia, deleta e restaura — feito em Node puro e ES
modules, **sem dependências e sem build**, com cada recurso isolado em um módulo próprio
para o projeto poder crescer até virar um editor de código no navegador.

## Atalhos rápidos

```bash
./start.sh                  # sobe o servidor e abre o navegador
npm run dev                 # servidor com --watch (reinicia ao salvar)
PORT=9000 npm start         # outra porta
curl -s localhost:7788/api/_services | less   # mapa das rotas registradas
```

## Onde mexer para cada coisa

| Quero… | Arquivo |
| --- | --- |
| mudar cores, raio, fonte | `public/css/tokens.css` |
| mudar layout/componentes | `public/css/app.css` |
| adicionar um recurso no backend | `services/<novo>/service.js` + `repo.js` |
| adicionar uma aba na interface | `public/js/panels/<novo>.js` + `panels/index.js` |
| criar peça de UI reutilizável | `public/js/components/<novo>.js` (ver [11](11-componentes.md)) |
| mexer no chat (modos, imagens, custo, timeout) | `services/chat/repo.js` (ver [10](10-chat.md)) |
| navegar pastas do servidor | `services/fs/repo.js` |
| mudar porta, caminhos, host | `core/config.js` (ou variáveis `PORT`/`HOST`) |
| mudar regra de sessões (ps, kill) | `services/sessions/repo.js` |
| mudar leitura das conversas | `services/conversations/repo.js` |
