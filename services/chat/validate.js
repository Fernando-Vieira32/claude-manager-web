// O que entra pelo navegador antes de chegar perto de um processo: texto, imagens e
// pasta. Regra pura, sem spawn e sem estado — por isso mora sozinha aqui.

import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from '../../core/http.js';

const MAX_TEXT = 100_000;
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGES = 6;
const MAX_IMG_BYTES = 8 * 1024 * 1024; // por imagem, já em base64 decodificado (~aprox)

export function validMessage(text, imageCount = 0) {
  const message = String(text || '').trim();
  if (!message && !imageCount) throw badRequest('mensagem vazia');
  if (message.length > MAX_TEXT) throw badRequest('mensagem muito longa');
  return message;
}

/** Valida e normaliza as imagens: [{ media_type, data(base64) }]. */
export function validImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw badRequest('imagens em formato inválido');
  if (images.length > MAX_IMAGES) throw badRequest(`no máximo ${MAX_IMAGES} imagens por mensagem`);
  return images.map((img, i) => {
    const type = String(img?.media_type || '');
    const data = String(img?.data || '');
    if (!IMG_TYPES.includes(type)) throw badRequest(`imagem ${i + 1}: tipo não suportado (${type || 'vazio'})`);
    if (!data) throw badRequest(`imagem ${i + 1}: sem dados`);
    if (data.length * 0.75 > MAX_IMG_BYTES) throw badRequest(`imagem ${i + 1}: muito grande`);
    return { media_type: type, data };
  });
}

/** Pasta onde uma conversa NOVA vai rodar: absoluta e existente. */
export async function validDir(cwd) {
  const dir = String(cwd || '').trim();
  if (!path.isAbsolute(dir)) throw badRequest('a pasta precisa ser um caminho absoluto');
  let stat;
  try { stat = await fs.stat(dir); } catch { throw badRequest(`a pasta não existe: ${dir}`); }
  if (!stat.isDirectory()) throw badRequest(`não é uma pasta: ${dir}`);
  return dir;
}
