// O processo filho `claude` e a leitura do stdout LINHA A LINHA.
//
// Mora fora do runner.js porque é encanamento, não política: o runner decide de quem é
// cada linha, este arquivo só garante que ela chegue inteira (o stdout vem em pedaços
// que não respeitam a fronteira do JSON) e que o resto do buffer não se perca quando o
// processo encerra.

import { spawn as nodeSpawn } from 'node:child_process';
import { CLAUDE_BIN, childEnv } from './bin.js';

/** A falha de spawn em linguagem de gente — quase sempre é o binário fora do PATH. */
function explainSpawn(err) {
  return err.code === 'ENOENT'
    ? `não encontrei o binário "claude" (${CLAUDE_BIN}). Instale o Claude Code ou `
      + 'aponte a variável CLAUDE_BIN para o executável ao subir o servidor.'
    : `falha ao executar o claude: ${err.message}`;
}

/**
 * Sobe o CLI e entrega os callbacks já normalizados.
 * @param {object} p
 * @param {(line: string) => void} p.onLine uma linha completa do stdout
 * @param {(text: string) => void} p.onStderr stderr já aparado
 * @param {(message: string) => void} p.onSpawnError não deu para executar o binário
 * @param {(code: number|null, signal: string|null) => void} p.onClose o processo saiu
 * @returns o `child` — quem escreve no stdin é o runner.
 */
export function startChild({ args, cwd, spawn = nodeSpawn, onLine, onStderr, onSpawnError, onClose }) {
  let buffer = '';
  const child = spawn(CLAUDE_BIN, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() });

  child.stdout.setEncoding?.('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) onLine(line);
  });
  child.stderr.setEncoding?.('utf8');
  child.stderr.on('data', (chunk) => onStderr(String(chunk).trim()));
  child.on('error', (err) => onSpawnError(explainSpawn(err)));
  child.on('close', (code, signal) => {
    const rest = buffer;
    buffer = '';
    if (rest.trim()) onLine(rest);
    onClose(code, signal);
  });
  // Rede de segurança: o processo pode morrer ENTRE o nosso `write` e o `close`, e erro
  // emitido num stream sem ouvinte é fatal para o servidor todo.
  child.stdin.on?.('error', () => {});
  return child;
}
