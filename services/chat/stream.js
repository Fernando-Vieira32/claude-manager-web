// Tradutor do stream do CLI: uma linha de `--output-format stream-json` entra, zero
// ou mais eventos do contrato do chat saem (readme/10-chat.md).
//
// Mora fora do repo.js porque é a peça com mais regra por linha do serviço e a que
// mais precisa de teste — e porque o repo.js já cuidava de spawn, modos, imagens e
// validação. Um arquivo, uma responsabilidade.

import { toolFromUse, toolResultFrom, messageText } from '../../core/claude-blocks.js';
import {
  isAgentTool, agentFromUse, isLaunchAck, agentIdFromAck, parseTaskNotification,
} from '../../core/claude-agents.js';

// Só para a mensagem de erro do teto de gasto; quem monta o argumento do CLI é o
// repo.js. Os dois leem a MESMA variável de ambiente, não uma cópia do valor.
const MAX_USD = process.env.CHAT_MAX_USD || '';

/** Blocos de uma mensagem — conteúdo em string não tem bloco nenhum (não é iterável aqui). */
const blocksOf = (content) => (Array.isArray(content) ? content : []);

/** Conteúdo cru como texto, venha string ou blocos (para achar o aviso de fim de agente). */
const rawContent = (content) => (typeof content === 'string' ? content : messageText(content));

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
    // o CLI encerra o turno cortado como erro; quem clicou "Parar" não errou nada,
    // então o runner reescreve o subtype antes de traduzir (services/chat/runner.js)
    case 'interrupted':
      return 'interrompido';
    default:
      return subtype ? `falhou (${subtype})` : 'falhou';
  }
}

/**
 * Traduz UMA linha do stream-json em zero ou mais eventos do contrato do chat
 * (ver readme/10-chat.md). `sse` só precisa ter `send(evento)` — por isso o teste
 * passa um coletor no lugar da conexão de verdade.
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
      // `parent_tool_use_id` diz DE QUEM é esta linha: vazio = thread principal;
      // preenchido = de um subagente, e o valor é o id do `tool_use` que o criou.
      // É o que permite mostrar o trabalho do subagente DENTRO da chamada dele,
      // em vez de despejar tudo no mesmo nível (que era o que acontecia).
      const parentId = event.parent_tool_use_id || null;
      for (const block of event.message?.content || []) {
        if (block?.type === 'text' && block.text) {
          // prosa de subagente não vai para a bolha principal: o relatório dele
          // chega inteiro como RESULTADO do próprio Agent
          if (!parentId) sse.send({ type: 'message', text: block.text });
        } else if (block?.type === 'tool_use') {
          // Agente é outra coisa: ele trabalha por minutos e o `tool_result` dele é só o
          // aceite do disparo. Vira evento próprio para a tela poder mostrá-lo vivo, e
          // não como uma ferramenta que "resolveu" em três segundos.
          if (isAgentTool(block.name)) sse.send({ type: 'agentStart', ...agentFromUse(block), parentId });
          // o `id` correlaciona com o toolResult que vem depois
          else sse.send({ type: 'tool', ...toolFromUse(block), parentId });
        }
      }
      return;
    }

    // O que a ferramenta DEVOLVEU. Vem num evento 'user' (é o CLI devolvendo o
    // resultado ao modelo). Antes isto caía no default e era descartado, então o
    // navegador nunca via resposta de ferramenta nenhuma.
    case 'user': {
      const parentId = event.parent_tool_use_id || null;

      // Fim de agente: o CLI enfileira um `<task-notification>` como se fosse mensagem do
      // usuário. É ali que vem o relatório — e é o único sinal de que ele terminou.
      const fim = parseTaskNotification(rawContent(event.message?.content));
      if (fim) {
        sse.send({ type: 'agentEnd', ...fim });
        return;
      }

      for (const block of blocksOf(event.message?.content)) {
        if (block?.type !== 'tool_result') continue;
        const result = toolResultFrom(block);
        // `ack` avisa que isto é só "agente disparado", não trabalho entregue — e leva o
        // id ESTÁVEL do agente, que é por quem o aviso de fim vai casar depois
        const ack = isLaunchAck(result.text);
        const agentId = ack ? agentIdFromAck(result.text) : null;
        sse.send({ type: 'toolResult', ...result, ack, agentId, parentId });
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
