# 12 · Rodar em uma máquina nova (setup)

[← sumário](README.md)

Guia para colocar o app no ar **nesta máquina**, quando a pasta acabou de chegar aqui. Pode
ser seguido por uma pessoa ou entregue direto ao Claude Code ("leia o
`readme/12-rodar-em-maquina-nova.md` e deixe rodando").

O app roda **em container** — é o único jeito suportado. O detalhamento das escolhas está em
[14 · Docker](14-docker.md); aqui é só o passo a passo.

## O que este app é (e do que depende)

Painel local que **gerencia o Claude Code desta máquina**: lista/encerra sessões, e
lista/lê/inicia/continua conversas. O container traz o Node e o CLI `claude`, mas o que dá
conteúdo à tela é o **seu** `~/.claude`, montado de fora. Ou seja: a pasta do projeto é só
o servidor + o front; as conversas e o login são da máquina.

## 1. Pré-requisitos (cheque cada um)

```bash
docker compose version    # Docker com o plugin compose
uname -s                  # Linux (o porquê está no 14)
ls ~/.claude              # o Claude Code já foi usado aqui?
```

| Checagem | Se faltar |
| --- | --- |
| **Docker + compose** | instale o Docker Engine e o plugin `docker-compose-plugin` |
| **Linux** | o desenho monta o home no mesmo caminho; ver [14](14-docker.md#por-que-só-linux) |
| **`~/.claude` com login** | não é impedimento: rode `./docker-app.sh login` depois de subir |
| **Seu usuário no grupo `docker`** | `sudo usermod -aG docker $USER` e reabra a sessão |

> Nenhuma credencial é copiada, lida ou embutida na imagem. Quem autentica é o CLI
> `claude`, e ele lê isso do `~/.claude` da própria máquina.

## 2. Subir

```bash
cd caminho/para/claude-manager-web
chmod +x docker-app.sh    # só se o executável não veio marcado
./docker-app.sh           # constrói, sobe na porta 7788 e abre a janela
```

A primeira execução constrói a imagem (alguns minutos) e cria o `.env` desta máquina — seu
home, seu uid, a porta. Da segunda em diante é imediato.

O `.env` vem com `CHAT_ALLOW_FULL_TOOLS=1`: o chat pode editar arquivos e rodar comandos
**sem perguntar**. Para deixar só-leitura, troque por `0` e suba de novo — ver
[07 · Segurança](07-seguranca.md).

## 3. Verificar que subiu

```bash
curl -s localhost:7788/api/_health     # { "ok": true, "uptime": … }
curl -s localhost:7788/api/_services   # 6 serviços: chat, conversations, fs,
                                       # models, sessions, settings
```

Depois abra **<http://127.0.0.1:7788>** — ou use a janela que o script abriu.

## 4. Se algo falhar

```bash
./docker-app.sh log        # o que o servidor disse
docker compose ps          # o container está de pé? saudável?
```

Os erros comuns (porta ocupada, build barrado pela rede, falta de login) estão em
[14 · Docker](14-docker.md#problemas-comuns) e [09 · Problemas](09-problemas.md).

## 5. O que é normal numa máquina nova

- **`data/` vazio** (ou ausente): as preferências por conversa (cor/modo) são amarradas ao
  id da conversa da máquina de origem, então não se aplicam aqui. A pasta é recriada
  sozinha — ver [03 · API](03-api.md#configurações-settings).
- **Lista de conversas/sessões diferente:** ela reflete o Claude Code **desta** máquina,
  não o da origem. Isso é o esperado.
- **Sessões sem o projeto em cada linha:** o perfil AppArmor do Docker impede ler o `cwd`
  de processo de fora. Encerrar sessão continua funcionando — ver
  [14 · Docker](14-docker.md#a-única-diferença-que-sobrou).
- Nada de `node_modules`: o projeto não tem dependências. `./docker-app.sh test` roda a
  suíte dentro do container (ver [13 · Testes](13-testes.md)) e é uma boa primeira
  verificação, porque não depende do `claude` nem das suas conversas.

## 6. O atalho `.desktop`

Não vem na pasta (carrega o caminho absoluto, que muda de máquina) e é específico do Linux.
Para criar o desta máquina — um clique sobe o container e abre a janela:

```bash
./instalar-atalho.sh     # área de trabalho + menu de aplicativos
```

Detalhes em [01 · Começar](01-comecar.md#lançador-na-área-de-trabalho).
