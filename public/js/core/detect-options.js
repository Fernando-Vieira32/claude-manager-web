// Detecta, no texto do assistente, uma pergunta com opções em lista — para virar
// botões de resposta rápida. Função pura, sem DOM nem API. Conservadora de
// propósito: só devolve opções quando há um sinal claro de escolha logo antes de
// uma lista curta; na dúvida devolve [] (e a interface não mostra nada).

const ITEM = /^\s*(?:\d{1,2}[.)]|[a-zA-Z][.)]|[-*•—])\s+(\S.*?)\s*$/;
// pistas de que o parágrafo antes da lista está oferecendo uma escolha
const CHOICE_HINT = /(\?|\b(quer|prefer\w*|escolh\w*|op[cç]\w*|qual|deseja|posso|devo|gostaria|seleci\w*|vamos\s+com|op[cç][aã]o)\b)/i;

/**
 * @param {string} text texto final do assistente
 * @returns {Array<{value:string,label:string,full:string}>} opções (ou [])
 */
export function detectOptions(text) {
  if (!text) return [];
  const lines = String(text).split('\n');

  // agrupa linhas de lista contíguas em blocos
  const blocks = [];
  let cur = null;
  lines.forEach((line, i) => {
    const m = line.match(ITEM);
    if (m) {
      if (!cur) cur = { start: i, items: [] };
      cur.items.push(m[1]);
    } else if (cur) { blocks.push(cur); cur = null; }
  });
  if (cur) blocks.push(cur);

  // pega o ÚLTIMO bloco com 2 a 6 itens (padrão "pergunta … e a lista no fim")
  const usable = blocks.filter((b) => b.items.length >= 2 && b.items.length <= 6);
  const block = usable[usable.length - 1];
  if (!block) return [];

  // a lista precisa estar ligada a uma escolha no texto imediatamente antes
  const tail = lines.slice(0, block.start).join('\n').slice(-240);
  if (!CHOICE_HINT.test(tail)) return [];

  const options = block.items.map(clean).filter(Boolean);
  if (options.length < 2) return [];

  // se as "opções" são parágrafos longos, provavelmente não é um menu de escolha
  const avg = options.reduce((a, o) => a + o.value.length, 0) / options.length;
  if (avg > 90) return [];

  return options;
}

/** Extrai um rótulo curto: tira marcação e usa o "líder" antes de um travessão/":". */
function clean(raw) {
  const s = raw.replace(/\*\*/g, '').replace(/[`_]/g, '').trim();
  const sep = s.match(/^(.{1,50}?)\s*[—–:-]\s+\S/);
  const label = (sep ? sep[1] : s).trim().replace(/[.:]+$/, '');
  if (!label) return null;
  return {
    value: label,
    label: label.length > 56 ? `${label.slice(0, 53)}…` : label,
    full: s.length > 220 ? `${s.slice(0, 217)}…` : s,
  };
}
