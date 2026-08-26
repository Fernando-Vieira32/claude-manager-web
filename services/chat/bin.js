// Onde está o binário `claude` — e o PATH que o filho recebe.
//
// Mora fora do repo.js porque é a única parte do serviço que depende do ambiente
// da máquina, e agora tem dois consumidores (o processo vivo do `runner.js` e a
// execução única do `oneshot.js`).

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolvido uma vez no boot para não depender do PATH de quem subiu o servidor.
 * Se ele for iniciado por um atalho/serviço com PATH mínimo (sem
 * `~/.npm-global/bin`), um `spawn('claude')` cru daria `ENOENT` e todo o
 * chat/compact quebraria. Ordem: `CLAUDE_BIN` explícito → PATH → locais de
 * instalação conhecidos → o nome cru (deixa o SO falhar com erro claro).
 */
function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const home = os.homedir();
  const candidates = [
    ...(process.env.PATH || '').split(path.delimiter).map((d) => d && path.join(d, 'claude')),
    path.join(home, '.npm-global/bin/claude'),
    path.join(home, '.local/bin/claude'),
    path.join(home, '.claude/local/claude'),
    '/usr/local/bin/claude',
  ];
  return candidates.find((c) => c && existsSync(c)) || 'claude';
}

export const CLAUDE_BIN = resolveClaudeBin();

/**
 * Como esta conversa fica marcada no transcript. Existe porque o `/resume` do terminal
 * **esconde** da lista as sessões cujo `entrypoint` é de SDK (`sdk-cli`, `sdk-ts`,
 * `sdk-py`) — e é a flag `-p` que faz o CLI se marcar como `sdk-cli`. Resultado: toda
 * conversa criada aqui existia no disco, continuava pelo id, e **não aparecia** no
 * `/resume`. Com um valor fora desse conjunto ela aparece como qualquer outra.
 *
 * `'cli'` NÃO serve: o próprio CLI reescreve para `sdk-cli` quando está em modo SDK.
 * Daí o nome do app — que ainda tem a vantagem de dizer de onde a conversa veio.
 * Para voltar ao comportamento antigo, é só apagar esta chave.
 */
const ENTRYPOINT = process.env.CHAT_ENTRYPOINT || 'claude-manager-web';

/**
 * Ambiente do filho com o diretório do binário no PATH — o CLI e o que ele mesmo
 * dispara também procuram no PATH.
 */
export function childEnv() {
  const binDir = path.isAbsolute(CLAUDE_BIN) ? path.dirname(CLAUDE_BIN) : null;
  const base = { ...process.env, CLAUDE_CODE_ENTRYPOINT: ENTRYPOINT };
  if (!binDir) return base;
  return { ...base, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` };
}
