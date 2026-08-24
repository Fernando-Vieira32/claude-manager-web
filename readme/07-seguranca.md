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
- Esvaziar de vez é decisão manual: `rm -rf ~/.claude/.trash-conversas`.
- A interface avisa antes (modal) e oferece **Desfazer** por 8 segundos depois.

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
