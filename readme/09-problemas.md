# 09 · Problemas

[← sumário](README.md)

## "Não foi possível conectar" no navegador

O servidor não está de pé:

```bash
cd ~/www/personal/claude-manager-web && ./start.sh
tail -20 /tmp/claude-manager-web.log
```

## `EADDRINUSE: address already in use 127.0.0.1:7788`

Já existe uma instância (ou outro programa na porta):

```bash
ss -ltnp | grep 7788                  # quem está lá
kill $(ss -ltnp | grep 7788 | sed -E 's/.*pid=([0-9]+).*/\1/')
PORT=7799 npm start                   # ou só use outra porta
```

## Chat e compactar pararam de funcionar (erro "não encontrei o binário claude")

Os dois chamam o CLI `claude`. Se o **servidor foi iniciado com um PATH mínimo**
(por um atalho, `systemd`, cron…) que não inclui a pasta do `claude` — em geral
`~/.npm-global/bin` —, ele não acha o binário e todo chat/compact falha com
`spawn claude ENOENT`.

O servidor já tenta resolver o caminho sozinho (PATH + locais conhecidos). Se mesmo
assim não achar:

```bash
which claude                 # descubra o caminho real
CLAUDE_BIN=/caminho/para/claude ./start.sh   # aponte explicitamente
```

O jeito mais simples de evitar isso é subir pelo **seu terminal normal**
(`./start.sh`), onde o PATH já inclui o `claude`.

### Se o `claude` vem do nvm (caso do atalho `.desktop`)

Um `.desktop` do GNOME **não** carrega `~/.zshrc`/`~/.bashrc`, então o PATH é o da
sessão: sem o nvm. Aí `node` cai no do sistema (que pode ser antigo demais para o
servidor) e o `claude` simplesmente não existe — e os locais de fallback do
`services/chat/repo.js` (`~/.npm-global/bin`, `~/.local/bin`, `~/.claude/local`,
`/usr/local/bin`) não cobrem o nvm.

O `start.sh` resolve isso: se não achar node 18+ **e** o `claude`, ele carrega o
`~/.nvm/nvm.sh` antes de subir, e o servidor herda o PATH já corrigido. Por isso o
atalho deve sempre chamar o `start.sh`, nunca `node server.js` direto.

Para checar como o servidor **em execução** está vendo o mundo:

```bash
SRV=$(pgrep -f 'node server.js' | head -1)
ls -l /proc/$SRV/exe                          # qual node subiu (quer v18+)
tr '\0' '\n' < /proc/$SRV/environ | grep PATH  # o claude está nesse PATH?
```

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
reiniciar — use `npm run dev`.

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
