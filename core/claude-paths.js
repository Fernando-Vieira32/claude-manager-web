// Conhecimento compartilhado sobre o layout de ~/.claude (o único ponto de acoplamento
// entre os serviços: ambos falam do mesmo disco, mas nenhum importa o outro).

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { badRequest } from './http.js';

/** id de conversa: '<pastaDoProjeto>:<sessionId>' */
const CONVERSATION_ID_RE = /^[A-Za-z0-9._-]+:[A-Za-z0-9-]{8,}$/;

/** Resolve o id no arquivo .jsonl, garantindo que não escapa de projects/. */
export function resolveConversationId(id) {
  if (!CONVERSATION_ID_RE.test(id || '')) throw badRequest('id de conversa inválido');
  const [projectDir, sessionId] = id.split(':');
  const file = path.resolve(config.projectsDir, projectDir, `${sessionId}.jsonl`);
  if (!file.startsWith(config.projectsDir + path.sep)) throw badRequest('caminho fora de projects/');
  return { projectDir, sessionId, file };
}

/** Diretório em que a conversa aconteceu (o `cwd` gravado no transcript). */
export async function cwdOfConversation(file) {
  let raw = '';
  try {
    const handle = await fs.open(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    await handle.close();
    raw = buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim() || !line.includes('"cwd"')) continue;
    try {
      const cwd = JSON.parse(line).cwd;
      if (cwd) return cwd;
    } catch { /* linha cortada pelo buffer */ }
  }
  return null;
}

export const encodeProject = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

export const projectDirFor = (cwd) => path.join(config.projectsDir, encodeProject(cwd));

/** .jsonl mais recente do projeto — palpite de "conversa em uso" por uma sessão. */
export async function newestSessionFile(cwd) {
  const dir = projectDirFor(cwd);
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return null;
  }
  const stats = [];
  for (const name of files.filter((f) => f.endsWith('.jsonl'))) {
    try {
      const st = await fs.stat(path.join(dir, name));
      stats.push({ name, mtimeMs: st.mtimeMs });
    } catch { /* arquivo sumiu no meio do caminho */ }
  }
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats.length ? stats[0].name.replace(/\.jsonl$/, '') : null;
}

/** minúsculas sem acento, para filtros que casem "sessoes" com "sessões". */
export const fold = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
