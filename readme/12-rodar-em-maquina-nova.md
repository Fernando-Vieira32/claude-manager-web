# 12 · Rodar em uma máquina nova (setup)

[← sumário](README.md)

Guia para colocar o app no ar **nesta máquina**, quando a pasta acabou de ser copiada
para cá. Pode ser seguido por uma pessoa ou entregue direto ao Claude Code ("leia o
`readme/12-rodar-em-maquina-nova.md` e deixe rodando"). É Node puro: **sem dependências,
sem `npm install`, sem build**.

> **Entregando para outra pessoa (Linux)?** Se ela não tem (nem quer ter) Node e o CLI do
> Claude instalados, existe o caminho de container: [14 · Docker](14-docker.md). O Claude Code
> vai **dentro da imagem**, e o home entra montado no mesmo caminho — então as conversas, o
> login e as sessões são os da máquina, como no modo nativo. Serve também para mexer no
> código do projeto sem instalar nada.

## O que este app é (e do que depende)

Painel local que **gerencia o Claude Code desta máquina**: lista/encerra sessões, e
lista/lê/inicia/continua conversas. Ele lê as conversas de `~/.claude/projects` **daqui**
e o chat dispara o binário `claude` **daqui**. Portanto, o que faz a interface ter
conteúdo e o chat funcionar não vem na pasta — vem do Claude Code instalado nesta
máquina. A pasta é só o servidor + o front.

## 1. Pré-requisitos (cheque cada um)

```bash
node --version          # precisa ser v18 ou maior
claude --version        # o CLI do Claude Code precisa existir no PATH
claude auth status      # precisa mostrar que está logado (método/organização/e-mail)
```

| Checagem | Se faltar |
| --- | --- |
| **Node 18+** | instale o Node (nodejs.org ou o gerenciador do sistema) e refaça `node --version` |
| **`claude` no PATH** | instale o Claude Code CLI; sem ele o chat/compactar não roda |
| **`claude auth status` logado** | rode `claude login` (o dono da máquina faz o login) |
| **Linux com `ps` e `/proc`** | só afeta o painel **Sessões**; o resto funciona sem |

> Não é preciso ler nem copiar credenciais: quem autentica é o próprio CLI `claude`.
> Se `claude auth status` disser que não está logado, é o dono quem roda `claude login`.

## 2. Subir

**Linux / macOS**

```bash
cd caminho/para/claude-manager-web
chmod +x start.sh        # só se o executável não veio marcado
./start.sh               # sobe na porta 7788 e tenta abrir o navegador
```

`start.sh` liga `CHAT_ALLOW_FULL_TOOLS=1` (o chat pode editar arquivos e rodar comandos
sem perguntar). Para deixar o chat só-leitura, edite o `start.sh` — ver
[07 · Segurança](07-seguranca.md).

**Windows** (o `start.sh` é bash; use o npm)

```powershell
cd caminho\para\claude-manager-web
npm start
#   $env:CHAT_ALLOW_FULL_TOOLS=1 ; npm start   # com os modos automático/aceitar-edições
```

Outras formas e variáveis (`PORT`, `HOST`, `CLAUDE_CONFIG_DIR`…) estão em
[01 · Começar](01-comecar.md).

## 3. Verificar que subiu

```bash
curl -s localhost:7788/api/_health            # { "ok": true, ... }
curl -s localhost:7788/api/_services          # deve listar 5 serviços:
                                              # chat, conversations, fs, sessions, settings
```

Depois abra **<http://127.0.0.1:7788>** no navegador.

## 4. Se o chat/compactar falhar com "não encontrei o binário claude"

O servidor não achou o `claude` no `PATH` do processo (`spawn claude ENOENT`). Aponte o
caminho explicitamente e reinicie:

```bash
CLAUDE_BIN=/caminho/para/claude ./start.sh
```

Detalhes e outros erros comuns em [09 · Problemas](09-problemas.md).

## 5. O que é normal numa máquina nova

- **`data/conversas/` vazio** (ou ausente): as preferências por conversa (cor/modo) são
  amarradas ao id da conversa da máquina de origem, então não se aplicam aqui. A pasta é
  recriada sozinha quando você salvar a primeira config — ver
  [03 · API](03-api.md#configurações-settings).
- **Lista de conversas/sessões diferente:** ela reflete o Claude Code **desta** máquina,
  não o da origem. Isso é o esperado.
- Nada de `node_modules`: o projeto não tem dependências. Isso vale para os testes
  também — `npm test` roda com o runner embutido do Node, sem instalar nada (ver
  [13 · Testes](13-testes.md)). É uma boa primeira verificação nesta máquina, porque
  não depende do `claude` nem das suas conversas.

## 6. O atalho `.desktop`

Não vem na pasta (carrega o caminho absoluto, que muda de máquina) e é específico do
Linux. Para criar o desta máquina — um clique sobe o servidor e abre o navegador:

```bash
./instalar-atalho.sh     # área de trabalho + menu de aplicativos
```

Detalhes em [01 · Começar](01-comecar.md#lançador-na-área-de-trabalho). Se o ícone
parecer não fazer nada, é quase sempre PATH: veja
[09 · Problemas](09-problemas.md#se-o-claude-vem-do-nvm-caso-do-atalho-desktop).
