// As linhas que ESCREVEMOS no stdin do CLI (`--input-format stream-json`).
//
// Mora fora do runner.js porque é formato de protocolo, não gerência de processo — e
// porque o runner já cuida de fila, turno corrente, ociosidade e tempo limite.

/** Uma mensagem do usuário como o CLI espera: texto e imagens no mesmo `content`. */
export function userLine(text, images = []) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const img of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
  }
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null })}\n`;
}

/** O "Parar": corta o turno em voo sem matar o processo (`seq` só precisa ser único). */
export const interruptLine = (seq) => `${JSON.stringify({
  type: 'control_request', request_id: `req_${seq}`, request: { subtype: 'interrupt' },
})}\n`;
