// Router minúsculo com padrões tipo '/api/sessions/:pid/kill'.

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

export function createRouter() {
  const routes = [];

  return {
    add(method, pattern, handler, meta = {}) {
      const { regex, keys } = compile(pattern);
      routes.push({ method: method.toUpperCase(), pattern, regex, keys, handler, meta });
    },
    match(method, pathname) {
      const allowed = new Set();
      for (const route of routes) {
        const m = route.regex.exec(pathname);
        if (!m) continue;
        if (route.method !== method.toUpperCase()) {
          allowed.add(route.method);
          continue;
        }
        const params = {};
        route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { route, params };
      }
      return allowed.size ? { methodNotAllowed: [...allowed] } : null;
    },
    list() {
      return routes.map((r) => ({ method: r.method, path: r.pattern, ...r.meta }));
    },
  };
}
