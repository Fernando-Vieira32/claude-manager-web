// Regras de negócio das conversas gravadas em ~/.claude/projects/*/*.jsonl

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../core/config.js';
import { fold, resolveConversationId } from '../../core/claude-paths.js';
import { badRequest, notFound } from '../../core/http.js';

const cache = new Map();     // path -> { mtimeMs, summary }
const msgCache = new Map();  // path -> { mtimeMs, messages }  (paginação do leitor)
const MSG_CACHE_MAX = 8;

const makeId = (projectDir, file) => `${projectDir}:${file.replace(/\.jsonl$/, '')}`;

// a validação/resolução do id é conhecimento do core (compartilhado com o chat)
const resolveId = resolveConversationId;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block?.type === 'text') return block.text || '';
      if (block?.type === 'image') return '🖼 imagem';
      if (block?.type === 'tool_use') return `⚙ ${block.name || 'tool'}`;
      if (block?.type === 'tool_result') return '';
      if (block?.type === 'thinking') return '';
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

const isNoise = (t) => !t || t.startsWith('<') || t.startsWith('Caveat:');

async function parseFile(file) {
  const raw = await fs.readFile(file, 'utf8');
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch { /* linha truncada: ignora */ }
  }
  return entries;
}

async function summarize(file, projectDir, stat) {
  const entries = await parseFile(file);
  let cwd = '';
  let title = '';
  let name = '';
  let messages = 0;
  let firstTs = null;
  let lastTs = null;
  let model = '';
  let lastUsage = null;

  for (const e of entries) {
    if (!cwd && e.cwd) cwd = e.cwd;
    if (!model && e.message?.model) model = e.message.model;
    // nome de exibição do /rename: o último custom-title vence
    if (e.type === 'custom-title' && e.customTitle) name = e.customTitle;
    if (e.type === 'user' || e.type === 'assistant') {
      messages += 1;
      if (e.timestamp) {
        firstTs ||= e.timestamp;
        lastTs = e.timestamp;
      }
    }
    // o tamanho do contexto é o que o último turno do assistant carregou
    if (e.type === 'assistant' && e.message?.usage) lastUsage = e.message.usage;
    if (!title && e.type === 'user' && e.origin?.kind === 'human') {
      const t = textOf(e.message?.content).replace(/\s+/g, ' ').trim();
      if (!isNoise(t)) title = t.slice(0, 160);
    }
  }

  const label = cwd || path.basename(projectDir);
  const context = contextFromUsage(lastUsage, model);
  return {
    id: makeId(projectDir, path.basename(file)),
    sessionId: path.basename(file, '.jsonl'),
    project: label,
    projectLabel: path.basename(label),
    projectDir,
    name: name || null,
    title: title || '(sem texto)',
    messages,
    bytes: stat.size,
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
    startedAt: firstTs,
    lastAt: lastTs,
    model,
    contextTokens: context.tokens,
    contextWindow: context.window,
    contextNote: context.note || null,
  };
}

/**
 * Tokens em contexto no último turno = entrada + o que foi lido/criado em cache.
 * A janela do modelo não vem no transcript; inferimos de forma conservadora
 * (200k, ou 1M quando o uso já passou de 200k — sessões de contexto estendido).
 */
function contextFromUsage(usage, model) {
  if (!usage) return { tokens: null, window: null };
  const tokens = (usage.input_tokens || 0)
    + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0);
  // Logo após /compact a CLI grava um turno "<synthetic>" com usage todo zerado
  // (o resumo). Nesse caso o contexto real ainda não foi medido — só será no
  // próximo turno. Mostrar 0 engana; mostramos "desconhecido" com uma nota.
  if (!tokens) return { tokens: null, window: null, note: 'compactado — recalcula ao enviar' };
  const big = /\[1m\]|-1m\b/i.test(model || '') || tokens > 200_000;
  return { tokens, window: big ? 1_000_000 : 200_000 };
}

export async function listConversations({ q = '' } = {}) {
  let projects = [];
  try {
    projects = await fs.readdir(config.projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items = [];
  for (const dir of projects.filter((d) => d.isDirectory())) {
    const dirPath = path.join(config.projectsDir, dir.name);
    let files = [];
    try {
      files = await fs.readdir(dirPath);
    } catch { continue; }

    for (const name of files.filter((f) => f.endsWith('.jsonl'))) {
      const file = path.join(dirPath, name);
      let stat;
      try {
        stat = await fs.stat(file);
      } catch { continue; }

      const hit = cache.get(file);
      if (hit && hit.mtimeMs === stat.mtimeMs) {
        items.push(hit.summary);
        continue;
      }
      try {
        const summary = await summarize(file, dir.name, stat);
        cache.set(file, { mtimeMs: stat.mtimeMs, summary });
        items.push(summary);
      } catch { /* arquivo ilegível: pula */ }
    }
  }

  items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  if (!q) return items;

  const needle = fold(q);
  return items.filter((c) =>
    fold([c.name, c.title, c.project, c.sessionId, c.model, c.modifiedAt].join(' ')).includes(needle));
}

/**
 * Renomeia a conversa — o mesmo que o /rename do terminal. O CLI grava o nome de
 * exibição como uma entrada `custom-title` no próprio transcript (o último vence);
 * então acrescentamos exatamente essas linhas. O nome passa a aparecer aqui e no
 * seletor /resume do terminal.
 */
export async function renameConversation(id, rawName) {
  const { file, sessionId } = resolveId(id);
  const name = String(rawName || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!name) throw badRequest('nome vazio');
  if (name.length > 120) throw badRequest('nome muito longo (máx. 120 caracteres)');

  try {
    await fs.access(file);
  } catch {
    throw notFound('conversa não encontrada');
  }

  const lines =
    `${JSON.stringify({ type: 'custom-title', customTitle: name, sessionId })}\n` +
    `${JSON.stringify({ type: 'agent-name', agentName: name, sessionId })}\n`;
  await fs.appendFile(file, lines, 'utf8');

  cache.delete(file);   // força reler o resumo (o nome mudou)
  msgCache.delete(file);
  return { id, name };
}

/** Lê as mensagens legíveis do arquivo, com cache por mtime. */
async function loadMessages(file) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) throw notFound('conversa não encontrada');

  const hit = msgCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return { stat, messages: hit.messages };

  const entries = await parseFile(file);
  const messages = [];
  for (const e of entries) {
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    const text = textOf(e.message?.content).replace(/\n{3,}/g, '\n\n').trim();
    if (isNoise(text)) continue;
    messages.push({
      index: messages.length,
      role: e.type,
      text: text.slice(0, 4000),
      at: e.timestamp || null,
      human: e.origin?.kind === 'human',
    });
  }

  if (msgCache.size >= MSG_CACHE_MAX) msgCache.delete(msgCache.keys().next().value);
  msgCache.set(file, { mtimeMs: stat.mtimeMs, messages });
  return { stat, messages };
}

/**
 * Janela de mensagens contada do fim para o começo (leitura tipo feed).
 *  - sem `before`: as últimas `limit` mensagens;
 *  - com `before`: as `limit` mensagens imediatamente anteriores a esse índice.
 * Devolve `from`/`to` (intervalo [from, to)) e `hasMore` para o front pedir a próxima página.
 */
export async function getConversation(id, { limit = 20, before } = {}) {
  const { file, projectDir } = resolveId(id);
  const { stat, messages } = await loadMessages(file);

  const total = messages.length;
  const size = Math.min(Math.max(Number(limit) || 20, 1), 500);
  const end = Number.isInteger(before) && before >= 0 && before <= total ? before : total;
  const start = Math.max(0, end - size);

  return {
    meta: await summarize(file, projectDir, stat),
    total,
    from: start,
    to: end,
    hasMore: start > 0,
    messages: messages.slice(start, end),
  };
}

export async function deleteConversation(id) {
  const { file, sessionId, projectDir } = resolveId(id);
  try {
    await fs.access(file);
  } catch {
    throw notFound('conversa não encontrada');
  }

  await fs.mkdir(config.trashDir, { recursive: true });
  const stamp = localStamp();
  const dest = path.join(config.trashDir, `${stamp}_${projectDir}_${sessionId}.jsonl`);
  await fs.rename(file, dest);
  cache.delete(file);
  msgCache.delete(file);
  return { id, trashedAs: path.basename(dest), trashDir: config.trashDir };
}

/** YYYYMMDD-HHMMSS em hora local — mesmo formato usado pelo claude-manager.sh */
function localStamp(d = new Date()) {
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
