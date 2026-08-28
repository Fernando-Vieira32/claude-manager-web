# 01 · Começar

[← sumário](README.md)

## Requisitos

- **Docker** (com o plugin `compose`) — `docker compose version`
- **Linux** — o desenho monta o seu home no mesmo caminho dentro do container; o porquê
  está em [14 · Docker](14-docker.md#por-que-só-linux)
- **Claude Code já usado nesta máquina** (`~/.claude` com login). Se nunca usou:
  `./docker-app.sh login`
- Um navegador moderno (ES modules nativos; nada é transpilado)

Não há `npm install`: o projeto não tem dependências. Node também não é requisito **seu** —
ele vem dentro da imagem.

## Subir

```bash
cd ~/www/personal/claude-manager-web
./docker-app.sh          # constrói se preciso, sobe e abre a janela do app
```

O script é idempotente: se o container já estiver de pé, ele só abre a janela. Na primeira
vez ele cria o `.env` desta máquina (seu home, seu uid, a porta) e espera o healthcheck da
imagem antes de abrir — em vez de dormir um tempo fixo e torcer.

**O app não roda fora do container.** `node server.js` na máquina se recusa a subir e diz
o que fazer. Foi decisão de projeto: um jeito só de rodar é um jeito só de dar errado.

| Comando | O que faz |
| --- | --- |
| `./docker-app.sh` | sobe (se preciso) e abre a janela |
| `./docker-app.sh dev` | modo desenvolvedor: código montado, reinicia ao salvar, log na tela |
| `./docker-app.sh test` | roda a suíte dentro do container |
| `./docker-app.sh login` | login do Claude, se esta máquina ainda não tem |
| `./docker-app.sh parar` | desliga |
| `./docker-app.sh log` | acompanha o log do servidor |

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

Um clique = container de pé + janela aberta. O `.desktop` **não vem no repo** (ele carrega
o caminho absoluto da pasta, que muda de máquina); gere o desta máquina:

```bash
./instalar-atalho.sh
```

Ele escreve o mesmo arquivo em dois lugares — área de trabalho e menu de aplicativos —
marca como executável e, no GNOME, marca `metadata::trusted` (sem isso o ícone da área de
trabalho não executa). O `Exec` aponta para o `docker-app.sh`.

Um `.desktop` não tem terminal nem carrega o seu `~/.zshrc`, e é por isso que o script abre
o navegador com `setsid`: sem isso a janela morreria junto com o processo do clique.

Para subir também no login:

```bash
mkdir -p ~/.config/autostart
cp ~/Desktop/"Claude Manager Web.desktop" ~/.config/autostart/
```

## Parar e ver log

```bash
./docker-app.sh parar     # desliga o container
./docker-app.sh log       # log do servidor, ao vivo
```

O indicador no rodapé da página também desliga e reinicia o servidor. **Reiniciar** sai com
código de falha e o Docker sobe de novo; **Desligar** sai com 0 e fica desligado — para
religar, o terminal (o navegador não liga um servidor morto).

## Configuração (`.env`)

O `.env` é gerado pelo `docker-app.sh` e é **desta máquina** — não vai no repositório.

| Variável | Padrão | O quê |
| --- | --- | --- |
| `HOST_HOME` | seu `$HOME` | seu home; entra no container no **mesmo caminho** |
| `APP_UID` / `APP_GID` | seu `id -u`/`id -g` | roda com o seu usuário: arquivo editado sai seu |
| `PORT` | `7788` | porta publicada em `127.0.0.1` |
| `CHAT_ALLOW_FULL_TOOLS` | `1` | `0` deixa o chat só-leitura (sem "automático"/"aceitar edições") |

Dentro da imagem ficam fixos `HOST=0.0.0.0` (para o `-p` alcançar o processo — quem limita
a exposição é o compose), `IN_CONTAINER=1` e `DISABLE_AUTOUPDATER=1`. Outras variáveis que
o `core/config.js` entende (`CLAUDE_CONFIG_DIR`, `DATA_DIR`, `MAX_BODY_BYTES`) e as do chat
(`CHAT_MAX_USD`, `CHAT_TIMEOUT_MS`, …) podem ser acrescentadas ao bloco `environment:` do
`docker-compose.yml`; ver [10 · Chat](10-chat.md) e [14 · Docker](14-docker.md).
