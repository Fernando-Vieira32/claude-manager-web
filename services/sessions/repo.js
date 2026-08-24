// Regras de negócio de "sessões abertas": leitura de processos e encerramento.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { newestSessionFile, fold } from '../../core/claude-paths.js';
import { badRequest, notFound, conflict } from '../../core/http.js';

const exec = promisify(execFile);

const isClaudeProcess = (args) => {
  if (args.includes('shell-snapshots')) return false;   // wrappers criados pelas sessões
  if (/\bclaude-manager-web\b|server\.js/.test(args)) return false;
  return /(^|\/)claude(\s|$)/.test(args) || /claude.*(cli|index)\.js/.test(args);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `-p`/`--print` é execução sem terminal — é o que ESTE painel dispara a cada
 * mensagem do chat. Chamar isso de "sessão aberta num terminal" seria mentira: o
 * processo é nosso, não de alguém digitando noutra janela.
 */
export const isHeadless = (args) => /(^|\s)(-p|--print)(\s|$)/.test(args);

/**
 * Id que o **próprio comando declara** (`--resume`, `-r`, `--session-id`). Quando
 * existe, não é palpite: é o que aquele processo abriu. `--resume` sem valor (o
 * seletor interativo) e `--continue` não declaram nada, e aí voltamos ao palpite.
 */
export function declaredSessionId(args) {
  const m = args.match(/(?:^|\s)(?:--resume|--session-id|-r)(?:=|\s+)(\S+)/);
  return UUID.test(m?.[1] || '') ? m[1] : null;
}

export async function listSessions({ q = '' } = {}) {
  const { stdout } = await exec('ps', ['-eo', 'pid=,ppid=,tty=,etime=,etimes=,args=']);
  const sessions = [];

  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, tty, etime, etimes, args] = m;
    if (!isClaudeProcess(args)) continue;

    let cwd = null;
    try {
      cwd = await fs.readlink(`/proc/${pid}/cwd`);
    } catch { /* processo pode ter morrido ou não ser nosso */ }

    // certeza vem do comando; palpite (o .jsonl mais novo da pasta) é o resto —
    // e quem consome PRECISA saber qual dos dois recebeu, senão trata palpite
    // como fato (foi o que fez a interface jurar que uma conversa recém-criada
    // pelo navegador estava aberta num terminal)
    const declared = declaredSessionId(args);
    const guess = declared || !cwd ? null : await newestSessionFile(cwd);

    sessions.push({
      pid: Number(pid),
      ppid: Number(ppid),
      tty: tty === '?' ? null : tty,
      uptime: etime,
      uptimeSeconds: Number(etimes),
      cwd,
      command: args.trim().slice(0, 200),
      kind: isHeadless(args) ? 'headless' : 'interactive',
      conversationId: declared || guess,
      conversationSource: declared ? 'args' : (guess ? 'guess' : null),
    });
  }

  sessions.sort((a, b) => b.uptimeSeconds - a.uptimeSeconds);
  if (!q) return sessions;

  const needle = fold(q);
  return sessions.filter((s) =>
    fold([s.pid, s.tty, s.cwd, s.command, s.conversationId].join(' ')).includes(needle));
}

export async function killSession(pid, signal = 'SIGTERM') {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 1) throw badRequest('PID inválido');
  if (!['SIGTERM', 'SIGKILL', 'SIGINT'].includes(signal)) throw badRequest('sinal não permitido');

  // só encerra processos que este serviço reconhece como sessões do Claude
  const sessions = await listSessions();
  const found = sessions.find((s) => s.pid === target);
  if (!found) throw notFound(`PID ${target} não é uma sessão do Claude ativa`);

  try {
    process.kill(target, signal);
  } catch (err) {
    if (err.code === 'EPERM') throw conflict(`sem permissão para encerrar o PID ${target}`);
    throw err;
  }

  // dá um tempinho e confere se realmente saiu
  const alive = await waitForExit(target, signal === 'SIGKILL' ? 1500 : 4000);
  return { pid: target, signal, alive, session: found };
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
