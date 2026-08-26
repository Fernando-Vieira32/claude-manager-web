# 12 · Rodar em uma máquina nova (setup)

[← sumário](README.md)

Guia para colocar o app no ar **nesta máquina**, quando a pasta acabou de ser copiada
para cá. Pode ser seguido por uma pessoa ou entregue direto ao Claude Code ("leia o
`readme/12-rodar-em-maquina-nova.md` e deixe rodando"). É Node puro: **sem dependências,
sem `npm install`, sem build**.

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
claude auth status      # precisa mostrar { "loggedIn": true, … }
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
curl -s localhost:7788/api/_health     # { "ok": true, "uptime": … }
curl -s localhost:7788/api/_services   # { app, version, root, services: [ … ] } — 6 serviços:
                                       # chat, conversations, fs, models, sessions, settings
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
  não depende do `claude` nem das suas conversas. **Se o `npm test` reclamar do
  `--test-reporter`** (Node antigo) **ou não achar arquivo nenhum** (o `test/*.test.js` do
  script é expandido pelo shell, e o PowerShell não expande), rode `node --test test/` —
  funciona igual, sem glob e sem reporter.
- **A pasta `data/` é desta máquina.** É onde ficam as preferências (cor/modo por conversa,
  retenção da lixeira, catálogo de modelos em cache). Redirecionável com
  `DATA_DIR=/outro/caminho` — é o que os testes usam para não encostar na sua.
- **O medidor de contexto pode começar como "palpite".** A janela real do modelo vem do
  catálogo da API, buscado com a credencial do próprio CLI e guardado em `data/models.json`
  (ou com `ANTHROPIC_API_KEY`, se você preferir) — ver
  [03 · API](03-api.md#modelos-models). Até a primeira busca dar certo, o número aparece
  **marcado como palpite** em vez de se passar por fato.
- **Conversa criada pelo navegador aparece no `/resume` do terminal.** Isso depende de uma
  marca que o servidor põe no processo filho (`CHAT_ENTRYPOINT`); mexer nela faz a conversa
  sumir do seletor do terminal — o porquê está em
  [10 · Chat](10-chat.md#aparecer-no-resume-do-terminal).
- **Agente de segundo plano só aparece com o que está escrito no arquivo.** O terminal
  desenha da memória dele; aqui a fonte é o `.jsonl`, então a janela acompanha a cadência
  com que o CLI escreve — ver [10 · Chat](10-chat.md#agentes-em-segundo-plano).

## 6. O atalho `.desktop`

Não vem na pasta (carrega o caminho absoluto, que muda de máquina) e é específico do
Linux. Para criar o desta máquina — um clique sobe o servidor e abre o navegador:

```bash
./instalar-atalho.sh     # área de trabalho + menu de aplicativos
```

Detalhes em [01 · Começar](01-comecar.md#lançador-na-área-de-trabalho). Se o ícone
parecer não fazer nada, é quase sempre PATH: veja
[09 · Problemas](09-problemas.md#se-o-claude-vem-do-nvm-caso-do-atalho-desktop).
