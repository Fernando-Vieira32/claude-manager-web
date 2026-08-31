// Um AGENTE como bloco próprio da conversa — não um chip no pé de uma mensagem.
//
// Por que existe: agente de segundo plano trabalha por minutos, e o resultado da
// ferramenta que o disparou volta em ~3 s dizendo só "Async agent launched successfully".
// Desenhado como ferramenta comum, ele aparecia **resolvido** enquanto seguia trabalhando
// — e enterrado dentro de uma bolha já terminada. No terminal ele é um item próprio, com
// nome, tempo decorrido e o relatório quando volta; aqui é igual.
//
// Burro como manda o figurino: recebe dados e callbacks, compõe o `activity` (indicador
// vivo com relógio) e não conhece rota, painel nem stream.
//
//   const card = createAgentCard({ name: 'Lane 1', agentType: 'general-purpose' });
//   feed.append(card.node);
//   card.addChild(toolCall.node);                       // o que ele fez, se soubermos
//   card.finish({ summary: 'terminou', report: '…', durationMs: 726000 });
//   card.destroy();                                     // tem timer: sempre

import { el } from '../core/ui.js';
import { createActivity } from './activity.js';
import { createStepsBox } from './agent-steps.js';

const VAZIO = 'sem relatório registrado';
// `killed`/`stopped` são fim de verdade (medido: 188 casos nos transcritos), e nenhum deles
// é sucesso — chip verde ali seria mentira. "não sei" fica neutro, sem verde nem alerta.
const CHIP = {
  failed: 'warn', killed: 'warn', stopped: 'warn', unknown: '',
};

/**
 * @param {object} opts
 * @param {string} opts.name o que o agente foi fazer (`description` da chamada)
 * @param {string} [opts.agentType] tipo do subagente (`general-purpose`…)
 * @param {string} [opts.model] modelo escolhido para ele
 * @param {boolean} [opts.running=true] começa rodando (ao vivo) ou já terminado (do disco)
 * @param {string} [opts.summary] rótulo do fim, quando já terminou
 * @param {string} [opts.report] relatório, quando já terminou
 * @param {number} [opts.durationMs] quanto durou, quando se sabe
 * @param {string} [opts.status] `completed` | `failed` — como ele terminou
 * @param {string|number} [opts.startedAt] quando ele foi disparado (ISO ou ms)
 * @param {(open:boolean) => void} [opts.onToggle] avisa quem precisa reajustar o scroll
 * @param {string} [opts.stepsRef] por qual id se pedem os passos deste agente — o do
 *   DISPARO, que é o que a tela conhece (o id estável do agente nunca vem para cá)
 * @param {(ref:string, card:object) => Promise<number>} [opts.onOpen] busca os passos ao
 *   abrir o cartão pela primeira vez e os põe aqui com `addChild`. Só callback: o cartão
 *   não conhece rota nem api
 */
export function createAgentCard({
  name = 'agente', agentType = '', model = '', running = true,
  summary = '', report = '', durationMs = null, status = 'completed', startedAt = null, onToggle,
  stepsRef = null, onOpen,
} = {}) {
  const caret = el('span', { class: 'agent-caret' }, '▸');
  // o relógio conta do DISPARO quando ele é conhecido (cartão lido do disco), não de agora
  const activity = createActivity({ label: 'rodando…', startedAt: emMs(startedAt) });
  const fim = el('span', { class: 'chip ok', hidden: true });
  const head = el('button', {
    class: 'agent-head',
    type: 'button',
    'aria-expanded': 'false',
    title: 'ver o relatório do agente',
  }, caret,
    el('span', { class: 'agent-name' }, name),
    agentType ? el('span', { class: 'chip agent-type' }, agentType) : null,
    model ? el('span', { class: 'chip agent-model' }, model) : null,
    activity.node, fim);

  // enquanto ele roda não existe relatório: dizer "trabalhando…" aqui sugeria que este
  // campo ia se encher aos poucos, e ele só é escrito de uma vez, no fim
  const saida = el('pre', { class: 'tool-out' }, 'o relatório chega quando ele terminar');
  // a caixa dos passos é a MESMA peça que a faixa do rodapé usa (agent-steps.js)
  const passos = createStepsBox({ ref: stepsRef, onOpen });
  const detalhe = el('div', { class: 'agent-detail', hidden: true },
    el('div', { class: 'tool-block' }, el('span', { class: 'tool-key' }, 'relatório'), saida),
    passos.node);

  const node = el('div', { class: 'agent-card running' }, head, detalhe);

  const alterna = () => {
    const aberto = detalhe.hidden;
    detalhe.hidden = !aberto;
    node.classList.toggle('open', aberto);
    head.setAttribute('aria-expanded', String(aberto));
    caret.textContent = aberto ? '▾' : '▸';
    if (aberto) passos.load();
    onToggle?.(aberto);
  };
  head.addEventListener('click', alterna);

  let vivo = false;

  const api = {
    node,
    get running() { return vivo; },

    /** Abre o cartão (e busca os passos). Idempotente: aberto, fica aberto. */
    open() {
      if (detalhe.hidden) alterna();
      return api;
    },

    /** Um passo do agente (uma ferramenta que ele rodou). Recebe o nó já montado. */
    addChild(childNode) {
      passos.addChild(childNode);
      return api;
    },

    /**
     * Encerra o cartão. `summary`/`report` vêm do aviso do CLI; sem relatório dizemos
     * isso, e não "(vazio)" — o agente pode ter parado sem escrever nada.
     */
    finish({ summary: resumo = 'terminou', report: texto = '', durationMs: dur = null, status = 'completed' } = {}) {
      vivo = false;
      activity.stop();
      activity.node.hidden = true;
      node.classList.remove('running');
      node.classList.toggle('failed', status === 'failed');
      // "não sei como terminou" não é sucesso nem erro: chip neutro, sem verde de pronto
      fim.className = `chip ${CHIP[status] || 'ok'}`;
      fim.textContent = dur ? `${resumo} · ${duracao(dur)}` : resumo;
      fim.hidden = false;
      saida.textContent = texto || VAZIO;
      saida.classList.toggle('tool-none', !texto);
      return api;
    },

    /** Obrigatório: o indicador vivo tem timer, e o cartão pode sair da tela antes. */
    destroy() {
      head.removeEventListener('click', alterna);
      activity.destroy();
      return api;
    },
  };

  if (running) {
    vivo = true;
    activity.start();
  } else {
    api.finish({ summary: summary || 'terminou', report, durationMs, status });
  }

  return api;
}

/** ISO ou ms -> ms; nada reconhecível vira `null` (o relógio começa agora). */
function emMs(valor) {
  if (!valor) return null;
  const ms = typeof valor === 'number' ? valor : Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

/** 726000 -> "12m 06s" (o mesmo formato do indicador vivo). */
function duracao(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
