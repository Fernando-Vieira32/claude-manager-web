// Continuar uma conversa do Claude Code pelo navegador.
//
// Usa o próprio CLI em modo headless:
//   claude -p "<texto>" --resume <sessionId> --output-format stream-json --verbose
// Com --resume o session_id é preservado e as mensagens são gravadas no MESMO
// .jsonl — então o leitor do painel (e o terminal, se você reabrir por lá) vê a
// continuação. Nada de banco de dados nem de histórico paralelo.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveConversationId, cwdOfConversation, encodeProject } from '../../core/claude-paths.js';
import { toolFromUse, toolResultFrom } from '../../core/claude-blocks.js';
import { badRequest, notFound, conflict } from '../../core/http.js';

const WRITE_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task'];
const NET_TOOLS = ['WebFetch', 'WebSearch'];
const READ_TOOLS = ['Read', 'Glob', 'Grep'];

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
const MODE_POLICIES = {
  none: () => ['--disallowedTools', ...WRITE_TOOLS, ...NET_TOOLS, ...READ_TOOLS],
  plan: () => ['--permission-mode', 'plan'],
  auto: () => { requireFullTools(); return ['--permission-mode', 'auto']; },
  acceptEdits: () => { requireFullTools(); return ['--permission-mode', 'acceptEdits']; },
};

/**
 * Caminho do binário `claude`, resolvido uma vez no boot para não depender do PATH
 * de quem subiu o servidor. Se ele for iniciado por um atalho/serviço com PATH
 * mínimo (sem `~/.npm-global/bin`), um `spawn('claude')` cru daria `ENOENT` e todo
 * o chat/compact quebraria. Ordem: `CLAUDE_BIN` explícito → PATH → locais de
 * instalação conhecidos → o nome cru (deixa o SO falhar com erro claro).
 */
function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const home = os.homedir();
  const candidates = [
    ...(process.env.PATH || '').split(path.delimiter).map((d) => d && path.join(d, 'claude')),
    path.join(home, '.npm-global/bin/claude'),
    path.join(home, '.local/bin/claude'),
    path.join(home, '.claude/local/claude'),
    '/usr/local/bin/claude',
  ];
  return candidates.find((c) => c && existsSync(c)) || 'claude';
}

const CLAUDE_BIN = resolveClaudeBin();

const MAX_TEXT = 100_000;
const RUN_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 15 * 60 * 1000);
// Sem teto de gasto por padrão — igual ao terminal. Numa assinatura (plano) você
// não paga por token, então limitar dólares só atrapalha. Quem usa API pode pôr
// um teto opcional com CHAT_MAX_USD (aí a flag --max-budget-usd é passada).
const MAX_USD = process.env.CHAT_MAX_USD || '';

const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGES = 6;
const MAX_IMG_BYTES = 8 * 1024 * 1024; // por imagem, já em base64 decodificado (~aprox)

/** Uma execução por conversa: id -> { child, startedAt } */
const running = new Map();

export function isRunning(id) {
  return running.has(id);
}

export function listRunning() {
  return [...running.entries()].map(([id, run]) => ({
    id,
    pid: run.child.pid,
    startedAt: new Date(run.startedAt).toISOString(),
  }));
}

export function stopRun(id) {
  const run = running.get(id);
  if (!run) throw notFound('não há execução em andamento para esta conversa');
  run.child.kill('SIGTERM');
  return { id, stopped: true, pid: run.child.pid };
}

/**
 * Envia uma mensagem e transmite a resposta via SSE.
 * Eventos: init, system, delta, message, tool, notice, result, error, done.
 */
export async function sendMessage({ id, text, mode = 'none', model, images }, sse, req) {
  const imgs = validImages(images);
  const message = validMessage(text, imgs.length);
  const extraArgs = modeArgs(mode);
  const { sessionId, cwd } = await resolveExisting(id);
  return runClaude({ conversationId: id, sessionId, cwd, prompt: message, extraArgs, model, mode, images: imgs }, sse, req);
}

/**
 * Compacta a conversa — equivale ao /compact do terminal: resume o histórico e
 * grava um marcador no mesmo transcript, reduzindo o contexto. Sem ferramentas.
 */
export async function compactConversation({ id, model }, sse, req) {
  const { sessionId, cwd } = await resolveExisting(id);
  return runClaude(
    { conversationId: id, sessionId, cwd, prompt: '/compact', extraArgs: MODE_POLICIES.none(), model, mode: 'none', kind: 'compact' },
    sse,
    req,
  );
}

/**
 * Inicia uma conversa NOVA numa pasta escolhida. Geramos o session-id (uuid) e o
 * passamos ao CLI com --session-id, então já sabemos o id da conversa antes mesmo
 * de o Claude responder — sem --resume, um .jsonl novo nasce em ~/.claude/projects.
 */
export async function startConversation({ cwd, text, mode = 'none', model, images }, sse, req) {
  const imgs = validImages(images);
  const message = validMessage(text, imgs.length);
  const extraArgs = modeArgs(mode);

  const dir = String(cwd || '').trim();
  if (!path.isAbsolute(dir)) throw badRequest('a pasta precisa ser um caminho absoluto');
  let stat;
  try { stat = await fs.stat(dir); } catch { throw badRequest(`a pasta não existe: ${dir}`); }
  if (!stat.isDirectory()) throw badRequest(`não é uma pasta: ${dir}`);

  const sessionId = randomUUID();
  const conversationId = `${encodeProject(dir)}:${sessionId}`;
  return runClaude(
    { conversationId, sessionId, cwd: dir, prompt: message, extraArgs, model, mode, images: imgs, kind: 'new', isNew: true },
    sse,
    req,
  );
}

/* -------------------------------------------------------------- validações */

function validMessage(text, imageCount = 0) {
  const message = String(text || '').trim();
  if (!message && !imageCount) throw badRequest('mensagem vazia');
  if (message.length > MAX_TEXT) throw badRequest('mensagem muito longa');
  return message;
}

/** Valida e normaliza as imagens: [{ media_type, data(base64) }]. */
function validImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw badRequest('imagens em formato inválido');
  if (images.length > MAX_IMAGES) throw badRequest(`no máximo ${MAX_IMAGES} imagens por mensagem`);
  return images.map((img, i) => {
    const type = String(img?.media_type || '');
    const data = String(img?.data || '');
    if (!IMG_TYPES.includes(type)) throw badRequest(`imagem ${i + 1}: tipo não suportado (${type || 'vazio'})`);
    if (!data) throw badRequest(`imagem ${i + 1}: sem dados`);
    if (data.length * 0.75 > MAX_IMG_BYTES) throw badRequest(`imagem ${i + 1}: muito grande`);
    return { media_type: type, data };
  });
}

function modeArgs(mode) {
  const policy = MODE_POLICIES[mode];
  if (!policy) throw badRequest(`modo de permissão inválido: ${mode}`);
  return policy();
}

/** Resolve uma conversa existente no par (sessionId, cwd). */
async function resolveExisting(id) {
  const { sessionId, file } = resolveConversationId(id);
  const cwd = await cwdOfConversation(file);
  if (!cwd) throw notFound('conversa não encontrada (ou sem cwd no transcript)');
  return { sessionId, cwd };
}

/**
 * Núcleo compartilhado: dispara o CLI headless e transmite o stream em SSE.
 * `isNew` decide entre `--session-id` (nascer) e `--resume` (continuar) — o resto
 * do caminho (spawn, timeout, órfãos, tradução do stream) é idêntico.
 */
async function runClaude({ conversationId, sessionId, cwd, prompt, extraArgs, model, mode, images = [], kind = 'message', isNew = false }, sse, req) {
  if (running.has(conversationId)) throw conflict('já existe uma execução em andamento nesta conversa');

  const hasImages = images.length > 0;

  // Sem imagem: prompt vai como -p "texto" (simples, comprovado). Com imagem: o
  // texto não cabe num argumento junto do binário base64, então mandamos a
  // mensagem inteira (texto + blocos de imagem) pelo stdin em stream-json.
  const args = [
    '-p',
    ...(hasImages ? ['--input-format', 'stream-json'] : [prompt]),
    isNew ? '--session-id' : '--resume', sessionId,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...extraArgs,
  ];
  if (model) args.push('--model', model);
  if (MAX_USD) args.push('--max-budget-usd', MAX_USD); // só se você definir um teto

  // Garante que o diretório do binário esteja no PATH do filho (o CLI e o que ele
  // mesmo dispara também procuram no PATH).
  const binDir = path.isAbsolute(CLAUDE_BIN) ? path.dirname(CLAUDE_BIN) : null;
  const env = binDir
    ? { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` }
    : process.env;

  const child = spawn(CLAUDE_BIN, args, {
    cwd,
    stdio: [hasImages ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    env,
  });

  if (hasImages) {
    const content = [];
    if (prompt) content.push({ type: 'text', text: prompt });
    for (const img of images) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
    }
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
    child.stdin.end();
  }

  running.set(conversationId, { child, startedAt: Date.now() });

  sse.send({ type: 'init', conversationId, sessionId, cwd, mode, kind, images: images.length, pid: child.pid });

  const timer = setTimeout(() => {
    sse.send({ type: 'error', message: 'tempo limite excedido; execução encerrada' });
    child.kill('SIGTERM');
  }, RUN_TIMEOUT_MS);

  // se o navegador fechar a aba, não deixe processo órfão rodando
  const onClientGone = () => child.kill('SIGTERM');
  req.on('close', onClientGone);

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) forward(line, sse);
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const t = String(chunk).trim();
    if (t) sse.send({ type: 'notice', message: t.slice(0, 500) });
  });

  return new Promise((resolve) => {
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
      req.off('close', onClientGone);
      running.delete(conversationId);
      sse.send({ type: 'done', code, signal: signal || null });
      sse.close();
      resolve();
    });
  });
}

/** Traduz o subtype de erro do `result` numa mensagem clara para o usuário. */
function explainResult(subtype) {
  switch (subtype) {
    case 'error_max_budget_usd':
      return `atingiu o teto de gasto por mensagem ($${MAX_USD}) que você definiu em `
        + 'CHAT_MAX_USD. Aumente o valor ou remova a variável para não ter teto.';
    case 'error_max_turns':
      return 'atingiu o limite de turnos para esta resposta.';
    case 'error_during_execution':
      return 'erro durante a execução do Claude (veja o log do servidor).';
    default:
      return subtype ? `falhou (${subtype})` : 'falhou';
  }
}

/** Traduz uma linha do stream-json do CLI em um evento simples para o front. */
/**
 * Traduz uma linha do stream-json do CLI num evento do contrato do chat
 * (ver readme/10-chat.md). Exportado para teste: é a peça com mais regra por
 * linha de todo o serviço.
 */
export function forward(line, sse) {
  const raw = line.trim();
  if (!raw) return;
  if (!raw.startsWith('{')) {
    sse.send({ type: 'notice', message: raw.slice(0, 500) });
    return;
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }

  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') {
        sse.send({ type: 'system', model: event.model, sessionId: event.session_id });
      } else if (event.subtype === 'status') {
        if (event.compact_error) {
          sse.send({ type: 'compact', ok: false, message: String(event.compact_error).slice(0, 300) });
        } else if (event.compact_result !== undefined) {
          sse.send({ type: 'compact', ok: true, message: 'contexto compactado' });
        }
      }
      return;

    case 'stream_event': {
      const inner = event.event;
      if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
        sse.send({ type: 'delta', text: inner.delta.text });
      }
      return;
    }

    case 'assistant': {
      for (const block of event.message?.content || []) {
        if (block?.type === 'text' && block.text) {
          sse.send({ type: 'message', text: block.text });
        } else if (block?.type === 'tool_use') {
          // o `id` correlaciona com o toolResult que vem depois
          sse.send({ type: 'tool', ...toolFromUse(block) });
        }
      }
      return;
    }

    // O que a ferramenta DEVOLVEU. Vem num evento 'user' (é o CLI devolvendo o
    // resultado ao modelo). Antes isto caía no default e era descartado, então o
    // navegador nunca via resposta de ferramenta nenhuma.
    case 'user': {
      for (const block of event.message?.content || []) {
        if (block?.type !== 'tool_result') continue;
        sse.send({ type: 'toolResult', ...toolResultFrom(block) });
      }
      return;
    }

    case 'result':
      sse.send({
        type: 'result',
        ok: !event.is_error,
        subtype: event.subtype,
        message: event.is_error ? explainResult(event.subtype) : undefined,
        text: event.result || '',
        costUsd: event.total_cost_usd ?? null,
        turns: event.num_turns ?? null,
        durationMs: event.duration_api_ms ?? null,
      });
      return;

    case 'rate_limit_event':
      if (event.rate_limit_info?.status && event.rate_limit_info.status !== 'allowed') {
        sse.send({ type: 'notice', message: `limite de uso: ${event.rate_limit_info.status}` });
      }
      return;

    default:
  }
}
