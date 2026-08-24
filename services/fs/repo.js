// Navegação de pastas do lado do servidor. O app roda na máquina do usuário, então
// "escolher uma pasta" é navegar o disco real — base para o painel Nova conversa
// hoje e para o "abrir pasta" do editor amanhã. Só lista diretórios (nunca lê
// conteúdo de arquivo) e nunca escreve nada.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { badRequest } from '../../core/http.js';

/**
 * Subpastas de `target` (ou do HOME, se vazio), em ordem alfabética.
 * @returns {Promise<{path, parent, home, entries: Array<{name, path}>}>}
 */
export async function listDirs(target) {
  const dir = target ? path.resolve(String(target)) : os.homedir();

  let stat;
  try {
    stat = await fs.stat(dir);
  } catch {
    throw badRequest(`pasta não encontrada: ${dir}`);
  }
  if (!stat.isDirectory()) throw badRequest(`não é uma pasta: ${dir}`);

  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    throw badRequest(`sem permissão de leitura em: ${dir}`);
  }

  const entries = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => ({ name: d.name, path: path.join(dir, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? null : parent, // raiz não tem "acima"
    home: os.homedir(),
    entries,
  };
}
