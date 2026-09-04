// Texto em markdown -> NÓS na tela. É o corpo de uma bolha do Claude.
//
// Burro e isolado: recebe uma string, devolve `{ node, setText, flush, destroy }`. Não
// conhece api, rota nem painel — quem decide o que é markdown é quem monta a bolha
// (`bubble.js`). A gramática mora em `core/markdown.js`, que é pura e testada.
//
// **Nada de `innerHTML`.** O texto vem de fora (o Claude escreve, e o que ele leu pode ter
// vindo de qualquer arquivo): montamos elemento por elemento, então uma `<img onerror>`
// no meio da resposta é só texto — não executa.
//
//   const corpo = createMarkdownText({ text: msg.text });
//   bolha.append(corpo.node);
//   corpo.setText(buffer);   // stream: redesenha no próximo quadro
//   corpo.flush();           // fim do turno: desenha agora
//   corpo.destroy();         // cancela o quadro pendente

import { el } from '../core/ui.js';
import { parseMarkdown } from '../core/markdown.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.text] o markdown inicial
 */
export function createMarkdownText({ text = '' } = {}) {
  const node = el('div', { class: 'md-body' });
  let atual = String(text);
  let quadro = 0;

  const desenhar = () => {
    quadro = 0;
    node.replaceChildren(...parseMarkdown(atual).map(bloco));
  };

  const api = {
    node,

    /**
     * Texto novo. O desenho espera o próximo quadro de propósito: uma resposta chega em
     * centenas de `text_delta`, e redesenhar em cada um é trabalho jogado fora (o
     * navegador só pinta uma vez por quadro de todo jeito).
     */
    setText(value) {
      const novo = String(value ?? '');
      if (novo === atual) return api;
      atual = novo;
      if (!quadro) quadro = requestAnimationFrame(desenhar);
      return api;
    },

    /** Desenha AGORA — no fim do turno ninguém pode ver a resposta faltando o último pedaço. */
    flush() {
      if (quadro) cancelAnimationFrame(quadro);
      desenhar();
      return api;
    },

    /** Obrigatório: a bolha pode sair da tela com um quadro já agendado. */
    destroy() {
      if (quadro) cancelAnimationFrame(quadro);
      quadro = 0;
    },
  };

  desenhar();
  return api;
}

/* --------------------------------------------------------------- desenho */

function bloco(b) {
  // `#` da resposta vira `<h3>`: a bolha está dentro de uma página que já tem título, e um
  // `<h1>` aqui mentiria na estrutura. O tamanho na tela vem da classe, não da tag.
  if (b.kind === 'heading') return el(`h${Math.min(b.level + 2, 6)}`, { class: `md-h md-h${b.level}` }, ...linha(b.inline));
  if (b.kind === 'code') return codigo(b);
  if (b.kind === 'list') return el(b.ordered ? 'ol' : 'ul', { class: 'md-list' },
    ...b.items.map((it) => el('li', { class: 'md-item' }, ...it.blocks.map(bloco))));
  if (b.kind === 'quote') return el('blockquote', { class: 'md-quote' }, ...b.blocks.map(bloco));
  if (b.kind === 'rule') return el('hr', { class: 'md-rule' });
  if (b.kind === 'table') return tabela(b);
  return el('p', { class: 'md-p' }, ...linha(b.inline));
}

/** Bloco de código com a linguagem à mostra — é o rótulo que a cerca traz e o terminal usa. */
const codigo = ({ lang, text }) => el('div', { class: 'md-code-wrap' },
  lang ? el('span', { class: 'md-code-lang' }, lang) : null,
  el('pre', { class: 'md-code' }, el('code', {}, text)));

const tabela = ({ head, rows }) => el('div', { class: 'md-table-wrap' },
  el('table', { class: 'md-table' },
    el('thead', {}, el('tr', {}, ...head.map((c) => el('th', {}, ...linha(c))))),
    el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, ...linha(c))))))));

/** Os pedaços de uma linha (negrito, código, link…) como nós. */
function linha(pedacos = []) {
  return pedacos.map((p) => {
    if (p.kind === 'code') return el('code', { class: 'md-code-inline' }, p.text);
    if (p.kind === 'strong') return el('strong', {}, ...linha(p.children));
    if (p.kind === 'em') return el('em', {}, ...linha(p.children));
    if (p.kind === 'strike') return el('s', {}, ...linha(p.children));
    // `noopener`/`noreferrer`: o link vem do texto, então tratamos como link de estranho
    if (p.kind === 'link') return el('a', seguro(p.href), ...linha(p.children));
    return document.createTextNode(p.text);
  });
}

/**
 * Atributos de um link do texto. Só `http(s)` e `mailto` viram link mesmo: um `href`
 * `javascript:` viraria execução no clique, então esse vira texto puro.
 */
function seguro(href) {
  const ok = /^(https?:|mailto:)/i.test(href);
  return ok
    ? { class: 'md-link', href, target: '_blank', rel: 'noopener noreferrer' }
    : { class: 'md-link off', title: 'link não suportado' };
}
