// Os argumentos que vão para o CLI: modos de permissão e as duas formas de invocar
// (processo vivo multi-turno e execução única).
//
// Separado do repo.js porque é regra pura — dado entra, lista de strings sai — e é
// o que mais precisa ficar legível: cada flag aqui muda o que o Claude pode fazer.

import { badRequest } from '../../core/http.js';

const WRITE_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task'];
const NET_TOOLS = ['WebFetch', 'WebSearch'];
const READ_TOOLS = ['Read', 'Glob', 'Grep'];

// Sem teto de gasto por padrão — igual ao terminal. Numa assinatura (plano) você
// não paga por token, então limitar dólares só atrapalha. Quem usa API pode pôr
// um teto opcional com CHAT_MAX_USD (aí a flag --max-budget-usd é passada).
const MAX_USD = process.env.CHAT_MAX_USD || '';

/** Modos que editam/executam exigem opt-in explícito no servidor (sem prompt no navegador). */
function requireFullTools() {
  if (process.env.CHAT_ALLOW_FULL_TOOLS !== '1') {
    throw badRequest(
      'este modo edita/executa e está desligado; suba o servidor com CHAT_ALLOW_FULL_TOOLS=1 para habilitar',
    );
  }
}

/**
 * Modos de permissão oferecidos ao navegador — espelham os do terminal
 * (`claude --permission-mode`). Em headless não existe "perguntar antes": o modo
 * já libera ou não.
 *  none         — só conversa; não lê, não edita, não roda nada.
 *  plan         — modo plano: lê o projeto e propõe um plano, sem alterar nada.
 *  auto         — o Claude decide o que é seguro e edita/roda direto (gated).
 *  acceptEdits  — aplica edições e roda comandos sem perguntar (gated).
 * "gated" = só funciona com CHAT_ALLOW_FULL_TOOLS=1 no ambiente do servidor.
 */
export const MODE_POLICIES = {
  none: () => ['--disallowedTools', ...WRITE_TOOLS, ...NET_TOOLS, ...READ_TOOLS],
  plan: () => ['--permission-mode', 'plan'],
  auto: () => { requireFullTools(); return ['--permission-mode', 'auto']; },
  acceptEdits: () => { requireFullTools(); return ['--permission-mode', 'acceptEdits']; },
};

export function modeArgs(mode) {
  const policy = MODE_POLICIES[mode];
  if (!policy) throw badRequest(`modo de permissão inválido: ${mode}`);
  return policy();
}

const STREAM_OUT = ['--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

/** `--session-id` para nascer, `--resume` para continuar. */
const sessionFlag = (isNew) => (isNew ? '--session-id' : '--resume');

function withModel(args, model) {
  if (model) args.push('--model', model);
  if (MAX_USD) args.push('--max-budget-usd', MAX_USD); // só se você definir um teto
  return args;
}

/**
 * Processo VIVO multi-turno: sem `-p "<texto>"`, o prompt de cada turno entra pelo
 * stdin como uma linha JSON (`--input-format stream-json`). O `-p` continua
 * obrigatório — é ele que liga o modo headless; ele NÃO impede o multi-turno.
 * O processo fica de pé esperando mais linhas e só sai quando o stdin fecha.
 */
export function runnerArgs({ sessionId, isNew = false, extraArgs = [], model }) {
  return withModel([
    '-p',
    '--input-format', 'stream-json',
    sessionFlag(isNew), sessionId,
    ...STREAM_OUT,
    ...extraArgs,
  ], model);
}

/**
 * Execução ÚNICA (hoje só o `/compact`): o texto vai como `-p "<texto>"` e o
 * processo morre no fim. Não pode virar runner porque dois processos escrevendo o
 * mesmo transcript se atropelariam.
 */
export function oneshotArgs({ prompt, sessionId, isNew = false, extraArgs = [], model }) {
  return withModel([
    '-p', prompt,
    sessionFlag(isNew), sessionId,
    ...STREAM_OUT,
    ...extraArgs,
  ], model);
}
