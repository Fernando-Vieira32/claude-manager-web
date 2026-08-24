// A lixeira: tudo que opera na PASTA de descartadas (~/.claude/.trash-conversas) —
// listar, restaurar e o expurgo por idade.
//
// Separado do repo.js porque são responsabilidades diferentes: lá é ler/listar/
// renomear conversa viva, aqui é o ciclo de vida do que já foi descartado. O
// `deleteConversation` fica no repo.js (ele mexe nos caches da conversa) e importa
// daqui só o formato do nome, que é o contrato entre os dois.

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../core/config.js';
import { badRequest, notFound } from '../../core/http.js';

/** YYYYMMDD-HHMMSS em hora local — mesmo formato usado pelo claude-manager.sh */
export function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const TRASH_NAME_RE = /^(\d{8})-?(\d{6})_(.+)_([A-Za-z0-9-]{8,})\.jsonl$/;

function parseTrashName(name) {
  const m = TRASH_NAME_RE.exec(name);
  if (!m) return null;
  const [, day, time, projectDir, sessionId] = m;
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T` +
    `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
  const at = new Date(iso);
  return { projectDir, sessionId, deletedAt: Number.isNaN(+at) ? null : at.toISOString() };
}

export async function listTrash() {
  let files = [];
  try {
    files = await fs.readdir(config.trashDir);
  } catch {
    return [];
  }
  const items = [];
  for (const name of files.filter((f) => f.endsWith('.jsonl'))) {
    const st = await fs.stat(path.join(config.trashDir, name));
    const parsed = parseTrashName(name);
    items.push({
      name,
      bytes: st.size,
      deletedAt: parsed?.deletedAt || new Date(st.mtimeMs).toISOString(),
      projectDir: parsed?.projectDir || '?',
      sessionId: parsed?.sessionId || '?',
    });
  }
  items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return items;
}

export async function restoreFromTrash(name) {
  if (!/^[A-Za-z0-9._-]+\.jsonl$/.test(name)) throw badRequest('nome inválido');
  const src = path.join(config.trashDir, name);
  try {
    await fs.access(src);
  } catch {
    throw notFound('arquivo não está na lixeira');
  }
  const parsed = parseTrashName(name);
  if (!parsed) throw badRequest('nome não segue o padrão data_projeto_sessao.jsonl');
  const { projectDir, sessionId } = parsed;
  const destDir = path.join(config.projectsDir, projectDir);
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, `${sessionId}.jsonl`);
  await fs.rename(src, dest);
  return { restored: `${projectDir}:${sessionId}`, path: dest };
}

/* ------------------------------------------------------- expurgo da lixeira */

// Recuo em calendário de verdade: 1 mês é "o mesmo dia do mês anterior", não 30
// dias. Quem chama manda a unidade; este serviço não sabe onde ela foi guardada.
const UNIT_BACK = {
  days: (d, n) => d.setDate(d.getDate() - n),
  months: (d, n) => d.setMonth(d.getMonth() - n),
  years: (d, n) => d.setFullYear(d.getFullYear() - n),
};

export const RETENTION_UNITS = Object.keys(UNIT_BACK);
const MAX_VALUE = 999;

/** Instante a partir do qual o item é considerado antigo (mais velho = expurgável). */
function cutoffFrom(value, unit) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VALUE) {
    throw badRequest(`quantidade inválida: use um inteiro de 1 a ${MAX_VALUE}`);
  }
  const back = UNIT_BACK[unit];
  if (!back) throw badRequest(`unidade inválida: "${unit}" (use ${RETENTION_UNITS.join(', ')})`);
  const cutoff = new Date();
  back(cutoff, n);
  return cutoff;
}

/**
 * Apaga DE VERDADE (sem volta) os itens da lixeira deletados antes do corte.
 * Com `dryRun`, só diz o que iria embora — é assim que a interface confirma antes.
 * A idade sai do `deletedAt` do `listTrash()`, então lista e expurgo concordam.
 */
export async function purgeTrash({ value, unit, dryRun = false } = {}) {
  const cutoff = cutoffFrom(value, unit);
  const doomed = (await listTrash()).filter((t) => t.deletedAt < cutoff.toISOString());
  const bytes = doomed.reduce((sum, t) => sum + t.bytes, 0);

  if (!dryRun) {
    for (const t of doomed) await fs.rm(path.join(config.trashDir, t.name), { force: true });
  }

  return {
    dryRun,
    cutoff: cutoff.toISOString(),
    retention: { value: Number(value), unit },
    count: doomed.length,
    bytes,
    items: doomed.map((t) => ({ name: t.name, projectDir: t.projectDir, deletedAt: t.deletedAt, bytes: t.bytes })),
  };
}
