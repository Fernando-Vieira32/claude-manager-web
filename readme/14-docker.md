# 14 · Docker (usar e desenvolver em container)

[← sumário](README.md)

Jeito de rodar o app **sem instalar Node nem o CLI do Claude** — e de mexer no código do
projeto do mesmo jeito. Basta ter Docker.

**Alvo: Linux.** O motivo está no [fim desta página](#por-que-só-linux) e é técnico, não
preguiça.

## A ideia: o container é o ambiente, a máquina continua sendo a sua

O container carrega o Node e o Claude Code. O que ele **não** carrega é a sua vida: o home
entra montado **no mesmo caminho** dentro e fora (`/home/você` → `/home/você`). Isso faz
tudo se encaixar sozinho:

- o `~/.claude` que o app lê é o seu → **as conversas do terminal aparecem**;
- o login também é o seu → não existe "logar de novo";
- o `cwd` gravado em cada transcrição existe de verdade lá dentro → **continuar uma
  conversa funciona**;
- conversa criada aqui nasce no seu `~/.claude/projects` → aparece no `/resume` do terminal.

A imagem em si é limpa: nenhuma credencial dentro dela, então dá para compartilhar.

## Usar

```bash
./docker-app.sh          # constrói se preciso, sobe e abre a janela do app
```

| Comando | O que faz |
| --- | --- |
| `./docker-app.sh` | sobe (se preciso) e abre a janela |
| `./docker-app.sh dev` | **modo desenvolvedor** (abaixo) |
| `./docker-app.sh test` | roda `npm test` dentro, no código montado |
| `./docker-app.sh login` | só se você nunca usou o Claude Code nesta máquina |
| `./docker-app.sh parar` | desliga |
| `./docker-app.sh log` | acompanha o log do servidor |

Com o `.env` já criado, `docker compose up -d` também funciona — o script existe para gerar
o `.env`, esperar o healthcheck e abrir a janela (em janela de app, sem barra de endereço).

## Desenvolver

```bash
./docker-app.sh dev      # código montado, servidor reinicia ao salvar, log na tela
./docker-app.sh test     # a suíte, no código que você acabou de editar
```

O modo dev junta o `docker-compose.yml` com o `docker-compose.dev.yml`: este último monta o
repositório por cima do `/app` da imagem e troca o comando por `node --watch server.js`. É o
mesmo `npm run dev`, só que dentro — salvou, reiniciou, sem reconstruir imagem. O `Ctrl+C`
só para de seguir o log; para desligar, `./docker-app.sh parar`.

O `test` roda a suíte **no código montado**, não no que foi copiado para a imagem. Nada de
teste automático antes de subir: igual ao fluxo nativo, você roda quando quer.

## O `.env` (é desta máquina, não vai no repo)

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `HOST_HOME` | seu home; entra no container **no mesmo caminho** | `$HOME` |
| `APP_UID` / `APP_GID` | rodar com o seu uid: arquivos editados saem seus e o `~/.claude` é legível | seu `id -u`/`id -g` |
| `PORT` | porta em `127.0.0.1` | `7788` |
| `CHAT_ALLOW_FULL_TOOLS` | `1` libera automático/aceitar-edições; `0` deixa o chat só-leitura | `1` |

## Como o container é montado (e por quê)

| Peça do `docker-compose.yml` | Por quê |
| --- | --- |
| `HOME=${HOST_HOME}` | sem isto o Node cairia no `/home/claude` da imagem (o uid não existe no `/etc/passwd`) e o app não veria nada seu |
| bind `${HOST_HOME}` → **mesmo caminho** | é o que faz conversa, login e `cwd` baterem. Trocar por outro ponto de montagem quebra continuar conversa |
| bind `./data` → `/app/data` | as preferências (cor/modo por conversa) são as mesmas do modo nativo |
| `user: uid:gid` | arquivos editados saem seus; encerrar sessão do terminal exige o mesmo usuário |
| `pid: host` | sem isto o painel **Sessões** fica sempre vazio: ele lê `ps`, e o container só vê os processos dele |
| `ports: 127.0.0.1:PORT:7788` | **app, não site** — o painel não tem autenticação (ver [07 · Segurança](07-seguranca.md)) |
| `HOST=0.0.0.0` na imagem | só para o `-p` alcançar o processo dentro do container; quem limita é a linha acima |
| `DISABLE_AUTOUPDATER=1` | rodando como usuário comum, o autoupdate não escreveria em `/usr/local/lib` — só geraria erro |
| `procps` e `git` na imagem | o painel Sessões usa `ps`; o chat quase sempre esbarra em `git` |

## Paridade medida (container × nativo)

Rodando os dois lado a lado, mesma máquina:

| O quê | Nativo | Container |
| --- | --- | --- |
| Conversas listadas | 52 | **52** |
| Sessões abertas | 3 | **3** |
| Seletor de pastas (`/api/fs`) | home real | **home real, mesmo caminho** |
| `npm test` | 172/172 | **172/172** |
| Turno de chat de verdade | ok | **ok** (`ok:true`, 1,9 s) |

### A única diferença que sobrou

Na lista de Sessões, o **`cwd` de cada sessão vem vazio** no container — e é o `cwd` que
liga a sessão ao projeto/conversa dela. A causa é o perfil AppArmor padrão do Docker, que
impede ler `/proc/<pid>/cwd` de um processo de fora do container (medido: `EACCES` no perfil
padrão, caminho correto com `apparmor=unconfined`). Enviar sinal é permitido, então
**encerrar sessão continua funcionando**.

A escolha aqui foi manter o container confinado. Se você quiser a coluna de volta, é uma
linha no `docker-compose.yml`:

```yaml
    security_opt: [ "apparmor=unconfined" ]
```

Em troca, o container perde o confinamento do AppArmor inteiro — não só essa leitura. Não
vale a pena por uma coluna.

## Segurança, sem meias palavras

O container roda com o seu home montado, o seu uid, a sua credencial do Claude e, por
padrão, os modos automático/aceitar-edições ligados. **Ele não é sandbox** — tem o mesmo
alcance que o processo teria solto na sua máquina. O que o Docker resolve aqui é
instalação (Node e CLI), não isolamento. Ver [07 · Segurança](07-seguranca.md).

## Atualizar, parar, apagar

```bash
./docker-app.sh parar                 # desliga
docker compose build --no-cache        # atualiza a imagem (pega CLI e app novos)
docker compose down --rmi local        # apaga o container e a imagem
```

Não existe volume com dados seus para apagar: conversas e login moram no seu home, e as
preferências em `./data`. Desligar ou remover o container não perde nada.

## Problemas comuns

| Sintoma | Causa |
| --- | --- |
| `failed to bind host port 127.0.0.1:7788: address already in use` | outro programa já está nessa porta. Descubra com `ss -ltnp \| grep 7788` ou troque `PORT` no `.env` |
| `defina HOST_HOME no .env` ao subir | `.env` antigo ou ausente — rode pelo `docker-app.sh`, que preenche |
| chat responde `Not logged in · Please run /login` | esta máquina nunca usou o Claude Code: `./docker-app.sh login` |
| build falha em `apt-get`/`npm install` com erro de conexão | a rede barra o Docker Hub ou o npm (comum em rede corporativa com proxy). Saída sem depender da rede: quem já construiu roda `docker save claude-manager-web \| gzip > app.tgz`; do outro lado, `docker load < app.tgz` e `docker compose up -d` |
| Sessões vazio | falta o `pid: host` no compose |
| Sessões sem projeto/conversa em cada linha | o `cwd` bloqueado pelo AppArmor — ver acima |

## Por que só Linux

O encaixe todo depende de **montar o home no mesmo caminho dentro e fora**, porque as
transcrições guardam `cwd` absoluto e o nome da pasta em `~/.claude/projects` é derivado
dele (`core/claude-paths.js`). Em Windows isso é impossível (`C:\Users\joão` não vira
`/home/joão`), e no Docker Desktop (Windows/Mac) o `pid: host` alcança a VM, não o sistema
de verdade.

Para funcionar fora do Linux, o desenho teria de ser outro: container como máquina própria,
com Claude e conversas dele — o que resolve a portabilidade e perde a paridade. Está
registrado em `docs/brainstorms/2026-08-27-dockerizacao-brainstorm.md`.
