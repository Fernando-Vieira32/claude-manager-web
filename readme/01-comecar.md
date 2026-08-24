# 01 · Começar

[← sumário](README.md)

## Requisitos

- **Node 18+** (testado no 20.20.2) — `node -v`
- Linux com `/proc` e `ps` (a leitura de sessões depende dos dois)
- Um navegador moderno (ES modules nativos; nada é transpilado)

Não há `npm install`: o projeto não tem dependências.

## Subir

```bash
cd ~/www/personal/claude-manager-web
./start.sh          # sobe (se preciso) e abre o navegador
```

`start.sh` é idempotente: se o servidor já estiver de pé, ele só abre a aba. Antes de
subir ele garante o runtime — node 18+ e o CLI `claude` no PATH, carregando o nvm se
preciso — e falha com aviso na tela (`notify-send`) em vez de morrer calado.

Alternativas:

```bash
npm start                    # primeiro plano, log no terminal
npm run dev                  # com --watch: reinicia ao salvar arquivos
PORT=9000 HOST=127.0.0.1 npm start
```

## Abrir

<http://127.0.0.1:7788>

A navegação é por hash, então dá para ir direto a um painel:

| URL | Painel |
| --- | --- |
| `#/sessions` | sessões abertas |
| `#/conversations` | conversas salvas |
| `#/trash` | lixeira |
| `#/services` | mapa dos serviços do backend |

## Lançador na área de trabalho

Um clique = servidor de pé + navegador aberto. O `.desktop` **não vem no repo** (ele
carrega o caminho absoluto da pasta, que muda de máquina); gere o desta máquina:

```bash
./instalar-atalho.sh
```

Ele escreve o mesmo arquivo em dois lugares — área de trabalho e menu de aplicativos —
marca como executável e, no GNOME, marca `metadata::trusted` (sem isso o ícone da área
de trabalho não executa). O `Exec` aponta para o `start.sh`, então o atalho herda tudo
que ele faz, inclusive resolver o node/`claude` do nvm.

Para subir também no login:

```bash
mkdir -p ~/.config/autostart
cp ~/Desktop/"Claude Manager Web.desktop" ~/.config/autostart/
```

## Parar e ver log

```bash
kill $(ss -ltnp | grep 7788 | sed -E 's/.*pid=([0-9]+).*/\1/')   # parar
tail -f /tmp/claude-manager-web.log                              # log do start.sh
```

## Variáveis de ambiente

| Variável | Padrão | O quê |
| --- | --- | --- |
| `PORT` | `7788` | porta do servidor |
| `HOST` | `127.0.0.1` | interface de escuta (deixe local — veja [07](07-seguranca.md)) |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | onde ficam `projects/` e a lixeira |
| `MAX_BODY_BYTES` | `31457280` (30 MB) | limite do corpo da requisição (imagens no chat) |
| `CHAT_ALLOW_FULL_TOOLS` | (desligado) | `1` habilita os modos "automático"/"aceitar edições" no chat |

Caminhos e limites são resolvidos em `core/config.js`. As demais variáveis do chat
(`CHAT_MAX_USD`, `CHAT_TIMEOUT_MS`, …) estão em [10 · Chat](10-chat.md).
