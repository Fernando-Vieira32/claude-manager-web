// Preferências chave/valor gravadas em arquivo, em dois escopos com a MESMA regra:
//   • por conversa — um arquivo por conversa em data/conversas/, ligado pelo id
//     ('<pastaDoProjeto>:<sessionId>'), que é único;
//   • global — um único data/settings.json, para preferência do app inteiro
//     (ex.: a retenção da lixeira).
// Só chave/valor simples; este serviço NÃO interpreta o significado das chaves
// (isso é da interface) — por isso serve para qualquer preferência futura.

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

/** Recusa o que não é par chave/valor simples, antes de encostar no disco. */
function validate(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw badRequest('configuração deve ser um objeto chave/valor');
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!KEY_RE.test(k)) throw badRequest(`chave inválida: ${k}`);
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
      throw badRequest(`valor inválido para "${k}" (só texto, número ou booleano)`);
    }
  }
}

/**
 * Mescla `patch` no arquivo e grava (semântica PATCH: manda só o que mudou).
 * Uma chave com valor `''` ou `null` é REMOVIDA — é assim que se "volta ao padrão".
 * Vale para os dois escopos: só muda o arquivo de destino.
 */
async function merge(file, patch) {
  validate(patch);
  const merged = { ...(await read(file)), ...patch };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete merged[k];
  }

  const body = JSON.stringify(merged, null, 2);
  if (Buffer.byteLength(body) > MAX_BYTES) throw badRequest('configuração grande demais');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, 'utf8');
  return merged;
}

/** Grava a config de uma conversa. */
export async function saveSettings(id, patch) {
  return { id, settings: await merge(fileFor(id), patch) };
}

/** Config global do app (objeto vazio se nunca foi salva). */
export async function getGlobalSettings() {
  return { settings: await read(config.globalSettingsFile) };
}

/** Grava a config global — mesma semântica PATCH da config por conversa. */
export async function saveGlobalSettings(patch) {
  return { settings: await merge(config.globalSettingsFile, patch) };
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
