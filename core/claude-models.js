// O que se sabe sobre os MODELOS: como casar o id que aparece num transcript com
// a entrada do catálogo da API (de onde sai a janela de contexto de verdade), e
// como LER o catálogo em cache.
//
// Divisão de trabalho: aqui só resolução e leitura do cache — nunca rede, nunca
// escrita. Quem busca na API e grava é o serviço `models`. Vive no core porque
// dois serviços precisam ler isto e serviço não importa serviço (readme/02).
//
// Por que existe: a janela era ADIVINHADA pelo nome ("tem [1m]? então 1M"), e
// `claude-opus-5` não tem sufixo — a interface mostrava 200k numa conversa de 1M.

import fs from 'node:fs/promises';
import { config } from './config.js';

/** Aliases que o CLI grava no transcript quando você não fixa a versão. */
const FAMILIAS = ['opus', 'sonnet', 'haiku', 'fable', 'mythos'];

/**
 * Id cru do transcript -> id consultável. A API responde 404 para alias (`opus`)
 * e para variante com sufixo (`claude-opus-5[1m]`), então normalizamos aqui.
 * @returns {{id:string,familia:string|null}|null} null quando não é modelo
 */
export function normalizeModelId(raw) {
  const cru = String(raw || '').trim();
  // `<synthetic>` é o turno que a CLI grava depois de um /compact: não é modelo
  if (!cru || cru.startsWith('<')) return null;

  // `claude-opus-5[1m]` e `claude-opus-4-8-fast` são identificadores de
  // implantação, não ids públicos — o modelo por baixo é o mesmo.
  const id = cru.replace(/\[[^\]]*\]/g, '').replace(/-fast$/i, '').trim();
  if (!id) return null;

  const familia = FAMILIAS.includes(id.toLowerCase()) ? id.toLowerCase() : null;
  return { id, familia };
}

/**
 * Acha a entrada do catálogo para um id de transcript.
 * Alias resolve para o modelo mais NOVO daquela família — é o que o alias
 * significa ("a última versão"), e é o que o CLI usou quando gravou o alias.
 * @param {Array<{id:string,createdAt?:string}>} catalogo
 */
export function resolveModel(catalogo, raw) {
  const alvo = normalizeModelId(raw);
  if (!alvo || !Array.isArray(catalogo) || !catalogo.length) return null;

  const exato = catalogo.find((m) => m.id === alvo.id);
  if (exato) return exato;
  if (!alvo.familia) return null;

  const daFamilia = catalogo
    .filter((m) => m.id.toLowerCase().startsWith(`claude-${alvo.familia}-`))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return daFamilia[0] || null;
}

/**
 * Janela de contexto de um modelo, do catálogo. `null` quando não dá para saber
 * — quem chama decide o que fazer (não inventamos número aqui).
 */
export function contextWindowOf(catalogo, raw) {
  const m = resolveModel(catalogo, raw);
  return Number.isFinite(m?.maxInputTokens) ? m.maxInputTokens : null;
}

// Cache em memória, invalidado por mtime: a lista de conversas resolve a janela
// de dezenas de conversas por requisição e não pode reler o arquivo em cada uma.
let memo = { mtimeMs: -1, dados: null };

/**
 * Catálogo em cache no disco. **Nunca busca na rede** — este é o caminho de
 * leitura. Sem cache (ou ilegível) devolve `{ fetchedAt: null, models: [] }`, e
 * quem chama decide o que fazer com a ausência.
 */
export async function readCatalogCache() {
  let stat;
  try {
    stat = await fs.stat(config.modelsCacheFile);
  } catch {
    return { fetchedAt: null, models: [] };
  }
  if (memo.dados && memo.mtimeMs === stat.mtimeMs) return memo.dados;

  let dados = { fetchedAt: null, models: [] };
  try {
    const lido = JSON.parse(await fs.readFile(config.modelsCacheFile, 'utf8'));
    if (Array.isArray(lido?.models)) dados = lido;
    else console.warn(`[models] ${config.modelsCacheFile} sem lista "models"; ignorando`);
  } catch {
    console.warn(`[models] ${config.modelsCacheFile} está ilegível; ignorando o cache`);
  }
  memo = { mtimeMs: stat.mtimeMs, dados };
  return dados;
}

/** Uma entrada da API -> a forma que guardamos (só o que a interface usa). */
export const modelFromApi = (m) => ({
  id: m.id,
  displayName: m.display_name || m.id,
  createdAt: m.created_at || null,
  maxInputTokens: Number.isFinite(m.max_input_tokens) ? m.max_input_tokens : null,
  maxOutputTokens: Number.isFinite(m.max_tokens) ? m.max_tokens : null,
});
