#!/usr/bin/env node
// Claude Manager Web - bootstrap.
// Só orquestra: config -> router -> serviços -> estáticos. Nenhuma regra de negócio aqui.

import http from 'node:http';
import path from 'node:path';
import { config } from './core/config.js';
import { createRouter } from './core/router.js';
import { loadServices, listServices } from './core/registry.js';
import { serveStatic } from './core/static.js';
import { ApiError, sendJson, readJsonBody } from './core/http.js';

// Um jeito só de rodar: em container. Fora dele o ambiente é loteria (versão do Node,
// CLI do Claude, PATH do atalho) e a doc teria de descrever dois caminhos.
if (!config.inContainer) {
  console.error('\n  Este app roda em container.\n');
  console.error('  Para usar:        ./docker-app.sh');
  console.error('  Para desenvolver: ./docker-app.sh dev');
  console.error('  Por quê e como:   readme/14-docker.md\n');
  process.exit(1);
}

const router = createRouter();

// rota de metadados: o front descobre por aqui quais serviços existem
router.add('GET', '/api/_services', () => ({
  app: 'claude-manager-web',
  version: '0.1.0',
  root: path.dirname(process.argv[1]), // raiz dentro do container (/app)
  hostRoot: config.hostRoot,           // raiz na máquina — o front monta o comando de ligar
  services: listServices(),
  routes: router.list(),
}));

router.add('GET', '/api/_health', () => ({ ok: true, uptime: Math.round(process.uptime()) }));

// Controle do próprio processo — meta (como _health), usado pelo indicador de status.
// Desligar: responde e sai. A página não consegue religar um servidor morto (o
// navegador não abre programas do PC) — por isso a UI mostra o comando de iniciar.
router.add('POST', '/api/_server/stop', ({ res }) => {
  sendJson(res, 200, { ok: true, stopping: true });
  setTimeout(() => process.exit(0), 200);
});

// Reiniciar: sai com código de FALHA e deixa o supervisor do container subir de novo
// (o compose usa `restart: on-failure`). Antes daqui subíamos um processo destacado —
// dentro do container isso não serve: quando o PID 1 morre, o filho morre com ele.
router.add('POST', '/api/_server/restart', ({ res }) => {
  sendJson(res, 200, { ok: true, restarting: true });
  setTimeout(() => process.exit(1), 200);
});

await loadServices(router);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    const served = await serveStatic(req, res, url.pathname);
    if (!served) sendJson(res, 404, { error: 'arquivo não encontrado' });
    return;
  }

  const hit = router.match(req.method, url.pathname);
  if (!hit) return sendJson(res, 404, { error: `rota ${req.method} ${url.pathname} não existe` });
  if (hit.methodNotAllowed) {
    res.setHeader('allow', hit.methodNotAllowed.join(', '));
    return sendJson(res, 405, { error: 'método não permitido', allow: hit.methodNotAllowed });
  }

  try {
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
      ? await readJsonBody(req, config.maxBodyBytes)
      : {};
    const result = await hit.route.handler({
      params: hit.params,
      query: Object.fromEntries(url.searchParams),
      body,
      req,
      res,
    });
    if (res.headersSent) return;
    sendJson(res, result?.status || 200, result?.data !== undefined ? result.data : result);
  } catch (err) {
    if (err instanceof ApiError) {
      return sendJson(res, err.status, { error: err.message, details: err.details });
    }
    console.error('[erro]', err);
    sendJson(res, 500, { error: 'erro interno', details: String(err?.message || err) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`\n  Claude Manager Web`);
  console.log(`  → http://${config.host}:${config.port}`);
  console.log(`  dados: ${config.claudeDir}\n`);
});
