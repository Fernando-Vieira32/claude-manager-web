# 09 · Problemas

[← sumário](README.md)

## "Não foi possível conectar" no navegador

O servidor não está de pé:

```bash
./docker-app.sh          # sobe (ou só abre a janela, se já estiver de pé)
./docker-app.sh log      # o que o servidor disse
```

## `EADDRINUSE: address already in use 127.0.0.1:7788`

Já existe uma instância (ou outro programa na porta):

```bash
ss -ltnp | grep 7788                  # quem está lá
docker ps --filter publish=7788        # é um container?
# ou só use outra porta: troque PORT no .env e rode ./docker-app.sh
```

## Chat e compactar pararam de funcionar (erro "não encontrei o binário claude")

Dentro do container isso é raro: o CLI `claude` vem **na imagem**, em `/usr/local/bin`, e o
servidor o encontra sozinho. Se acontecer, veja o que o container está vendo:

```bash
docker compose exec app which claude     # esperado: /usr/local/bin/claude
docker compose exec app claude --version
```

Se o binário sumiu (imagem antiga, build interrompido), reconstrua:

```bash
docker compose build --no-cache && ./docker-app.sh
```

Para apontar outro caminho — por exemplo um `claude` do seu home, montado —, acrescente
`CLAUDE_BIN` ao bloco `environment:` do `docker-compose.yml`. A ordem de resolução está em
`services/chat/bin.js`: `CLAUDE_BIN` → `PATH` → locais conhecidos.

> Antes da dockerização este era o erro mais comum, por causa de `.desktop`/`systemd` sem
> o PATH do nvm. Esse problema deixou de existir: o ambiente agora é o da imagem, igual
> para todo mundo.
## A lista de sessões vem vazia

- Confirme que existe sessão: `ps -eo pid,tty,args | grep '[c]laude'`.
- O serviço ignora processos cuja linha de comando contém `shell-snapshots` (são
  wrappers de shell criados pelas próprias sessões) e o próprio servidor.
- Se o seu Claude Code roda por um caminho diferente (ex.: `node /outro/cli.js`),
  ajuste `isClaudeProcess()` em `services/sessions/repo.js`.

## "conversa provável" mostra a conversa errada

É palpite mesmo: o `.jsonl` mais recente da pasta do projeto. Com duas sessões no
mesmo diretório, a mais recente ganha. Não há como resolver do lado de fora — o
Claude não deixa o arquivo aberto num descritor.

## Encerrei uma sessão e ela continuou viva

`SIGTERM` pode ser ignorado se o processo estiver travado. O toast oferece
**Forçar SIGKILL**; via API é `{"signal":"SIGKILL"}`. Se vier 409, o processo é de
outro usuário.

## Deletei uma conversa sem querer

Nada foi apagado — está em `~/.claude/.trash-conversas`. Use o painel **Lixeira** →
`Restaurar`, ou na mão:

```bash
ls ~/.claude/.trash-conversas
mv ~/.claude/.trash-conversas/20260818-121230_-home-fernando_e313d208-….jsonl \
   ~/.claude/projects/-home-fernando/e313d208-….jsonl
```

## Mudei o CSS/JS e o navegador não vê

Os estáticos vão com `cache-control: no-cache`, mas o navegador guarda módulos ES
em memória. `Ctrl+Shift+R` resolve. Se editou arquivo do servidor, ele precisa
reiniciar — use `./docker-app.sh dev`, que reinicia ao salvar.

## Um serviço novo não aparece

Checklist:

1. o arquivo se chama exatamente `services/<id>/service.js`;
2. o `export default` tem `id` e `routes` (array);
3. o servidor reiniciou — o log do boot deve mostrar
   `[registry] serviço "<id>" em /api/<id>`;
4. `curl -s localhost:7788/api/_services | grep '<id>'`.

## A interface abre mas fica em "carregando…"

Abra o console do navegador (F12). Erro de import (caminho errado num painel) trava
o boot inteiro do front, já que `panels/index.js` importa todos. A mensagem aponta
o arquivo.

## Um painel some da sidebar

Ele lançou exceção no `mount()`. O `app.js` mostra "Painel falhou" na área de
conteúdo e o erro completo vai para o console.
