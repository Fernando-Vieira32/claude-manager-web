// O que se sabe sobre os BLOCOS de conteúdo de uma mensagem do Claude — texto,
// uso de ferramenta, resultado de ferramenta, imagem, pensamento.
//
// Vive no core porque dois serviços precisam da mesma leitura e serviço não
// importa serviço (readme/02): o `chat` traduz isso ao vivo, vindo do stream, e o
// `conversations` traduz o mesmo ao ler o `.jsonl` do disco. Antes cada um tinha
// sua cópia e elas divergiam.
//
// Não conhece HTTP, rota nem painel: entra dado do CLI, sai dado simples.

/** Teto de um detalhe de ferramenta. Prompt de subagente e arquivo lido não cabem. */
export const MAX_DETAIL = 4000;

/**
 * Corta no teto e AVISA que cortou — nunca finge que aquilo era o conteúdo todo.
 * @returns {{text:string,truncated:boolean}|null} null quando não há nada a mostrar
 */
export function clampText(raw, max = MAX_DETAIL) {
  if (!raw) return null;
  const text = String(raw);
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false };
}

/** Valor qualquer (o `input` de uma ferramenta) -> texto legível com teto. */
export function detailOf(value, max = MAX_DETAIL) {
  if (value === undefined || value === null) return null;
  return clampText(typeof value === 'string' ? value : JSON.stringify(value, null, 2), max);
}

/**
 * Conteúdo de um `tool_result` -> texto. Vem como string ou como lista de blocos.
 * Imagem não é embutida (seriam megabytes de base64): vira uma marca.
 */
export function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      if (typeof b === 'string') return b;
      if (b?.type === 'text') return b.text || '';
      if (b?.type === 'image') return '🖼 imagem';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// Campos do `input` que servem de resumo curto, em ordem de preferência. Genérico
// de propósito: não é uma lista de ferramentas, é uma lista de CAMPOS. Ferramenta
// nova que use um destes ganha resumo sem ninguém mexer aqui.
//
// `caminho: true` diz que o valor é um path: aí o que identifica está no FIM
// (o nome do arquivo), então mostramos as duas últimas partes. Nos demais o que
// identifica está no começo (`git status …`), e o corte vai no fim.
const CAMPOS_RESUMO = [
  { key: 'description' },
  { key: 'command' },
  { key: 'pattern' },
  { key: 'query' },
  { key: 'url' },
  { key: 'file_path', caminho: true },
  { key: 'path', caminho: true },
  { key: 'name' },
];
const MAX_RESUMO = 48;

/** Duas últimas partes de um caminho — o suficiente para reconhecer o arquivo. */
const fimDoCaminho = (valor) => valor.split('/').filter(Boolean).slice(-2).join('/');

/**
 * Frase curta do que a ferramenta vai fazer, para caber no chip e a pessoa não
 * precisar abrir. `subagent_type` entra na frente quando existe, porque é o que
 * distingue dois subagentes na mesma resposta.
 */
export function summaryOf(input) {
  if (!input || typeof input !== 'object') return null;
  const partes = [];
  if (typeof input.subagent_type === 'string' && input.subagent_type) partes.push(input.subagent_type);

  const campo = CAMPOS_RESUMO.find(({ key }) => typeof input[key] === 'string' && input[key].trim());
  if (campo) {
    const cru = input[campo.key].trim().replace(/\s+/g, ' ');
    const valor = campo.caminho ? fimDoCaminho(cru) : cru;
    partes.push(valor.length > MAX_RESUMO ? `${valor.slice(0, MAX_RESUMO)}…` : valor);
  }
  return partes.length ? partes.join(' · ') : null;
}

/**
 * Um `tool_use` -> a forma que a interface consome (o mesmo objeto ao vivo e no
 * histórico, para o front ter um só caminho de render).
 */
export function toolFromUse(block) {
  const input = detailOf(block.input);
  return {
    id: block.id || null,
    name: block.name || 'ferramenta',
    summary: summaryOf(block.input),
    input: input?.text || null,
    inputTruncated: input?.truncated || false,
  };
}

/** Um `tool_result` -> a forma que a interface consome. */
export function toolResultFrom(block) {
  const out = clampText(resultText(block.content));
  return {
    id: block.tool_use_id || null,
    text: out?.text || '',
    truncated: out?.truncated || false,
    isError: Boolean(block.is_error),
  };
}
