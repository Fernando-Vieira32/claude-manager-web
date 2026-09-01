// Markdown -> BLOCOS. É a tradução que faltava: o Claude responde em markdown, e a tela
// mostrava o texto cru — `**Criados**`, ``` e `|---|` na cara do usuário.
//
// Regra pura: string entra, árvore de blocos sai. Não conhece DOM, api nem painel — quem
// desenha é o componente `markdown-text.js`, montando nós (nunca `innerHTML`: o texto vem
// de fora e virar HTML seria buraco de segurança). Por ser pura, tem teste na suíte.
//
//   parseMarkdown('## Criados\n\n- `a.rb` 52\n- `b.rb` 81')
//   // [{kind:'heading',level:2,…}, {kind:'list',ordered:false,items:[…]}]
//
// O subconjunto é o que o Claude realmente escreve: título, parágrafo, cerca de código,
// lista (aninhada), citação, régua e tabela. Não é um CommonMark completo de propósito —
// HTML embutido, nota de rodapé e link de referência ficam como texto, que é honesto.

import { parseInline } from './markdown-inline.js';

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^(\s*)([-*+])[ \t]+(.*)$/;
const NUMBER = /^(\s*)(\d{1,9})[.)][ \t]+(.*)$/;
const TABLE_SEP = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * @param {string} source o texto da mensagem, como veio do Claude
 * @returns {Array<object>} blocos: `heading`, `para`, `code`, `list`, `quote`, `rule`, `table`
 */
export function parseMarkdown(source = '') {
  return blocos(String(source).replace(/\r\n?/g, '\n').split('\n'));
}

/** Os leitores, em ordem de precedência. `paragrafo` é o último e sempre casa. */
const LEITORES = [cerca, titulo, regua, citacao, tabela, lista, paragrafo];

function blocos(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i += 1; continue; }
    let lido = null;
    for (const leitor of LEITORES) {
      lido = leitor(lines, i);
      if (lido) break;
    }
    out.push(lido.block);
    i = Math.max(lido.next, i + 1);   // trava: nenhum leitor pode devolver "não andei"
  }
  return out;
}

/**
 * Cerca de código. Cerca ABERTA (o caso do stream: a resposta ainda está chegando) vale
 * até o fim do texto — assim o código aparece formatado enquanto é escrito, em vez de
 * piscar entre parágrafo e bloco a cada pedaço que chega.
 */
function cerca(lines, i) {
  const m = FENCE.exec(lines[i]);
  if (!m) return null;
  const fim = new RegExp(`^ {0,3}${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}[ \t]*$`);
  const corpo = [];
  let j = i + 1;
  while (j < lines.length && !fim.test(lines[j])) { corpo.push(lines[j]); j += 1; }
  return { block: { kind: 'code', lang: m[2] || '', text: corpo.join('\n') }, next: j + 1 };
}

function titulo(lines, i) {
  const m = HEADING.exec(lines[i]);
  if (!m) return null;
  return { block: { kind: 'heading', level: m[1].length, inline: parseInline(m[2]) }, next: i + 1 };
}

function regua(lines, i) {
  if (!RULE.test(lines[i])) return null;
  return { block: { kind: 'rule' }, next: i + 1 };
}

/** Citação: só as linhas com `>` (linha em branco encerra) — sem continuação preguiçosa. */
function citacao(lines, i) {
  const dentro = [];
  let j = i;
  while (j < lines.length) {
    const m = QUOTE.exec(lines[j]);
    if (!m) break;
    dentro.push(m[1]);
    j += 1;
  }
  if (j === i) return null;
  return { block: { kind: 'quote', blocks: blocos(dentro) }, next: j };
}

/**
 * Tabela — o formato do pipe, que o Claude usa muito. O que a identifica não é o `|`
 * (aparece em comando shell): é a linha SEPARADORA logo abaixo do cabeçalho.
 */
function tabela(lines, i) {
  if (!lines[i].includes('|')) return null;
  if (!TABLE_SEP.test(lines[i + 1] || '')) return null;
  const head = celulas(lines[i]);
  const rows = [];
  let j = i + 2;
  while (j < lines.length && lines[j].trim() && lines[j].includes('|')) { rows.push(celulas(lines[j])); j += 1; }
  return { block: { kind: 'table', head, rows }, next: j };
}

const celulas = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => parseInline(c.trim()));

/**
 * Lista. Cada item é um mini-documento (`blocks`), então sub-lista, código e parágrafo
 * dentro do item saem de graça pela recursão: o que está mais indentado que o marcador
 * pertence ao item, é desindentado e relido.
 *
 * Linha em branco encerra a lista. Uma lista "solta" (com linha em branco entre os itens)
 * vira duas listas — na tela a diferença é o espaço, e o preço disso é um leitor que
 * caberia num arquivo só.
 */
function lista(lines, i) {
  const primeiro = item(lines[i]);
  if (!primeiro) return null;
  const items = [];
  let j = i;

  while (j < lines.length && lines[j].trim()) {
    const m = item(lines[j]);
    // Item mais RASO encerra a lista (é ele que fecha a sub-lista e volta ao pai). Mais
    // fundo nunca chega aqui: o laço de baixo já levou tudo que estava indentado.
    if (!m || m.indent < primeiro.indent || m.ordered !== primeiro.ordered) break;
    const dentro = [m.text];
    j += 1;
    while (j < lines.length && lines[j].trim() && recuo(lines[j]) > m.indent) {
      dentro.push(lines[j].slice(Math.min(recuo(lines[j]), m.indent + m.width)));
      j += 1;
    }
    items.push({ blocks: blocos(dentro) });
  }
  return { block: { kind: 'list', ordered: primeiro.ordered, items }, next: j };
}

/** Um marcador de item, se a linha for um. `width` é o quanto desindentar o filho. */
function item(line) {
  const bullet = BULLET.exec(line);
  if (bullet) return { indent: bullet[1].length, ordered: false, text: bullet[3], width: 2 };
  const numero = NUMBER.exec(line);
  if (numero) return { indent: numero[1].length, ordered: true, text: numero[3], width: numero[2].length + 2 };
  return null;
}

const recuo = (line) => line.length - line.trimStart().length;

/**
 * Parágrafo — o que não é nenhum dos outros. Junta as linhas seguintes com `\n` (e não
 * com espaço, como manda o CommonMark): a quebra que a pessoa vê é a que o Claude
 * escreveu, igual ao terminal. Para quando outro bloco começa.
 */
function paragrafo(lines, i) {
  const buf = [lines[i].trim()];
  let j = i + 1;
  while (j < lines.length && lines[j].trim() && !comecaBloco(lines, j)) { buf.push(lines[j].trim()); j += 1; }
  return { block: { kind: 'para', inline: parseInline(buf.join('\n')) }, next: j };
}

/** A linha `j` abre um bloco novo? (é o que impede o parágrafo de comer a lista abaixo) */
const comecaBloco = (lines, j) => FENCE.test(lines[j]) || HEADING.test(lines[j]) || RULE.test(lines[j])
  || QUOTE.test(lines[j]) || Boolean(item(lines[j]))
  || (lines[j].includes('|') && TABLE_SEP.test(lines[j + 1] || ''));
