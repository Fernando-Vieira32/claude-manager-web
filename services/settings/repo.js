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
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return {};                                     // nunca foi salva: normal
  }
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    // Cair no padrão em silêncio esconde perda de dado: avise em quem tem terminal.
    console.warn(`[settings] ${file} está ilegível; assumindo config vazia`);
    return {};
  }
}

/**
 * Grava sem nunca deixar o arquivo pela metade: escreve num `.tmp` e renomeia
 * (rename é atômico no mesmo filesystem). Sem isto, dois PUT ao mesmo tempo
 * truncavam e escreviam por cima um do outro — o JSON saía partido e o `read()`
 * devolvia `{}`, como se a configuração tivesse sido apagada.
 */
async function writeAtomic(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

// Uma fila por arquivo. Escrita atômica sozinha não basta: PATCH é ler-mesclar-
// gravar, e duas chamadas concorrentes leriam a mesma base e uma perderia a
// chave da outra. Serializar por caminho mantém a mesclagem correta.
const queues = new Map();

function enqueue(file, task) {
  const run = (queues.get(file) || Promise.resolve()).then(task, task);
  const guard = run.catch(() => {});
  queues.set(file, guard);
  guard.then(() => { if (queues.get(file) === guard) queues.delete(file); });
  return run;
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
  return enqueue(file, async () => {
    const merged = { ...(await read(file)), ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') delete merged[k];
    }

    const body = JSON.stringify(merged, null, 2);
    if (Buffer.byteLength(body) > MAX_BYTES) throw badRequest('configuração grande demais');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, body);
    return merged;
  });
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
  // na mesma fila do merge: apagar durante um ler-mesclar-gravar ressuscitaria o arquivo
  const settings = await enqueue(file, async () => {
    const existing = await read(file);
    await fs.rm(file, { force: true });
    return existing;
  });
  return { id, settings };
}
