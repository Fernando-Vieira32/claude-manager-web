// Execução ÚNICA do CLI: dispara, transmite o stream e morre no fim.
//
// Sobrou para o `/compact`, que NÃO pode virar turno do processo vivo: a
// compactação reescreve o contexto do transcript, e dois processos escrevendo o
// mesmo `.jsonl` se atropelariam. Para conversar, use o `runner.js`.

import { spawn as nodeSpawn } from 'node:child_process';
import { CLAUDE_BIN, childEnv } from './bin.js';
import { forward } from './stream.js';

const TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 15 * 60 * 1000);

/**
 * @returns {{ child, done: Promise<void> }} `child` para quem quiser parar (SIGTERM);
 * `done` resolve quando o processo sai e o SSE já foi fechado.
 */
export function runOnce({
  conversationId, sessionId, cwd, mode, kind = 'compact', args,
  spawn = nodeSpawn, timeoutMs = TIMEOUT_MS,
}, sse) {
  const child = spawn(CLAUDE_BIN, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });

  sse.send({ type: 'init', conversationId, sessionId, cwd, mode, kind, images: 0, pid: child.pid });

  const timer = setTimeout(() => {
    sse.send({ type: 'error', message: 'tempo limite excedido; execução encerrada' });
    child.kill('SIGTERM');
  }, timeoutMs);

  let buffer = '';
  child.stdout.setEncoding?.('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) forward(line, sse);
  });

  child.stderr.setEncoding?.('utf8');
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) sse.send({ type: 'notice', message: text.slice(0, 500) });
  });

  const done = new Promise((resolve) => {
    child.on('error', (err) => {
      const message = err.code === 'ENOENT'
        ? `não encontrei o binário "claude" (${CLAUDE_BIN}). Instale o Claude Code ou `
          + 'aponte a variável CLAUDE_BIN para o executável ao subir o servidor.'
        : `falha ao executar o claude: ${err.message}`;
      sse.send({ type: 'error', message });
    });
    child.on('close', (code, signal) => {
      if (buffer.trim()) forward(buffer, sse);
      clearTimeout(timer);
      sse.send({ type: 'done', code, signal: signal || null });
      sse.close();
      resolve();
    });
  });

  return { child, done };
}
