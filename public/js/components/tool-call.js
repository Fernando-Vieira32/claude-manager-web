// Uma chamada de ferramenta dentro de uma mensagem: chip clicável que abre o
// detalhe (o que foi pedido e o que voltou). Serve para QUALQUER ferramenta —
// Bash, Edit, um subagente (`Agent`) — porque não sabe o nome de nenhuma.
//
// Burro e isolado: recebe textos já prontos e um callback; não conhece API, rota,
// painel, nem o formato do stream. Quem traduz o stream é o serviço.
//
//   const call = createToolCall({ name: 'Agent', input: '{ … }' });
//   extras.append(call.node);
//   call.setResult({ text: 'relatório do agente', isError: false });
//   call.settle();     // fim do stream: o que não voltou vira "sem resultado"
//   call.destroy();    // remove o listener de clique

import { el } from '../core/ui.js';

const VAZIO = '(vazio)';

/**
 * @param {object} opts
 * @param {string} opts.name nome da ferramenta (rótulo do chip)
 * @param {string} [opts.input] o que foi pedido, já em texto
 * @param {boolean} [opts.inputTruncated] avisa que o texto foi cortado
 * @param {boolean} [opts.open] começa aberto
 * @param {(open:boolean) => void} [opts.onToggle] avisa quem precisa reajustar scroll
 */
export function createToolCall({ name, summary = '', input = '', inputTruncated = false, open = false, onToggle } = {}) {
  const caret = el('span', { class: 'tool-caret' }, '▸');
  // com o chip fechado o trabalho do subagente fica invisível; o contador é o
  // sinal honesto de que tem coisa acontecendo lá dentro
  const passos = el('span', { class: 'tool-steps', hidden: true });
  const chip = el('button', {
    class: 'chip tool-chip',
    type: 'button',
    'aria-expanded': String(open),
    title: summary ? `${name}: ${summary}` : 'ver o que foi pedido e o que voltou',
  }, caret, `⚙ ${name}`,
    // resumo já vem pronto de quem traduziu o stream: o componente não sabe o que
    // é "Agent" nem quais campos existem — só mostra o texto que recebeu
    summary ? el('span', { class: 'tool-summary' }, summary) : null,
    passos);

  const saida = el('pre', { class: 'tool-out' }, 'executando…');
  // onde entram as chamadas FILHAS (o que um subagente fez). Fica escondido até a
  // primeira chegar, para uma ferramenta comum não ganhar uma seção vazia.
  const filhos = el('div', { class: 'tool-kids' });
  const blocoFilhos = el('div', { class: 'tool-block', hidden: true },
    el('span', { class: 'tool-key' }, 'passos'), filhos);
  const detalhe = el('div', { class: 'tool-detail' },
    bloco('pedido', input || VAZIO, inputTruncated),
    blocoFilhos,
    el('div', { class: 'tool-block' }, el('span', { class: 'tool-key' }, 'resultado'), saida));
  detalhe.hidden = !open;

  const node = el('div', { class: open ? 'tool-call open' : 'tool-call' }, chip, detalhe);

  let resolvido = false;

  const alterna = () => {
    const aberto = detalhe.hidden;
    detalhe.hidden = !aberto;
    node.classList.toggle('open', aberto);   // o CSS usa isto para ocupar a linha toda
    chip.setAttribute('aria-expanded', String(aberto));
    caret.textContent = aberto ? '▾' : '▸';
    onToggle?.(aberto);
  };
  chip.addEventListener('click', alterna);
  if (open) caret.textContent = '▾';

  let nFilhos = 0;

  const api = {
    node,

    /**
     * Encaixa uma chamada FILHA (o que um subagente fez). Recebe um nó pronto —
     * quem monta é quem tem os dados; esta peça só dá o lugar. Aninha em qualquer
     * profundidade: se o filho também tiver filhos, ele resolve o dele.
     */
    addChild(childNode) {
      if (!childNode) return api;
      nFilhos += 1;
      blocoFilhos.hidden = false;
      passos.hidden = false;
      passos.textContent = nFilhos === 1 ? '1 passo' : `${nFilhos} passos`;
      filhos.append(childNode);
      return api;
    },

    /** O que a ferramenta devolveu. */
    setResult({ text = '', truncated = false, isError = false } = {}) {
      resolvido = true;
      saida.textContent = text || VAZIO;
      saida.classList.toggle('tool-err', isError);
      if (truncated) saida.append(el('span', { class: 'tool-cut' }, '\n… cortado no limite de exibição'));
      chip.classList.toggle('err', isError);
      return api;
    },

    /**
     * Fim do stream. O que não voltou não vira "vazio" nem fica "executando…"
     * para sempre: dizemos que não houve resultado, que é a verdade.
     */
    settle() {
      if (resolvido) return api;
      resolvido = true;
      saida.textContent = 'sem resultado registrado neste stream';
      saida.classList.add('tool-none');
      return api;
    },

    destroy() { chip.removeEventListener('click', alterna); },
  };

  return api;
}

/** Rótulo + texto de um pedaço do detalhe. */
function bloco(rotulo, texto, cortado) {
  return el('div', { class: 'tool-block' },
    el('span', { class: 'tool-key' }, rotulo),
    el('pre', { class: 'tool-out' }, texto,
      cortado ? el('span', { class: 'tool-cut' }, '\n… cortado no limite de exibição') : null));
}
