# Dockerização para os colegas — brainstorm

**Data:** 2026-08-27 · **Branch:** `feat/dockerizacao` · **Estado:** desenho fechado; parte já commitada em `08dc0d8`, com ajustes pendentes

> Documento de processo, por isso fora de `readme/` — o `readme/` é a documentação do
> produto. O que sair daqui vira `readme/14-docker.md`.

## O que estamos construindo

Um jeito de entregar o **claude-manager-web** para colegas programadores rodarem sem
instalar Node nem o CLI do Claude — e de eles também **mexerem no código**, já que a ideia
é que ajudem a melhorar o projeto.

Cada um clona o repositório e constrói a imagem na própria máquina. Não há imagem
publicada, nem registro, nem credencial em lugar nenhum.

**Alvo: Linux**, por decisão de simplificar. Windows e Mac ficam para quando a necessidade
aparecer de verdade.

## Por que este caminho

**O CLI do Claude vai dentro da imagem.** O motivo original era Windows/Mac (container
Linux não executa `.exe` nem Mach-O). Com o alvo reduzido a Linux isso deixou de ser
obrigatório — dava para usar o `claude` do host —, mas continua sendo a escolha: o colega
não instala nada e todo mundo roda a mesma versão. Voltar atrás é uma linha de montagem.

**O container é o ambiente; a máquina continua sendo a do dono.** *(revisto em 27/08, depois
de ver a tela)* A primeira versão dava ao container um `~/.claude` próprio — e o painel
Conversas abriu vazio, o que contraria o critério de paridade. Agora o home entra montado no
**mesmo caminho** dentro e fora: as conversas do terminal aparecem, o login já vale, e o
`cwd` gravado nas transcrições existe lá dentro (é o que permite continuar uma conversa).
Isso é exatamente o que torna o desenho **dependente de Linux**.

**Clonar e construir** (em vez de publicar imagem) cai bem porque o público é
programador e vai contribuir: quem já tem o repositório não ganha nada com um registro, e
some a preocupação de imagem multi-arquitetura — cada um constrói na arquitetura dele.

**Paridade é o critério.** Dentro do container tudo deve funcionar como funciona hoje
nativo: o seletor de pastas mostrando a mesma árvore, `npm test` rodando quando você pede,
`git push` do Claude funcionando. Onde a paridade custa algo, está escrito abaixo.

## Decisões

| # | Decisão | Por quê | Consequência |
| --- | --- | --- | --- |
| 1 | CLI do Claude dentro da imagem | colega não instala nada; mesma versão para todos | imagem maior (573 MB); nenhuma credencial dentro dela |
| 1b | **Home do dono montado no mesmo caminho** (revisto) | paridade: conversas, login e `cwd` das transcrições só batem assim | amarra o desenho ao Linux |
| 2 | Alvo Linux | simplifica: sem `.cmd`, sem CRLF, sem WSL2 | Windows/Mac só quando alguém precisar |
| 3 | Entrega por clone + build local | público é dev; evita registro e multi-arch | build de alguns minutos na primeira vez |
| 4 | `docker-compose.yml` + `docker-compose.dev.yml` | separa "usar" de "desenvolver" sem depender de editor | duas peças pequenas em vez de devcontainer |
| 5 | Modo dev: código montado + `node --watch`, e `npm test` dentro **sob comando** | igual ao fluxo nativo de hoje (`npm run dev`, `npm test` quando você quer) | nada de teste automático atrasando o `up` |
| 6 | **Home inteiro montado, no mesmo caminho** | dentro do container o app só vê o que foi montado; e o caminho tem de ser idêntico para `cwd` e `projects/` baterem | `~/.ssh` e `~/.claude` visíveis para o Claude de dentro — **aceito conscientemente**: é o que mantém `git push` e o login funcionando |
| 10 | `pid: host`, mas AppArmor mantido | sem `pid: host` o painel Sessões fica vazio; abrir o AppArmor daria a última coluna e custaria o confinamento inteiro | Sessões lista e encerra; o `cwd` de cada sessão fica vazio (medido: `EACCES`) |
| 7 | Nenhuma credencial no repositório nem na imagem | o repo é compartilhado | cada dev faz `login` uma vez dentro do container |
| 8 | Porta publicada só em `127.0.0.1` | o painel não tem autenticação | ninguém na rede alcança — é app, não site |
| 9 | Assumir internet livre no build | não dá para saber antes de tentar se a rede da empresa barra Docker Hub/npm | se falhar: documentado em Problemas, e a saída é passar a imagem por `docker save` |

## O que já está feito (commitado em `feat/dockerizacao`)

`Dockerfile` (imagem com CLI, `procps`, `git`), `docker-compose.yml`, `docker-app.sh`,
`docker-app.cmd`, `.dockerignore`, `readme/14-docker.md`.

Verificado em Linux: imagem sobe (573 MB, `claude 2.1.246`), 6 serviços respondem, pasta
montada aparece no `/api/fs`, e o chat vai até `Not logged in` — ou seja, `spawn` e SSE
corretos. `npm test` 172/172, sem mudar uma linha do app.

## O que falta

| Pendência | Situação |
| --- | --- |
| Modo dev (`docker-compose.dev.yml`, `./docker-app.sh dev` e `test`) | **feito** — `--watch` reinicia ao salvar (provado pelo `uptime` zerando) e a suíte roda dentro: 172/172 |
| Apagar o `docker-app.cmd` e as menções a Windows/Mac | **feito** — `readme/14` reescrito para Linux, com a lista do que travaria fora |
| Confirmar que o seletor de pastas mostra a árvore esperada | **feito** — 18 pastas dentro, 18 fora |
| Parágrafo de "build falhou por rede" em Problemas | **feito** — com a saída por `docker save`/`docker load` |
| `claude login` dentro do container, ponta a ponta | **resolvido pelo pivô** — o login é o do dono, então o chat completou um turno real (`ok:true`, 1,9 s) sem login novo |
| Paridade medida | **feita** — conversas 52/52, sessões 3/3, `npm test` 172/172, turno de chat ok. Única diferença: `cwd` das sessões (AppArmor) |

## Perguntas resolvidas

- **Como os colegas recebem?** Clonam e constroem.
- **Quais sistemas?** Só Linux, por ora.
- **Container serve para desenvolver?** Sim, modo dev completo (watch + testes dentro).
- **Estrutura?** Compose + override de dev, sem devcontainer.
- **Qual pasta o Claude enxerga?** O home, para o seletor ficar igual ao de hoje.
- **`~/.ssh` e `~/.claude` expostos?** Sim, aceito — esconder quebraria o `git push`.
- **`npm test` automático?** Não: só sob comando, como hoje.
- **Rede corporativa?** Assumir livre; documentar a falha e a saída manual.
