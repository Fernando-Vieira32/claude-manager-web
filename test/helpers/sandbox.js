// Sandbox dos testes: uma pasta temporária que finge ser o ~/.claude e o data/.
//
// O `core/config.js` resolve os caminhos UMA vez, no import. Por isso o env tem
// que ser trocado ANTES de importar qualquer módulo do projeto — e é por isso que
// os testes importam o que vão testar dentro de `before()`, com `await import()`,
// nunca com `import` estático no topo.
//
// O `node --test` roda cada arquivo de teste num processo próprio, então um
// sandbox por arquivo não atrapalha os outros.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Cria as pastas falsas e aponta o env para elas.
 * @returns {Promise<{root,claudeDir,dataDir,projectsDir,trashDir,cleanup}>}
 */
export async function createSandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cmw-test-'));
  const claudeDir = path.join(root, 'claude');
  const dataDir = path.join(root, 'data');

  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  process.env.DATA_DIR = dataDir;

  const box = {
    root,
    claudeDir,
    dataDir,
    projectsDir: path.join(claudeDir, 'projects'),
    trashDir: path.join(claudeDir, '.trash-conversas'),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
  await fs.mkdir(box.projectsDir, { recursive: true });
  return box;
}

/** AAAAMMDD-HHMMSS em hora local — o mesmo formato que o serviço grava. */
export function stampFor(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
    + `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Uma data deslocada do agora, para montar item "com N dias/meses de lixeira". */
export function ago({ days = 0, months = 0, years = 0 } = {}) {
  const d = new Date();
  if (years) d.setFullYear(d.getFullYear() - years);
  if (months) d.setMonth(d.getMonth() - months);
  if (days) d.setDate(d.getDate() - days);
  return d;
}

const SESSION = '00000000-0000-0000-0000-0000000000';
let seq = 0;

/** id de sessão válido e diferente a cada chamada. */
export const nextSessionId = () => `${SESSION}${String(++seq).padStart(2, '0')}`;

/**
 * Põe um arquivo direto na lixeira, com a data de deleção embutida no nome
 * (é do nome que o serviço tira o `deletedAt`).
 */
export async function givenTrashed(box, { at = new Date(), projectDir = '-tmp-teste', bytes = 10 } = {}) {
  await fs.mkdir(box.trashDir, { recursive: true });
  const name = `${stampFor(at)}_${projectDir}_${nextSessionId()}.jsonl`;
  await fs.writeFile(path.join(box.trashDir, name), 'x'.repeat(bytes));
  return name;
}

/** Cria uma conversa viva em projects/ e devolve o id que a API usa. */
export async function givenConversation(box, { projectDir = '-tmp-teste', lines = ['{"cwd":"/tmp/teste"}'] } = {}) {
  const sessionId = nextSessionId();
  const dir = path.join(box.projectsDir, projectDir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  await fs.writeFile(file, `${lines.join('\n')}\n`);
  return { id: `${projectDir}:${sessionId}`, projectDir, sessionId, file };
}

/** Nomes dos arquivos hoje na lixeira (ordem alfabética, para asserção estável). */
export async function trashNames(box) {
  const files = await fs.readdir(box.trashDir).catch(() => []);
  return files.filter((f) => f.endsWith('.jsonl')).sort();
}
