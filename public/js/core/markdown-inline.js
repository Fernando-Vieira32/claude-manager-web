// O que acontece DENTRO de uma linha: negrito, itálico, `código`, ~~riscado~~, link.
//
// Regra pura: texto entra, árvore de pedaços sai. Nada de DOM aqui — quem desenha é o
// componente (`markdown-text.js`). Por ser pura, tem teste de verdade na suíte.
//
//   parseInline('veja o **belt** em `policy.rb`')
//   // [{kind:'text'}, {kind:'strong', children:[…]}, {kind:'text'}, {kind:'code'}]

/** Um pedaço: `text`, `code`, `strong`, `em`, `strike` ou `link`. */

const CODE = /^(`+)([\s\S]+?)\1/;
const LINK = /^\[([^\]\n]*)\]\(\s*([^\s)]+?)(?:\s+"[^"]*")?\s*\)/;
const STRONG = /^(\*\*|__)(?=\S)([\s\S]+?)\1/;
const STRIKE = /^~~(?=\S)([\s\S]+?)~~/;
const EM = /^([*_])(?=\S)([^\n]*?[^\s*_])\1/;
const URL = /^https?:\/\/[^\s<>()[\]]+/;
const ESCAPE = /^\\([\\`*_~[\]()#>|-])/;

/**
 * @param {string} text uma linha (ou parágrafo) de markdown
 * @returns {Array<object>} os pedaços, na ordem em que aparecem
 */
export function parseInline(text = '') {
  const source = String(text);
  const out = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain });
    plain = '';
  };

  while (i < source.length) {
    const found = match(source.slice(i), i > 0 ? source[i - 1] : '');
    if (found) {
      flush();
      out.push(found.node);
      i += found.size;
    } else {
      plain += source[i];
      i += 1;
    }
  }
  flush();
  return out;
}

/**
 * O primeiro marcador que casa no começo de `rest`, ou `null` (aí é texto comum).
 *
 * A ordem importa: `código` vem antes de tudo, porque dentro dele um `*` é um asterisco
 * e não itálico — é exatamente o caso de `built_in_copy.rb` e `**` num comando shell.
 *
 * @param {string} rest o resto da linha
 * @param {string} prev o caractere ANTERIOR — é ele que impede `foo_bar_baz` de virar
 *   itálico no meio da palavra, que é o normal em nome de arquivo e de método Ruby.
 */
function match(rest, prev) {
  const escaped = ESCAPE.exec(rest);
  if (escaped) return { node: { kind: 'text', text: escaped[1] }, size: escaped[0].length };

  const code = CODE.exec(rest);
  if (code) return { node: { kind: 'code', text: code[2].trim() }, size: code[0].length };

  const link = LINK.exec(rest);
  if (link) return { node: { kind: 'link', href: link[2], children: parseInline(link[1]) }, size: link[0].length };

  const strong = STRONG.exec(rest);
  if (strong && !dentroDePalavra(strong[1], prev)) {
    return { node: { kind: 'strong', children: parseInline(strong[2]) }, size: strong[0].length };
  }

  const strike = STRIKE.exec(rest);
  if (strike) return { node: { kind: 'strike', children: parseInline(strike[1]) }, size: strike[0].length };

  const em = EM.exec(rest);
  if (em && !dentroDePalavra(em[1], prev)) {
    return { node: { kind: 'em', children: parseInline(em[2]) }, size: em[0].length };
  }

  const url = URL.exec(rest);
  if (url) return { node: { kind: 'link', href: url[0], children: [{ kind: 'text', text: url[0] }] }, size: url[0].length };

  return null;
}

/** `_` colado em letra/número é parte do nome (`eco_decision`), não ênfase. */
const dentroDePalavra = (marker, prev) => marker.startsWith('_') && /[\w]/.test(prev);
