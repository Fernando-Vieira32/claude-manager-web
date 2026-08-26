// Uma conversa gravada -> mensagens em BLOCOS, na ordem em que aconteceram.
//
// Saiu do repo.js porque é a peça com mais regra por linha da leitura, e porque o desenho
// mudou: antes uma mensagem tinha `text` (toda a prosa junta) e `tools` (os chips no fim).
// Isso embrulhava tudo numa caixa só e perdia a ordem — a chamada que veio ANTES do
// parágrafo aparecia depois dele, e um agente de doze minutos ficava enterrado no pé de
// uma mensagem já terminada. No terminal cada coisa é um bloco na sequência; aqui também.
//
// Blocos: `{ kind: 'text' }` · `{ kind: 'tool' }` · `{ kind: 'agent' }`.
// Agente é bloco PRÓPRIO porque o trabalho dele não está no resultado da ferramenta: o
// `tool_result` é só o aceite do disparo, e o relatório chega muito depois num
// `<task-notification>` (ver `core/claude-agents.js`).

import fs from 'node:fs/promises';
import { notFound } from '../../core/http.js';
import { toolFromUse, toolResultFrom, messageText, isNoiseText } from '../../core/claude-blocks.js';
import {
  isAgentTool, agentFromUse, isLaunchAck, agentIdFromAck, parseTaskNotification,
} from '../../core/claude-agents.js';

const cache = new Map();   // path -> { mtimeMs, messages }
const CACHE_MAX = 8;
const MAX_TEXT = 4000;

/**
 * Os agentes que o arquivo diz estarem de pé AGORA — a conversa inteira, não a página.
 *
 * Existe porque "quem está rodando" não pode depender de até onde a pessoa rolou: ao
 * reabrir a janela, o disparo pode estar 200 mensagens atrás e a faixa do rodapé ficaria
 * vazia com quatro agentes trabalhando. No terminal esse painel está sempre lá.
 */
export const runningAgents = (messages) => messages
  .flatMap((m) => m.blocks || [])
  .filter((b) => b.kind === 'agent' && b.running)
  .map(({ id, name, agentType, startedAt }) => ({ id, name, agentType, startedAt }));

/** Esquece o que foi lido deste arquivo (ele mudou). */
export const invalidate = (file) => cache.delete(file);

/** Lê as mensagens legíveis do arquivo, com cache por mtime. */
export async function loadMessages(file) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) throw notFound('conversa não encontrada');

  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return { stat, messages: hit.messages };

  const messages = build(await parseFile(file));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(file, { mtimeMs: stat.mtimeMs, messages });
  return { stat, messages };
}

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

function build(entries) {
  const messages = [];
  const porId = new Map();   // id do tool_use -> o bloco (tool ou agent) já em messages
  const porAgente = new Map();  // id ESTÁVEL do agente -> o bloco dele (é assim que o
                                // aviso de fim o acha, mesmo depois de ele ser retomado)
  const abertos = [];        // agentes lançados e ainda sem aviso, em ordem de disparo

  for (const e of entries) {
    // Quantos agentes o CLI ainda tem de pé. É o que permite não deixar um relógio
    // mentindo: agente sem aviso de fim no arquivo ficaria "rodando…" para sempre.
    if (e.type === 'system' && e.subtype === 'turn_duration') {
      conciliar(abertos, e.pendingBackgroundAgentCount);
      continue;
    }
    if (e.type !== 'user' && e.type !== 'assistant') continue;

    // Fim de agente: entrada `user` que é só um aviso do CLI. Não é mensagem de
    // ninguém — é o relatório do agente, e vai para o bloco DELE, que está numa
    // mensagem anterior (o disparo pode ter sido dez minutos antes).
    const fim = parseTaskNotification(rawText(e.message?.content));
    if (fim) {
      const alvo = porAgente.get(fim.taskId) || porId.get(fim.id);
      if (alvo?.kind === 'agent') {
        Object.assign(alvo, endOf(fim, alvo.startedAt, e.timestamp));
        fechar(abertos, alvo);
      }
      continue;
    }

    const blocks = blocosDe(e, porId, porAgente);
    if (!blocks.length) continue;
    for (const b of blocks) if (b.kind === 'agent') abertos.push(b);
    messages.push({
      index: messages.length,
      role: e.type,
      at: e.timestamp || null,
      human: e.origin?.kind === 'human',
      blocks,
    });
  }
  return messages;
}

/** Saiu da lista de abertos: chegou o aviso dele. */
function fechar(abertos, bloco) {
  const i = abertos.indexOf(bloco);
  if (i !== -1) abertos.splice(i, 1);
}

/**
 * O CLI grava, a cada turno, **quantos** agentes ainda tem de pé
 * (`pendingBackgroundAgentCount`). Se há mais agentes sem aviso do que isso, os que
 * sobram terminaram sem o aviso ter ficado no arquivo — acontece de verdade: numa conversa
 * real, 8 agentes estavam sem aviso enquanto o CLI dizia ter 4 de pé (os avisos dos 4
 * antigos se perderam, provavelmente num `/compact`).
 *
 * Quem é fechado são os **mais antigos**, e essa é a única ordem defensável: o número é
 * autoridade sobre a QUANTIDADE, e um agente de uma sessão de ontem não sobrevive ao
 * processo que o hospedava. Marcar todos como "não sei" (o que eu fazia antes) apagava
 * justamente os que estão trabalhando agora; e deixar todos "rodando…" acenderia relógio
 * para quem morreu ontem — as duas mentiras que a regra 8 do CLAUDE.md proíbe.
 *
 * Roda **em ordem cronológica**, a cada contador do arquivo: é o que faz o aviso que chega
 * depois do contador ser tratado na hora certa, em vez de ser julgado com o que só se sabe
 * no fim do arquivo. Contador ausente (`null`) não decide nada.
 */
function conciliar(abertos, pendentes) {
  if (typeof pendentes !== 'number') return;
  while (abertos.length > pendentes) {
    const bloco = abertos.shift();
    Object.assign(bloco, { running: false, status: 'unknown', summary: 'sem aviso de fim' });
  }
}

/** Os blocos de UMA entrada, na ordem do `content`. */
function blocosDe(entry, porId, porAgente) {
  const content = entry.message?.content;
  const blocks = [];

  for (const b of Array.isArray(content) ? content : [{ type: 'text', text: content }]) {
    if (b?.type === 'tool_result') {
      resolver(porId.get(toolResultFrom(b).id), b, porAgente);
      continue;
    }
    if (b?.type === 'tool_use') {
      const bloco = isAgentTool(b.name)
        ? {
          kind: 'agent',
          ...agentFromUse(b),
          running: true,
          startedAt: entry.timestamp || null,   // é daqui que sai o "há quanto tempo"
          summary: null,
          report: null,
          durationMs: null,
        }
        : { kind: 'tool', ...toolFromUse(b), result: null };
      if (bloco.id) porId.set(bloco.id, bloco);
      blocks.push(bloco);
      continue;
    }
    const text = limpar(messageText([b]));
    if (text && !isNoiseText(text)) blocks.push({ kind: 'text', text: text.slice(0, MAX_TEXT) });
  }
  return blocks;
}

/**
 * Casa um `tool_result` com quem o pediu. Num agente o aceite do disparo NÃO o encerra:
 * dizer "pronto" ali seria mentir sobre doze minutos de trabalho que ainda vêm.
 */
function resolver(alvo, block, porAgente) {
  if (!alvo) return;
  const result = toolResultFrom(block);
  if (alvo.kind !== 'agent') {
    alvo.result = result;
    return;
  }
  if (isLaunchAck(result.text)) {
    // o aceite não encerra nada, mas é ONDE VEM o id estável do agente
    const agentId = agentIdFromAck(result.text);
    if (agentId) porAgente.set(agentId, alvo);
    return;
  }
  Object.assign(alvo, { running: false, report: result.text, summary: 'terminou' });
}

// O próprio CLI avisa que o mesmo agente pode notificar mais de uma vez: ele para, você
// manda outra mensagem, ele volta. Então "terminou" é o que o `status` disser, não o fato
// de ter chegado um aviso.
const FIM = new Set(['completed', 'failed']);

const endOf = (fim, disparo, aviso) => ({
  running: !FIM.has(fim.status),
  summary: fim.summary,
  report: fim.result.slice(0, MAX_TEXT),
  status: fim.status,
  durationMs: duracao(disparo, aviso),
});

/** Quanto tempo o agente levou — os dois carimbos são do próprio transcript. */
function duracao(disparo, aviso) {
  const a = Date.parse(disparo || '');
  const b = Date.parse(aviso || '');
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? b - a : null;
}

/** Conteúdo cru como texto — para achar o `<task-notification>` venha string ou blocos. */
const rawText = (content) => (typeof content === 'string' ? content : messageText(content));

const limpar = (t) => String(t || '').replace(/\n{3,}/g, '\n\n').trim();
