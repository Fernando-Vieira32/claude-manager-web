// Uma resposta CHEGANDO na tela — em BLOCOS, na ordem em que as coisas acontecem.
//
// Antes era uma bolha só: a prosa em cima e as ferramentas empilhadas no pé. Isso
// embrulhava numa caixa o que o terminal mostra separado, trocava a ordem (a chamada que
// veio ANTES do parágrafo aparecia depois dele) e — o que doeu de verdade — enterrava um
// agente de doze minutos dentro de uma mensagem já terminada.
//
// Agora: a caixa principal é só o texto do main; cada ferramenta e cada agente é um bloco
// próprio; e a bolha viva (o indicador "pensando…") é sempre o ÚLTIMO item, como o spinner
// no pé do terminal.
//
// Burro do jeito de sempre: recebe o feed, callbacks e (opcional) a faixa de agentes.
// Não conhece rota, api nem painel. O contrato dos eventos está em readme/10-chat.md.
//
//   const resposta = createLiveAnswer({ feed, agents: faixa, onHint: (t) => composer.setHint(t) });
//   await send(texto, valores, imagens, resposta.onEvent, sinal);
//   resposta.finish();

import { streamBubble } from './bubble.js';
import { createToolCall } from './tool-call.js';
import { createStreamSink } from './stream-sink.js';

/**
 * @param {object} opts
 * @param {object} opts.feed onde os blocos entram (`append`, `remove`, `moveToEnd`)
 * @param {string} [opts.label] rótulo inicial do indicador vivo
 * @param {(text:string) => void} [opts.onHint] rodapé (modo, custo)
 * @param {{track:Function,end:Function}} [opts.agents] os agentes em segundo plano DA
 *   CONVERSA (faixa + registro): um agente nasce num turno e volta em outro, então quem
 *   guarda o cartão dele não pode ser esta resposta
 * @returns {{bubble:object, onEvent:Function, finish:Function, destroy:Function}}
 */
export function createLiveAnswer({ feed, label = 'pensando…', onHint, agents } = {}) {
  const startedAt = Date.now();
  const porId = new Map();     // id do tool_use -> a chamada desenhada
  // Ids que pertencem a um AGENTE (ele mesmo, e o que ele foi rodando). O que sai de dentro
  // de um agente não entra na conversa: quem mostra isso é a faixa do rodapé, com o
  // transcrito dele. Sem esta lista, as ferramentas do agente caíam soltas no feed — foi o
  // que enfeiou a tela: dez linhas de `Bash cd /home/...` no meio do fio principal.
  const dentroDeAgente = new Set();
  const vivos = [];            // tudo com timer/listener: destruir no fim
  const abertos = [];          // chamadas sem resultado: resolver no fim
  let bolha = null;            // a bolha viva; nasce quando faz falta
  let rotulo = label;

  const rolar = () => feed.scrollToEnd();

  /** A bolha viva — criada só quando há o que mostrar, e sempre no fim do feed. */
  function viva() {
    if (bolha) return bolha;
    bolha = streamBubble({ role: 'assistant', label: rotulo, startedAt });
    vivos.push(bolha);
    feed.append(bolha.node);
    rolar();
    return bolha;
  }

  /**
   * Um bloco novo entra. Se a bolha viva ainda não escreveu nada, ela só desce (o relógio
   * dela é do turno, não do bloco); se já tem prosa, ela FICA onde está — a ordem na tela
   * é a ordem do que aconteceu — e a próxima nasce depois.
   */
  function empilhar(node) {
    feed.append(node);
    if (bolha && bolha.empty) {
      feed.moveToEnd(bolha.node);   // ainda não escreveu nada: continua sendo ela, só desce
    } else if (bolha) {
      // Ela já disse o que tinha para dizer e o turno seguiu para outro bloco: PARA o
      // indicador dela. Sem isto cada parágrafo deixava para trás uma bolha pulsando
      // "pensando…" para sempre — mentira na tela e um timer vivo por parágrafo.
      bolha.finish();
      bolha = null;
    }
    rolar();
  }

  /** Onde este bloco entra: dentro de quem o criou (subagente), ou solto na conversa. */
  function encaixar(node, parentId) {
    const pai = parentId ? porId.get(parentId) : null;
    if (pai) {
      pai.addChild(node);
      rolar();
      return;
    }
    empilhar(node);   // pai desconhecido: melhor mostrar solto que sumir
  }

  // A "superfície" que o tradutor de eventos usa. Tem a cara da bolha de antes (append,
  // setActivity, setError…) mais o que é de bloco (addTool, addAgent) — assim o
  // `stream-sink` continua sendo só tradutor, sem saber onde cada coisa é desenhada.
  const surface = {
    get failed() { return Boolean(bolha?.failed); },
    text: () => bolha?.text() || '',

    append(chunk) { viva().append(chunk); rolar(); return surface; },
    setActivity(text) { rotulo = text; viva().setActivity(text); return surface; },
    setStatus(text, kind) { viva().setStatus(text, kind); return surface; },
    addNotice(message) { viva().addNotice(message); return surface; },
    setError(message) { viva().setError(message); return surface; },

    addTool(name, { id, parentId, summary, input, inputTruncated, onToggle } = {}) {
      if (parentId && dentroDeAgente.has(parentId)) {
        if (id) dentroDeAgente.add(id);   // e os filhos DELE também ficam de fora
        return surface;
      }
      const call = createToolCall({ name, summary, input, inputTruncated, onToggle });
      call.node.classList.add('feed-block', 'feed-tool');
      if (id) porId.set(id, call);
      vivos.push(call);
      abertos.push(call);
      encaixar(call.node, parentId);
      return surface;
    },

    /**
     * Um AGENTE — bloco próprio, com relógio vivo, e também na faixa de "rodando agora".
     * O trabalho dele não vem no resultado da ferramenta (aquilo é só o aceite do
     * disparo), então quem o encerra é o aviso de fim (`agentEnd`).
     */
    addAgent({ id, name, agentType } = {}) {
      if (id) dentroDeAgente.add(id);
      // O cartão NÃO vai para a conversa: ele existe só como registro (é por ele que o aviso
      // de fim, que chega minutos depois, encontra quem encerrar) e o que a pessoa vê é a
      // linha na faixa do rodapé. Ver o porquê em readme/10-chat.md.
      if (id) agents?.track({ id, name, agentType, startedAt: Date.now() });
      return surface;
    },

    /**
     * O agente voltou: relatório no cartão dele e fora da faixa. Quem acha o cartão é o
     * registro da CONVERSA — o disparo pode ter sido num turno anterior, que já fechou.
     * Sem cartão nenhum (agente que começou antes desta tela), o relatório vira um cartão
     * solto: melhor mostrar solto que jogar fora doze minutos de trabalho.
     */
    endAgent({ id, taskId, summary, result, status, durationMs } = {}) {
      // Sai da faixa. Se ninguém conhece esse agente (ele começou antes desta tela), não há
      // o que fazer na conversa: o relatório dele vira resposta do Claude principal, que é
      // quem interpreta e fala com você — e isso chega pelo turno, não por aqui.
      agents?.end(id, { summary, report: result, status, durationMs }, taskId);
      return surface;
    },

    setToolResult(id, payload = {}) {
      const alvo = porId.get(id);
      if (!alvo) return surface;
      // Aceite do disparo de agente: NÃO encerra nada. Tratar isso como resultado era o
      // que fazia o agente parecer "pronto" em 3s enquanto seguia trabalhando. Só que ele
      // traz o id ESTÁVEL do agente — a chave por onde o aviso de fim vai chegar.
      if (payload.ack) {
        if (payload.agentId) {
          porId.set(payload.agentId, alvo);
          agents?.alias(payload.agentId, id);
        }
        return surface;
      }
      if (alvo.setResult) alvo.setResult(payload);                      // ferramenta comum
      else alvo.finish({ summary: 'terminou', report: payload.text });  // agente síncrono
      return surface;
    },

    /** Fim do turno. Bolha viva sem nada escrito sai do feed em vez de virar "(sem texto)". */
    finish(resumo) {
      for (const call of abertos.splice(0)) call.settle?.();
      if (bolha && bolha.empty) {
        feed.remove(bolha.node);
        bolha.destroy();
        bolha = null;
        return surface;
      }
      bolha?.finish(resumo);
      return surface;
    },
  };

  const onEvent = createStreamSink({ bubble: surface, onHint, onScroll: rolar });

  // A primeira bolha nasce JÁ: "começou algo" é informação, e esperar o primeiro evento
  // deixava a tela sem sinal nenhum por vários segundos — inclusive no turno que o
  // terminal começa, onde o indicador é a única coisa que aparece de início.
  viva();

  const api = {
    /** A superfície da resposta (o que era "a bolha"): quem envia usa `failed`/`text()`. */
    bubble: surface,
    onEvent,

    /** Encerra o estado "trabalhando" — sem isto o indicador pulsa para sempre. */
    finish(resumo) {
      surface.finish(resumo);
      rolar();
      return api;
    },

    /** Obrigatório: bolha viva e cartão de agente têm timer; chip tem listener. */
    destroy() {
      for (const item of vivos.splice(0)) item.destroy?.();
      bolha = null;
      return api;
    },
  };

  return api;
}
