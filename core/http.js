// Helpers de HTTP e erros de API. Nenhum serviço fala com `res` diretamente:
// eles apenas retornam dados ou lançam ApiError.

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, d) => new ApiError(400, msg, d);
export const notFound = (msg = 'não encontrado') => new ApiError(404, msg);
export const conflict = (msg, d) => new ApiError(409, msg, d);

export function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export async function readJsonBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw badRequest('corpo da requisição muito grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('JSON inválido');
  }
}

/**
 * Abre um stream SSE. Cada `send(obj)` vira uma linha `data: {json}`.
 * Handlers que usam isto devolvem uma Promise que resolve quando o stream fecha —
 * o server.js percebe que os headers já foram enviados e não serializa nada.
 */
export function openSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': stream aberto\n\n');
  let closed = false;
  return {
    send(obj) {
      if (closed) return;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      res.end();
    },
    get closed() { return closed; },
  };
}
