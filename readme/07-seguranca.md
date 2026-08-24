# 07 · Segurança

[← sumário](README.md)

Este painel encerra processos e move arquivos. As decisões abaixo são o que o
mantém seguro — se você for estender, mantenha-as.

## Só escuta local

`core/config.js` fixa `host: 127.0.0.1`. Não há autenticação porque nada é
alcançável de fora da máquina. **Não** exponha em `0.0.0.0` nem coloque atrás de um
túnel/proxy sem antes adicionar autenticação — qualquer um com acesso à porta pode
matar processos e ler suas conversas.

## Encerrar sessões

- Só mata PIDs que o próprio serviço listou como sessão do Claude: o `kill` refaz o
  `ps`, procura o PID e recusa com 404 se não estiver lá (`services/sessions/repo.js`).
- Só aceita `SIGTERM`, `SIGINT`, `SIGKILL` — qualquer outro sinal é 400.
- `SIGKILL` nunca é automático: a API é chamada de novo, e na interface isso exige
  clicar em "Forçar SIGKILL" no toast.
- `EPERM` vira 409 com mensagem clara (processo de outro usuário).

## Deletar conversas

- Nunca é `unlink`: é `rename` para `~/.claude/.trash-conversas`, com nome
  `AAAAMMDD-HHMMSS_<projeto>_<sessao>.jsonl`.
- A restauração devolve o arquivo ao projeto de origem lendo esse nome.
- A interface avisa antes (modal) e oferece **Desfazer** no toast (5 s — teto de
  `TOAST_MS` em `core/ui.js`).

## Apagar da lixeira de vez (`/trash/purge`)

É o **único** caminho do app que apaga arquivo de conversa sem volta. As decisões:

- **nunca automático.** Não há expiração, cron nem varredura no boot: só apaga quando
  alguém clica. A retenção configurada é um *parâmetro do botão*, não um agendamento;
- **só por idade, nunca "tudo".** `value` é inteiro de 1 a 999 e `unit` só pode ser
  `days`/`months`/`years`; não existe forma de pedir "apague a lixeira inteira" numa
  chamada — o mais agressivo possível é 1 dia, que ainda poupa o que foi deletado hoje;
- **`dryRun` antes.** A interface pergunta primeiro o que iria embora e mostra
  quantidade e tamanho no modal; só depois manda a chamada real;
- **nomes não vêm do cliente.** Os arquivos a apagar saem do `listTrash()` do próprio
  serviço (já restrito a `.jsonl` dentro de `trashDir`) — o corpo da requisição só
  informa idade, então não há caminho para travessia de diretório;
- fora do app, esvaziar na mão continua valendo: `rm -rf ~/.claude/.trash-conversas`.

## Caminhos e ids

- Id de conversa é validado por regex e resolvido com `path.resolve`, exigindo que
  o resultado esteja dentro de `config.projectsDir`.
- Nome de arquivo da lixeira é validado por regex antes de qualquer `rename`.
- Estáticos: `core/static.js` resolve o caminho e recusa (403) o que sair de
  `public/` — nada de `../../etc/passwd`.
- Corpo de requisição limitado a ~1 MB (`readJsonBody`), JSON inválido é 400.

## Comandos externos

`services/sessions/repo.js` usa `execFile('ps', [...])`, sem shell e sem
interpolar entrada do usuário. Se precisar rodar outro binário, siga o mesmo
padrão — `exec` com string montada é injeção esperando acontecer.

## Ao adicionar recursos que escrevem

Quando você chegar ao editor (gravar arquivos), leve estas quatro:

1. raiz permitida explícita (uma constante), validada com `resolve` + `startsWith`;
2. limite de tamanho na leitura e na escrita;
3. escrita atômica: grave em `arquivo.tmp` e depois `rename` — nunca truncando o
   original;
4. lista de extensões/caminhos negados (ex.: `.ssh/`, `.env`) se a raiz for o home.
