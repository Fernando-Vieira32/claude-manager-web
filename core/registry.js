// Descobre serviços em services/*/service.js e monta as rotas no router.
// Adicionar um serviço novo = criar uma pasta. Nada aqui precisa mudar.

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';

const services = [];

export async function loadServices(router) {
  let entries = [];
  try {
    entries = await fs.readdir(config.servicesDir, { withFileTypes: true });
  } catch {
    return services;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(config.servicesDir, entry.name, 'service.js');
    try {
      await fs.access(file);
    } catch {
      continue;
    }

    const mod = await import(pathToFileURL(file).href);
    const svc = mod.default;
    if (!svc?.id || !Array.isArray(svc.routes)) {
      console.warn(`[registry] ${entry.name}/service.js ignorado: manifesto inválido`);
      continue;
    }

    const basePath = svc.basePath || `/api/${svc.id}`;
    for (const route of svc.routes) {
      const full = (basePath + (route.path === '/' ? '' : route.path)) || '/';
      router.add(route.method, full, route.handler, {
        service: svc.id,
        summary: route.summary || '',
      });
    }

    services.push({
      id: svc.id,
      title: svc.title || svc.id,
      description: svc.description || '',
      basePath,
      routes: svc.routes.map((r) => ({
        method: r.method.toUpperCase(),
        path: basePath + (r.path === '/' ? '' : r.path),
        summary: r.summary || '',
      })),
    });
    console.log(`[registry] serviço "${svc.id}" em ${basePath} (${svc.routes.length} rotas)`);
  }

  return services;
}

export function listServices() {
  return services;
}
