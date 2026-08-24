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

/**
 * Um `tool_use` -> a forma que a interface consome (o mesmo objeto ao vivo e no
 * histórico, para o front ter um só caminho de render).
 */
export function toolFromUse(block) {
  const input = detailOf(block.input);
  return {
    id: block.id || null,
    name: block.name || 'ferramenta',
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
