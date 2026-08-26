# 14 · Docker (rodar em qualquer PC)

[← sumário](README.md)

Jeito de entregar o app para outra pessoa **sem ela instalar nada além do Docker** —
nem Node, nem o CLI do Claude. Funciona igual em Linux, Windows e Mac.

Se você vai rodar na sua própria máquina, com o Claude Code que já está instalado nela,
o caminho continua sendo o [12 · Rodar em uma máquina nova](12-rodar-em-maquina-nova.md):
é mais direto e enxerga as conversas que você já tem.

## A decisão que define tudo: o CLI vai DENTRO da imagem

Um container Linux **não executa o binário do host**: no Windows o `claude` é um `.exe`,
no Mac é Mach-O. Não é problema de caminho nem de montagem — é formato de executável.
Usar o `claude` já instalado na máquina só funcionaria em Linux.

Por isso a imagem carrega o próprio Claude Code. A consequência honesta:

> **O container é uma máquina.** Ele tem o Claude dele, o login dele e as conversas
> dele. As conversas que você já fez no terminal de fora **não aparecem** — os caminhos
> e o `~/.claude` são outros.

O que ele não carrega é credencial: a imagem é limpa e pode ser compartilhada. O login
mora no volume `claude-home`, feito uma vez por quem usa.

## Subir

```bash
./docker-app.sh          # Linux/Mac  — constrói se preciso, sobe e abre a janela
docker-app.cmd           # Windows
```

Na primeira vez ele cria um `.env` com a sua pasta de código e avisa que falta login:

```bash
./docker-app.sh login    # docker-app.cmd login no Windows
```

Depois é só `./docker-app.sh` sempre que quiser abrir. Outros comandos:

| Comando | O que faz |
| --- | --- |
| `./docker-app.sh` | sobe (se preciso) e abre a janela do app |
| `./docker-app.sh login` | login do Claude dentro do container — uma vez só |
| `./docker-app.sh parar` | desliga; login e conversas ficam nos volumes |
| `./docker-app.sh log` | acompanha o log do servidor |

Com o `.env` já criado, `docker compose up -d` também funciona — o script só existe
para gerar o `.env`, esperar o healthcheck e abrir a janela.

## O `.env` (é desta máquina, não vai no repo)

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `WORK_DIR` | pasta do **seu código**, do lado de fora; vira `~/work` dentro | seu home |
| `APP_UID` / `APP_GID` | no Linux, para o que o chat editar sair como arquivo seu, não de root | seu uid/gid |
| `PORT` | porta em `127.0.0.1` | `7788` |
| `CHAT_ALLOW_FULL_TOOLS` | `1` libera automático/aceitar-edições; `0` deixa o chat só-leitura | `1` |

**Vale estreitar o `WORK_DIR`.** O padrão é o home inteiro porque funciona para todo
mundo, mas o Claude trata a pasta montada como *workspace* — se ela for o seu home, o seu
`~/.claude/settings.json` pessoal vira "configuração do projeto" lá dentro e o CLI reclama
("Ignoring N permissions.allow entries…"). Apontar `WORK_DIR` para `~/dev`, `~/www` ou
o que for a sua pasta de código resolve e é mais limpo.

## Como o container é montado (e por quê)

| Peça do `docker-compose.yml` | Por quê |
| --- | --- |
| volume `claude-home` → `/home/claude` | login (`.credentials.json`), conversas e `~/.claude.json` sobrevivem ao `docker rm` |
| bind `${WORK_DIR}` → `/home/claude/work` | sem código montado, o Claude não tem no que mexer |
| volume `app-data` → `/app/data` | preferências por conversa (cor/modo) e o catálogo de modelos em cache |
| `user: uid:gid` | Linux: arquivos editados saem seus. Windows/Mac: o Docker Desktop já traduz dono |
| `ports: 127.0.0.1:PORT:7788` | **app, não site** — o painel não tem autenticação (ver [07 · Segurança](07-seguranca.md)) |
| `HOST=0.0.0.0` na imagem | só para o `-p` alcançar o processo dentro do container; quem limita é a linha acima |
| `DISABLE_AUTOUPDATER=1` | rodando como usuário comum, o autoupdate não escreveria em `/usr/local/lib` — só geraria erro |
| `procps` e `git` na imagem | o painel Sessões usa `ps`; o chat quase sempre esbarra em `git` |

## O que muda em relação a rodar direto na máquina

- **Conversas do terminal de fora não aparecem.** É outro `~/.claude`. Só se juntam se
  você (em Linux ou WSL) montar o home de verdade — aí o caminho precisa ser idêntico
  dentro e fora, porque o transcript guarda `cwd` absoluto (`core/claude-paths.js`).
- **O painel Sessões mostra os processos do container**, não os do seu terminal. É
  coerente: dentro do container, o Claude que existe é o de lá.
- **Caminhos aparecem como `/home/claude/work/…`**, que é onde o seu código está montado.

## Atualizar, parar, apagar

```bash
./docker-app.sh parar                 # desliga, guardando login e conversas
docker compose build --no-cache       # atualiza a imagem (pega CLI e app novos)
docker compose down -v                # APAGA os volumes: login e conversas do container
```

## Problemas comuns

| Sintoma | Causa |
| --- | --- |
| `failed to bind host port 127.0.0.1:7788: address already in use` | já tem servidor nessa porta (o `./start.sh` nativo, por exemplo). Pare o outro ou mude `PORT` no `.env` |
| chat responde `Not logged in · Please run /login` | falta o `./docker-app.sh login` |
| `defina WORK_DIR no .env` ao subir | `.env` ausente ou sem `WORK_DIR` — rode pelo `docker-app.sh`, que o cria |
| arquivos editados saem de outro dono (Linux) | `APP_UID`/`APP_GID` no `.env` não são os seus (`id -u`, `id -g`) |
| painel Conversas vazio na primeira vez | esperado: o container começa sem conversa nenhuma |

## O que foi verificado

Construído e subido de verdade (imagem ~573 MB, `claude 2.1.246` dentro):

- `/api/_health` e `/api/_services` respondendo, com os 6 serviços;
- `/api/fs` enxergando `~/work` com as pastas de fora — o bind está certo;
- `/api/sessions` funcionando (o `ps` existe na imagem);
- **chat até o fim do encanamento**: `POST /api/chat` gerou `init` (pid, cwd
  `/home/claude/work`), `system` com o modelo e parou em `Not logged in` — ou seja,
  binário encontrado, `spawn` certo, SSE traduzido. O que falta testar é o turno
  completo, que depende do `login` (fluxo de navegador, feito pelo dono).
