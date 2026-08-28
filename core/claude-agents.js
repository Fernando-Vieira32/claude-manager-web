// O que se sabe sobre AGENTES (subagentes) nas linhas do Claude Code.
//
// Vive no core porque os dois serviços leem a mesma coisa e serviço não importa serviço:
// o `chat` traduz ao vivo (stream e transcript) e o `conversations` traduz ao ler o disco.
//
// O que fez este arquivo existir: um agente de segundo plano **não** devolve o trabalho
// no resultado da ferramenta. O `tool_result` chega em ~3s dizendo só "Async agent
// launched successfully" — o aceite do disparo. O relatório vem MUITO depois, numa
// entrada `user` com `<task-notification>`, que casa com o disparo pelo `tool-use-id`.
// Sem separar essas duas coisas, a interface mostrava a ferramenta "resolvida" em 3s
// enquanto o agente seguia trabalhando por doze minutos — exatamente o que o dono do
// projeto reclamou de ver.

/** Nomes de ferramenta que criam agente. `Task` é o nome antigo do `Agent`. */
const FERRAMENTAS = new Set(['Agent', 'Task']);

export const isAgentTool = (name) => FERRAMENTAS.has(name);

/** O aceite do disparo — NÃO é o relatório do agente. */
export const isLaunchAck = (text) => /async agent launched successfully/i.test(text || '');

/**
 * O id ESTÁVEL do agente, que vem no texto do aceite (`agentId: a96a…`).
 *
 * Ele importa porque o aviso de fim casa por ele (`<task-id>`), e não pelo `tool_use` do
 * disparo: quando o agente é **retomado** (o CLI manda mensagem para ele), o aviso vem com
 * o id da chamada que o retomou — pelo `tool_use` do disparo aquele relatório não casaria
 * com nada e o cartão ficaria "rodando…" com o trabalho dele perdido.
 *
 * O próprio CLI diz no texto para não mostrar esse id a ninguém: ele serve de chave aqui
 * dentro e **não** vai para a tela.
 */
export function agentIdFromAck(text) {
  const m = /agentId:\s*([A-Za-z0-9_-]+)/.exec(String(text || ''));
  return m ? m[1] : null;
}

/**
 * Um `tool_use` de agente -> o que a interface mostra enquanto ele roda.
 * `id` é o id do `tool_use`, e é por ele que o fim (task-notification) se casa.
 */
export function agentFromUse(block) {
  const input = block?.input || {};
  return {
    id: block?.id || null,
    name: texto(input.description) || 'agente',
    agentType: texto(input.subagent_type) || null,
    model: texto(input.model) || null,
  };
}

/**
 * `<task-notification>` -> o fim de um agente, ou `null` se não for isso.
 *
 * Formato (gravado pelo CLI numa entrada `user`):
 *   <task-notification>
 *     <task-id>…</task-id> <tool-use-id>toolu_…</tool-use-id>
 *     <status>completed</status> <summary>Agent "X" finished</summary>
 *     <result>…relatório…</result>
 *   </task-notification>
 *
 * O `<note>` do próprio CLI avisa que o MESMO agente pode notificar mais de uma vez (ele
 * para, você manda outra mensagem, ele volta) — então quem consome isto trata "terminou"
 * como um estado que pode voltar atrás, não como um fim definitivo.
 */
export function parseTaskNotification(raw) {
  const text = String(raw || '');
  if (!text.includes('<task-notification>')) return null;
  const id = tag(text, 'tool-use-id');
  return {
    taskId: tag(text, 'task-id'),
    id,                                   // casa com o `tool_use` do disparo
    status: tag(text, 'status') || 'completed',
    summary: tag(text, 'summary') || 'agente terminou',
    result: tag(text, 'result') || '',
  };
}

/** Conteúdo de uma tag simples. Sem regex gulosa: o `<result>` tem quebras e `<`. */
function tag(text, name) {
  const abre = `<${name}>`;
  const fecha = `</${name}>`;
  const i = text.indexOf(abre);
  if (i === -1) return '';
  const j = text.indexOf(fecha, i + abre.length);
  if (j === -1) return '';
  return text.slice(i + abre.length, j).trim();
}

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
