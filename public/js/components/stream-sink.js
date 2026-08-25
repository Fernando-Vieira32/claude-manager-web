// Tradutor de eventos de stream → uma bolha viva.
//
// É a única peça que conhece o contrato de eventos do stream (`init`, `delta`,
// `tool`, `result`…) e sabe traduzi-lo em chamadas de `streamBubble`. Saiu do
// `chat.js` porque não tem nada a ver com fila, feed nem transporte: dá para
// reaproveitá-la em qualquer lugar que mostre uma resposta chegando (o editor
// explicando um arquivo, um agente rodando em segundo plano).
//
// Burra como manda o figurino: recebe a bolha e dois callbacks, não conhece
// composer, painel nem rota. O contrato completo dos eventos está em readme/10.

/**
 * @param {object} opts
 * @param {object} opts.bubble instância de `streamBubble`
 * @param {(text:string) => void} [opts.onHint] texto de rodapé (modo, custo)
 * @param {() => void} [opts.onScroll] "cresceu": quem rola decide se acompanha
 */
export function createStreamSink({ bubble, onHint, onScroll } = {}) {
  // depois de uma ferramenta o Claude volta a "pensar", então o primeiro delta
  // seguinte tem de trocar o rótulo outra vez — daí este estado viver aqui
  let sawDelta = false;

  const custo = (event) => {
    const parts = [];
    if (event.costUsd != null) parts.push(`$${event.costUsd.toFixed(4)}`);
    if (event.turns != null) parts.push(`${event.turns} turno(s)`);
    return parts.join(' · ');
  };

  const handlers = {
    init: (e) => onHint?.(`modo: ${e.mode} · ${e.cwd || ''}`),

    // modelo vira um chip ao lado do indicador — sem apagar o "pensando…"
    system: (e) => { if (e.model) bubble.setStatus(e.model, 'accent'); },

    // Sua mensagem já chegou em quem responde, mas ele está terminando o que você
    // pediu antes. Dizer "pensando…" aqui seria mentir sobre o que acontece: ainda
    // não começou. `ahead` é quantas mensagens estão na frente desta.
    queued: (e) => bubble.setActivity(
      e.ahead > 1 ? `na fila · ${e.ahead} na frente` : 'na fila · aguardando a vez',
    ),

    // chegou a vez dela: agora sim está sendo respondida
    turnStart: () => bubble.setActivity('pensando…'),

    delta: (e) => {
      if (!sawDelta) bubble.setActivity('escrevendo…');
      sawDelta = true;
      bubble.append(e.text);
      onScroll?.();
    },

    // com streaming ligado o texto já veio em deltas; só usa se faltou
    message: (e) => { if (!sawDelta && e.text) bubble.append(e.text); },

    tool: (e) => {
      bubble.addTool(e.name, {
        id: e.id,
        parentId: e.parentId,     // subagente: entra dentro do chip do Agent
        summary: e.summary,
        input: e.input,
        inputTruncated: e.inputTruncated,
        // abrir/fechar muda a altura: se o usuário estava no fim, siga no fim
        onToggle: () => onScroll?.(),
      });
      // quem está trabalhando é o subagente: dizer "usando Bash" mentiria sobre
      // quem faz o quê — o indicador segue no agente
      if (!e.parentId) {
        bubble.setActivity(`usando ${e.name}…`);
        sawDelta = false;
      }
    },

    toolResult: (e) => bubble.setToolResult(e.id, {
      text: e.text, truncated: e.truncated, isError: e.isError,
    }),

    notice: (e) => bubble.addNotice(e.message),

    result: (e) => {
      const resumo = custo(e);
      if (e.ok) bubble.finish(resumo || 'pronto');
      else bubble.setError(e.message || e.subtype || 'falhou');
      onHint?.(resumo);
    },

    error: (e) => bubble.setError(e.message),
  };

  /** Evento desconhecido é ignorado de propósito: contrato pode crescer. */
  return (event) => handlers[event?.type]?.(event);
}
