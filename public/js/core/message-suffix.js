// Frase fixa no fim de toda mensagem ("assine sempre em português", "responda em
// tópicos"…). Regra pura: entra o que você escreveu, sai o que vai ser enviado.
//
// Fica em `core/` do front, sem DOM e sem API, por dois motivos: o componente que
// desenha o controle não pode carregar regra, e assim a regra é testável pelo
// `node --test` como qualquer outra (test/message-suffix.test.js).

/** Separador entre a mensagem e a frase: linha em branco, como um parágrafo novo. */
const SEP = '\n\n';

/**
 * @param {string} message o que a pessoa escreveu
 * @param {{phrase?:string, enabled?:boolean}} [config] preferência da conversa
 * @returns {string} o texto que deve ser enviado (e mostrado na tela)
 */
export function applySuffix(message, { phrase = '', enabled = false } = {}) {
  const base = String(message ?? '');
  const frase = String(phrase ?? '').trim();
  if (!enabled || !frase) return base;

  // já termina com a frase? não repete — reenviar/reencaminhar não deve empilhar
  if (base.trimEnd().endsWith(frase)) return base;

  // mensagem vazia (ex.: só imagens): a frase vira a mensagem, sem linha à toa
  return base.trim() ? `${base.trimEnd()}${SEP}${frase}` : frase;
}
