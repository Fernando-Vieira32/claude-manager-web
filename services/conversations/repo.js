// Regras de negócio das conversas gravadas em ~/.claude/projects/*/*.jsonl

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../core/config.js';
import { fold, resolveConversationId } from '../../core/claude-paths.js';
import { messageText, isNoiseText } from '../../core/claude-blocks.js';
import { loadMessages, invalidate, runningAgents } from './messages.js';
import { contextWindowOf, readCatalogCache } from '../../core/claude-models.js';
import { localStamp } from './trash.js';
import { badRequest, notFound } from '../../core/http.js';

const cache = new Map();     // path -> { mtimeMs, summary }

const makeId = (projectDir, file) => `${projectDir}:${file.replace(/\.jsonl$/, '')}`;

// a validação/resolução do id é conhecimento do core (compartilhado com o chat)
const resolveId = resolveConversationId;

// Ler o texto de uma mensagem e saber o que é marcador do CLI é conhecimento do
// core: o chat precisa do MESMO julgamento ao seguir o arquivo ao vivo, e serviço
// não importa serviço. Aqui só ficam os apelidos curtos.
const textOf = messageText;
const isNoise = isNoiseText;

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

async function summarize(file, projectDir, stat, catalogo = []) {
  const entries = await parseFile(file);
  let cwd = '';
  let title = '';
  let primeiraFala = '';   // 1a fala do usuario, marcada como humana ou nao
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
    // Título = primeira fala do usuário. Preferimos a marcada como humana; se não
    // houver nenhuma, usamos a primeira fala mesmo assim. Mensagem enviada pelo
    // navegador vai pelo CLI headless, que NÃO grava `origin.kind` — sem esse
    // fallback, TODA conversa criada por este app aparecia como "(sem texto)".
    if (e.type === 'user') {
      const t = textOf(e.message?.content).replace(/\s+/g, ' ').trim();
      if (!isNoise(t)) {
        if (!primeiraFala) primeiraFala = t.slice(0, 160);
        if (!title && e.origin?.kind === 'human') title = t.slice(0, 160);
      }
    }
  }

  const label = cwd || path.basename(projectDir);
  const context = contextFromUsage(lastUsage, model, catalogo);
  return {
    id: makeId(projectDir, path.basename(file)),
    sessionId: path.basename(file, '.jsonl'),
    project: label,
    projectLabel: path.basename(label),
    projectDir,
    name: name || null,
    title: title || primeiraFala || '(sem texto)',
    messages,
    bytes: stat.size,
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
    startedAt: firstTs,
    lastAt: lastTs,
    model,
    contextTokens: context.tokens,
    contextWindow: context.window,
    contextWindowSource: context.windowSource || null,
    contextNote: context.note || null,
  };
}

/**
 * Tokens em contexto no último turno = entrada + o que foi lido/criado em cache.
 * A janela NÃO vem no transcript: vem do catálogo da API (`max_input_tokens`),
 * em cache no disco. Sem catálogo, cai num palpite pelo nome — que erra, e por
 * isso vem marcado em `windowSource`.
 */
function contextFromUsage(usage, model, catalogo) {
  if (!usage) return { tokens: null, window: null };
  const tokens = (usage.input_tokens || 0)
    + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0);
  // Logo após /compact a CLI grava um turno "<synthetic>" com usage todo zerado
  // (o resumo). Nesse caso o contexto real ainda não foi medido — só será no
  // próximo turno. Mostrar 0 engana; mostramos "desconhecido" com uma nota.
  if (!tokens) return { tokens: null, window: null, note: 'compactado — recalcula ao enviar' };

  // Janela DE VERDADE, do catálogo da API (`max_input_tokens`).
  const daApi = contextWindowOf(catalogo, model);
  if (daApi) return { tokens, window: daApi, windowSource: 'api' };

  // Sem catálogo (primeiro boot, offline, sem credencial) sobra o palpite antigo:
  // olhar o nome. Ele erra — `claude-opus-5` é 1M e não tem sufixo `[1m]` — então
  // o número vem marcado como palpite para a interface poder dizer isso.
  const big = /\[1m\]|-1m\b/i.test(model || '') || tokens > 200_000;
  return { tokens, window: big ? 1_000_000 : 200_000, windowSource: 'guess' };
}

export async function listConversations({ q = '' } = {}) {
  let projects = [];
  try {
    projects = await fs.readdir(config.projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // um catálogo por listagem: a janela é a mesma para todas as conversas
  const catalogo = await readCatalogCache();

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

      // o cache também depende do catálogo: se ele foi atualizado, a janela
      // gravada no resumo está velha e o resumo precisa ser refeito
      const hit = cache.get(file);
      if (hit && hit.mtimeMs === stat.mtimeMs && hit.catalogAt === catalogo.fetchedAt) {
        items.push(hit.summary);
        continue;
      }
      try {
        const summary = await summarize(file, dir.name, stat, catalogo.models);
        cache.set(file, { mtimeMs: stat.mtimeMs, catalogAt: catalogo.fetchedAt, summary });
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
  invalidate(file);   // o leitor de mensagens tem cache próprio
  return { id, name };
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
    meta: await summarize(file, projectDir, stat, (await readCatalogCache()).models),
    total,
    from: start,
    to: end,
    hasMore: start > 0,
    messages: messages.slice(start, end),
    // quem está de pé é da CONVERSA, não da página: a janela mostra isso no rodapé
    agents: runningAgents(messages),
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
  invalidate(file);   // o leitor de mensagens tem cache próprio
  return { id, trashedAs: path.basename(dest), trashDir: config.trashDir };
}

