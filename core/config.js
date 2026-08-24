import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = os.homedir();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 7788),
  home,
  rootDir,
  claudeDir,
  projectsDir: path.join(claudeDir, 'projects'),
  trashDir: path.join(claudeDir, '.trash-conversas'),
  // preferências por conversa (modo, cor…) — ficam DENTRO do projeto e não versionam
  settingsDir: path.join(rootDir, 'data', 'conversas'),
  // preferências do app inteiro (retenção da lixeira…) — mesmo par chave/valor, um arquivo só
  globalSettingsFile: path.join(rootDir, 'data', 'settings.json'),
  publicDir: path.join(rootDir, 'public'),
  servicesDir: path.join(rootDir, 'services'),
  // corpo de requisição: grande o bastante para imagens coladas (base64) no chat
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES) || 30 * 1024 * 1024,
};
