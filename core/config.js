import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = os.homedir();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Onde ficam as preferências gravadas. Redirecionável pelo mesmo motivo que
// CLAUDE_CONFIG_DIR: o teste aponta para uma pasta temporária e não encosta na sua.
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 7788),
  home,
  rootDir,
  claudeDir,
  projectsDir: path.join(claudeDir, 'projects'),
  trashDir: path.join(claudeDir, '.trash-conversas'),
  dataDir,
  // preferências por conversa (modo, cor…) — ficam DENTRO do projeto e não versionam
  settingsDir: path.join(dataDir, 'conversas'),
  // preferências do app inteiro (retenção da lixeira…) — mesmo par chave/valor, um arquivo só
  globalSettingsFile: path.join(dataDir, 'settings.json'),
  // catálogo de modelos vindo da API (janela de contexto real), em cache no disco
  modelsCacheFile: path.join(dataDir, 'models.json'),
  // credencial do CLI: é dela que sai o token para consultar a API de modelos
  claudeCredentialsFile: path.join(claudeDir, '.credentials.json'),
  publicDir: path.join(rootDir, 'public'),
  servicesDir: path.join(rootDir, 'services'),
  // corpo de requisição: grande o bastante para imagens coladas (base64) no chat
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES) || 30 * 1024 * 1024,
};
