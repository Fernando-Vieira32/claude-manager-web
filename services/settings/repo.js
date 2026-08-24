// Preferências por conversa (chave/valor), gravadas em arquivo — sobrevivem a
// fechar/reabrir a janela. Uma conversa = um arquivo, ligado pelo id da conversa
// ('<pastaDoProjeto>:<sessionId>'), que é único. Só chave/valor simples; este
// serviço NÃO interpreta o significado das chaves (isso é da interface).

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../core/config.js';
import { resolveConversationId } from '../../core/claude-paths.js';
import { badRequest } from '../../core/http.js';

const KEY_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const MAX_BYTES = 16 * 1024;   // teto generoso: configuração não é banco de dados

/** id da conversa -> caminho do arquivo de config, garantindo que não escapa da pasta. */
function fileFor(id) {
  resolveConversationId(id);                       // valida o formato do id (lança se inválido)
  const safe = String(id).replace(/[^A-Za-z0-9._-]+/g, '_'); // ':' vira '_'
  const file = path.resolve(config.settingsDir, `${safe}.json`);
  if (!file.startsWith(config.settingsDir + path.sep)) throw badRequest('caminho de configuração inválido');
  return file;
}

/** Lê o objeto de config do disco; ausência/erro = sem config (objeto vazio). */
async function read(file) {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Config atual da conversa (objeto vazio se nunca foi salva). */
export async function getSettings(id) {
  return { id, settings: await read(fileFor(id)) };
}

/**
 * Caminho de volta: nome do arquivo -> id da conversa. Na gravação o ':' virou
 * '_' (ver `fileFor`), e o sessionId nunca tem '_', então o ÚLTIMO '_' é sempre o
 * separador. Valida pelo `resolveConversationId` para não inventar id a partir de
 * arquivo estranho na pasta.
 */
function idFromFile(name) {
  const base = name.replace(/\.json$/, '');
  const cut = base.lastIndexOf('_');
  if (cut < 1) return null;
  const id = `${base.slice(0, cut)}:${base.slice(cut + 1)}`;
  try {
    resolveConversationId(id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Todas as configs de uma vez. Existe porque uma LISTA precisa saber a cor de
 * dezenas de conversas ao desenhar: uma requisição por conversa seria absurdo.
 * Devolve só quem tem alguma chave gravada.
 */
export async function listAllSettings() {
  let files = [];
  try {
    files = await fs.readdir(config.settingsDir);
  } catch {
    return [];                                   // pasta nem existe: ninguém configurou nada
  }

  const items = [];
  for (const name of files.filter((f) => f.endsWith('.json'))) {
    const id = idFromFile(name);
    if (!id) continue;
    const settings = await read(path.join(config.settingsDir, name));
    if (Object.keys(settings).length) items.push({ id, settings });
  }
  return items;
}

/**
 * Mescla `patch` na config existente e grava (semântica PATCH: manda só o que mudou).
 * Valores só podem ser texto/número/booleano; chaves curtas e alfanuméricas.
 * Uma chave com valor `''` ou `null` é REMOVIDA — é assim que se "volta ao padrão".
 */
export async function saveSettings(id, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw badRequest('configuração deve ser um objeto chave/valor');
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!KEY_RE.test(k)) throw badRequest(`chave inválida: ${k}`);
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
      throw badRequest(`valor inválido para "${k}" (só texto, número ou booleano)`);
    }
  }

  const file = fileFor(id);
  const merged = { ...(await read(file)), ...patch };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete merged[k];
  }

  const body = JSON.stringify(merged, null, 2);
  if (Buffer.byteLength(body) > MAX_BYTES) throw badRequest('configuração grande demais');
  await fs.mkdir(config.settingsDir, { recursive: true });
  await fs.writeFile(file, body, 'utf8');
  return { id, settings: merged };
}

/**
 * Apaga a config da conversa (chamado quando a conversa vai para a lixeira, para não
 * acumular arquivo órfão). Devolve o que existia — assim o "Desfazer" da interface
 * consegue regravar ao restaurar. Não erra se não havia config.
 */
export async function deleteSettings(id) {
  const file = fileFor(id);
  const settings = await read(file);
  await fs.rm(file, { force: true });
  return { id, settings };
}
