// Catálogo de modelos: busca `GET /v1/models` da API da Anthropic e guarda em
// data/models.json. É de lá que sai a JANELA DE CONTEXTO real (`max_input_tokens`)
// — antes ela era adivinhada pelo nome do modelo e errava em toda conversa de 1M.
//
// É o ÚNICO lugar do app que faz chamada de rede externa. O que sai daqui é uma
// requisição de metadados autenticada; nenhuma conversa, nenhum arquivo seu.
// O caminho de leitura (listar conversas) nunca chama a rede: só lê o cache.

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../core/config.js';
import { modelFromApi, readCatalogCache } from '../../core/claude-models.js';
import { badRequest, conflict } from '../../core/http.js';

const API = 'https://api.anthropic.com/v1/models?limit=100';
const TTL_MS = 24 * 60 * 60 * 1000;   // o catálogo muda em lançamento, não por hora
const TIMEOUT_MS = 15_000;

let memoria = null;   // { fetchedAt, models } — evita reler o disco a cada conversa

/**
 * Token para a API. Ordem: variável de ambiente (quem tem chave própria) →
 * credencial do CLI `claude` já logado nesta máquina. Devolve o cabeçalho pronto
 * para não vazar o segredo em log nem em mensagem de erro.
 */
async function authHeaders() {
  if (process.env.ANTHROPIC_API_KEY) {
    return { 'x-api-key': process.env.ANTHROPIC_API_KEY };
  }
  let bruto;
  try {
    bruto = JSON.parse(await fs.readFile(config.claudeCredentialsFile, 'utf8'));
  } catch {
    throw conflict(
      'sem credencial para consultar a API de modelos: rode `claude login` ou '
      + 'exporte ANTHROPIC_API_KEY antes de subir o servidor',
    );
  }
  const token = bruto?.claudeAiOauth?.accessToken || bruto?.accessToken;
  if (!token) throw conflict('a credencial do claude não tem token de acesso utilizável');
  // token OAuth vai em Authorization + o beta de oauth; chave de API iria em x-api-key
  return { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' };
}

/** Busca o catálogo na API. Lança `ApiError` com motivo legível. */
async function fetchCatalog() {
  const headers = { ...(await authHeaders()), 'anthropic-version': '2023-06-01' };
  const sinal = AbortSignal.timeout(TIMEOUT_MS);

  let res;
  try {
    res = await fetch(API, { headers, signal: sinal });
  } catch (err) {
    throw conflict(`não consegui falar com a API de modelos: ${err.message}`);
  }
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw conflict(`a API de modelos respondeu ${res.status}${corpo ? `: ${corpo.slice(0, 200)}` : ''}`);
  }

  const json = await res.json().catch(() => null);
  const lista = Array.isArray(json?.data) ? json.data : null;
  if (!lista) throw conflict('resposta inesperada da API de modelos (sem `data`)');
  return lista.map(modelFromApi).filter((m) => m.id);
}

/** Grava o cache sem deixar arquivo pela metade (mesmo cuidado do settings). */
async function write(dados) {
  const tmp = `${config.modelsCacheFile}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(config.modelsCacheFile), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(dados, null, 2), 'utf8');
  await fs.rename(tmp, config.modelsCacheFile);
}

/** Cache do disco (ou null). Quem lê é o core — um leitor só para todo mundo. */
async function read() {
  const dados = await readCatalogCache();
  return dados.models.length ? dados : null;
}

const vencido = (dados) => !dados?.fetchedAt || Date.now() - Date.parse(dados.fetchedAt) > TTL_MS;

/**
 * Catálogo em memória para quem só quer LER (ex.: a lista de conversas, que
 * precisa da janela de cada modelo). Nunca chama a rede — se não há cache,
 * devolve lista vazia e quem chama cai no palpite antigo.
 */
export async function cachedModels() {
  if (!memoria) memoria = (await read()) || { fetchedAt: null, models: [] };
  return memoria.models;
}

/** Força a busca na API e regrava o cache. */
export async function refreshModels() {
  const models = await fetchCatalog();
  memoria = { fetchedAt: new Date().toISOString(), models, source: 'api' };
  await write(memoria);
  return memoria;
}

/**
 * O catálogo para a interface. Busca da API quando não há cache ou ele venceu;
 * se a busca falhar mas houver cache, devolve o cache com o aviso do erro — dado
 * velho e sinalizado é melhor que tela vazia.
 */
export async function listModels({ refresh = false } = {}) {
  const disco = memoria || (await read());
  if (!refresh && disco && !vencido(disco)) {
    memoria = disco;
    return { ...disco, stale: false };
  }
  try {
    return { ...(await refreshModels()), stale: false };
  } catch (err) {
    if (disco) {
      memoria = disco;
      return { ...disco, stale: true, error: err.message };
    }
    throw err;
  }
}

/** Uma janela de contexto por id, para quem quer conferir na mão. */
export async function modelById(id) {
  if (!id) throw badRequest('informe o id do modelo');
  const { models } = await listModels();
  const achado = models.find((m) => m.id === id);
  if (!achado) throw badRequest(`modelo desconhecido: ${id}`);
  return achado;
}
