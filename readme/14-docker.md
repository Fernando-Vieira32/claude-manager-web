# 14 · Docker (usar e desenvolver em container)

[← sumário](README.md)

Jeito de entregar o app para outra pessoa **sem ela instalar Node nem o CLI do Claude** —
e de ela também mexer no código do projeto. Basta ter Docker.

**Alvo: Linux.** Windows e Mac não estão contemplados por decisão de simplificar; o que
travaria lá está no fim desta página.

Se você vai rodar na sua própria máquina, com o Claude Code que já está instalado nela, o
caminho mais direto continua sendo o [12 · Rodar em uma máquina nova](12-rodar-em-maquina-nova.md).

## A decisão que define tudo: o CLI vai DENTRO da imagem

A imagem carrega o próprio Claude Code, em vez de usar o que está instalado na máquina.
Assim o colega não instala nada e todo mundo roda a mesma versão. A consequência honesta:

> **O container é uma máquina.** Ele tem o Claude dele, o login dele e as conversas dele.
> As conversas que você já fez no terminal de fora **não aparecem** — o `~/.claude` é outro.

O que ele não carrega é credencial: a imagem é limpa e pode ser compartilhada. O login mora
no volume `claude-home`, feito uma vez por quem usa.

## Usar

```bash
./docker-app.sh          # constrói se preciso, sobe e abre a janela
./docker-app.sh login    # uma vez: login do Claude dentro do container
```

| Comando | O que faz |
| --- | --- |
| `./docker-app.sh` | sobe (se preciso) e abre a janela do app |
| `./docker-app.sh dev` | **modo desenvolvedor** (abaixo) |
| `./docker-app.sh test` | roda `npm test` dentro, no código montado |
| `./docker-app.sh login` | login do Claude dentro do container — uma vez só |
| `./docker-app.sh parar` | desliga; login e conversas ficam nos volumes |
| `./docker-app.sh log` | acompanha o log do servidor |

Com o `.env` já criado, `docker compose up -d` também funciona — o script existe para gerar
o `.env`, esperar o healthcheck e abrir a janela.

## Desenvolver

```bash
./docker-app.sh dev      # código montado, servidor reinicia ao salvar, log na tela
./docker-app.sh test     # a suíte, no código que você acabou de editar
```

O modo dev junta o `docker-compose.yml` com o `docker-compose.dev.yml`: este último monta o
repositório por cima do `/app` da imagem e troca o comando por `node --watch server.js`. É o
mesmo `npm run dev` de sempre, só que dentro do container — salvou, reiniciou, sem
reconstruir imagem. O `Ctrl+C` só para de seguir o log; o container continua de pé
(`./docker-app.sh parar` desliga).

O `test` roda a suíte **no código montado**, não no que foi copiado para a imagem — então
vale para o que você acabou de escrever. Nada de teste automático antes de subir: igual ao
fluxo nativo, você roda quando quer.

## O `.env` (é desta máquina, não vai no repo)

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `WORK_DIR` | pasta que aparece dentro como `~/work` | seu home |
| `APP_UID` / `APP_GID` | para o que o chat editar sair como arquivo seu, não de root | seu uid/gid |
| `PORT` | porta em `127.0.0.1` | `7788` |
| `CHAT_ALLOW_FULL_TOOLS` | `1` libera automático/aceitar-edições; `0` deixa o chat só-leitura | `1` |

### Por que o padrão é o home inteiro

Dentro do container, o app enxerga **o sistema de arquivos do container** — e lá só existe o
que foi montado. O seletor de pastas ("de qual repositório esta conversa começa?") só
consegue listar o que `WORK_DIR` entregou. Montar o home devolve a mesma árvore de fora, que
é o comportamento de quem roda nativo.

O preço, dito na cara: **`~/.ssh` e `~/.claude` vão junto**, e o Claude de dentro alcança os
dois. Foi uma escolha consciente — esconder o `~/.ssh` quebraria o `git push` feito de
dentro. Quem preferir trocar comodidade por fechamento é só apontar `WORK_DIR` para uma pasta
de código (`~/dev`, `~/www`…): o resto do home deixa de existir para o container.

## Como o container é montado (e por quê)

| Peça do `docker-compose.yml` | Por quê |
| --- | --- |
| volume `claude-home` → `/home/claude` | login (`.credentials.json`), conversas e `~/.claude.json` sobrevivem ao `docker rm` |
| bind `${WORK_DIR}` → `/home/claude/work` | sem código montado, o seletor de pastas abre vazio |
| volume `app-data` → `/app/data` | preferências por conversa (cor/modo) e catálogo de modelos em cache |
| `user: uid:gid` | arquivos editados saem seus, não de root |
| `ports: 127.0.0.1:PORT:7788` | **app, não site** — o painel não tem autenticação (ver [07 · Segurança](07-seguranca.md)) |
| `HOST=0.0.0.0` na imagem | só para o `-p` alcançar o processo dentro do container; quem limita é a linha acima |
| `DISABLE_AUTOUPDATER=1` | rodando como usuário comum, o autoupdate não escreveria em `/usr/local/lib` — só geraria erro |
| `procps` e `git` na imagem | o painel Sessões usa `ps`; o chat quase sempre esbarra em `git` |

## O que muda em relação a rodar direto na máquina

- **Conversas do terminal de fora não aparecem.** É outro `~/.claude`.
- **O painel Sessões mostra os processos do container**, não os do seu terminal. É coerente:
  dentro do container, o Claude que existe é o de lá.
- **Caminhos aparecem como `/home/claude/work/…`**, que é onde o seu home está montado.

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
| build falha em `apt-get`/`npm install` com erro de conexão | a rede barra o Docker Hub ou o registro do npm (comum em rede corporativa com proxy). Saída sem depender da rede: quem já construiu roda `docker save claude-manager-web \| gzip > app.tgz` e passa o arquivo; do outro lado, `docker load < app.tgz` e `docker compose up -d` |
| `defina WORK_DIR no .env` ao subir | `.env` ausente ou sem `WORK_DIR` — rode pelo `docker-app.sh`, que o cria |
| arquivos editados saem de outro dono | `APP_UID`/`APP_GID` no `.env` não são os seus (`id -u`, `id -g`) |
| painel Conversas vazio na primeira vez | esperado: o container começa sem conversa nenhuma |

## Por que só Linux (por enquanto)

Nada aqui é impossível fora do Linux, mas cada item custa trabalho e teste:

- **`node --watch` em bind mount** no Docker Desktop (WSL2/Mac) pode não receber o evento do
  arquivo — o modo dev precisaria de polling;
- **fim de linha CRLF** no clone em Windows quebra os scripts `.sh` sem um `.gitattributes`;
- **`uid`/`gid`** não têm o mesmo sentido no Docker Desktop;
- **desempenho de bind mount no Mac** é notoriamente pior, e o modo dev depende dele.

Quando alguém precisar de verdade, o caminho é esse — não é remendo novo, é testar esses
quatro pontos.
