// Única camada que fala HTTP. Painéis nunca usam fetch direto.

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * POST + consumo de Server-Sent Events. Cada `data: {json}` vira `onEvent(obj)`.
 * Compartilhado por chat.send e chat.compact (mesmo protocolo de eventos).
 */
async function streamSse(path, body, onEvent, signal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data.details);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;      // ':' = comentário/keep-alive
        try {
          onEvent(JSON.parse(line.slice(6)));
        } catch { /* linha parcial: ignora */ }
      }
    }
  }
}

async function request(path, { method = 'GET', body, query } = {}) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data.details);
  return data;
}

export const api = {
  get: (p, query) => request(p, { query }),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),

  // atalhos de domínio (um por serviço — espelham o backend)
  sessions: {
    list: (q) => api.get('/api/sessions', { q }),
    kill: (pid, signal) => api.post(`/api/sessions/${pid}/kill`, { signal }),
  },
  conversations: {
    list: (q) => api.get('/api/conversations', { q }),
    read: (id, { limit = 20, before } = {}) =>
      api.get(`/api/conversations/${encodeURIComponent(id)}`, { limit, before }),

    /**
     * Os passos de um subagente — o que ele fez, em blocos. O trabalho dele não está no
     * arquivo da conversa: mora num transcrito próprio (ver readme/10-chat.md).
     */
    agentSteps: (id, ref, { limit } = {}) =>
      api.get(`/api/conversations/${encodeURIComponent(id)}/agents/${encodeURIComponent(ref)}`, { limit }),
    remove: (id) => api.del(`/api/conversations/${encodeURIComponent(id)}`),
    rename: (id, name) => api.post(`/api/conversations/${encodeURIComponent(id)}/rename`, { name }),
    trash: () => api.get('/api/conversations/trash'),
    restore: (name) => api.post('/api/conversations/trash/restore', { name }),

    /**
     * Apaga da lixeira o que é mais velho que `{ value, unit }` — sem volta.
     * Com `dryRun`, só devolve o que *iria* embora (é o preview da confirmação).
     */
    purgeTrash: ({ value, unit, dryRun = false }) =>
      api.post('/api/conversations/trash/purge', { value, unit, dryRun }),
  },
  chat: {
    status: (id) => api.get(`/api/chat/${encodeURIComponent(id)}/status`),
    stop: (id) => api.post(`/api/chat/${encodeURIComponent(id)}/stop`),
    running: () => api.get('/api/chat'),

    /**
     * Envia uma mensagem e consome a resposta em SSE.
     * `onEvent` recebe cada objeto { type, ... } emitido pelo serviço.
     */
    send: (id, { text, mode = 'none', model, images } = {}, onEvent, signal) =>
      streamSse(`/api/chat/${encodeURIComponent(id)}`, { text, mode, model, images }, onEvent, signal),

    /** Inicia uma conversa nova numa pasta. Mesmo protocolo de eventos do send. */
    start: ({ cwd, text, mode = 'none', model, images } = {}, onEvent, signal) =>
      streamSse('/api/chat', { cwd, text, mode, model, images }, onEvent, signal),

    /** Compacta o contexto (/compact). Mesmo formato de eventos do send. */
    compact: (id, { model } = {}, onEvent, signal) =>
      streamSse(`/api/chat/${encodeURIComponent(id)}/compact`, { model }, onEvent, signal),

    /**
     * Fica ouvindo TUDO o que acontece nesta conversa, inclusive o que o Claude faz
     * **sem** você pedir (um agente em segundo plano termina e ele retoma sozinho).
     * É um canal longo, aberto enquanto a janela existir — daí usar `EventSource`,
     * que reconecta sozinho se a conexão cair. Devolve `{ close() }`.
     */
    events(id, onEvent) {
      const src = new EventSource(`/api/chat/${encodeURIComponent(id)}/events`);
      src.onmessage = (e) => {
        try {
          onEvent(JSON.parse(e.data));
        } catch { /* linha parcial: ignora */ }
      };
      // erro aqui é normal (servidor reiniciou, rede piscou): o EventSource tenta de
      // novo por conta própria, e cada reconexão traz um `hello` novo
      return { close: () => src.close() };
    },
  },

  fs: {
    /** Subpastas de um caminho (vazio = HOME do servidor). */
    browse: (path) => api.get('/api/fs', { path }),
  },

  // preferências chave/valor gravadas em arquivo pelo servidor: globais e por conversa
  settings: {
    /** Config global do app: `{ settings }` (vazio se nunca salva). */
    getGlobal: () => api.get('/api/settings'),
    /** Mescla e grava a config global (PATCH: só o que mudou; '' remove a chave). */
    saveGlobal: (patch) => api.put('/api/settings', patch),

    /** Config atual da conversa: `{ id, settings }` (settings vazio se nunca salva). */
    get: (id) => api.get(`/api/settings/${encodeURIComponent(id)}`),
    /**
     * Config de TODAS as conversas numa requisição: `{ items: [{ id, settings }] }`.
     * É o que deixa uma lista pintar cada linha sem uma chamada por conversa.
     */
    all: () => api.get('/api/settings/all'),
    /** Mescla e grava (PATCH: só o que mudou; valor '' remove a chave). */
    save: (id, patch) => api.put(`/api/settings/${encodeURIComponent(id)}`, patch),
    /** Apaga a config da conversa; devolve `{ id, settings }` (o que existia). */
    remove: (id) => api.del(`/api/settings/${encodeURIComponent(id)}`),
  },

  // catálogo de modelos: é dele que sai a janela de contexto real
  models: {
    /** `{ fetchedAt, models, stale }` — busca da API se o cache venceu. */
    list: () => api.get('/api/models'),
    /** Força a busca na API e regrava o cache. */
    refresh: () => api.post('/api/models/refresh'),
  },

  meta: {
    services: () => api.get('/api/_services'),
    health: () => api.get('/api/_health'),
  },

  server: {
    stop: () => api.post('/api/_server/stop'),
    restart: () => api.post('/api/_server/restart'),
  },
};
