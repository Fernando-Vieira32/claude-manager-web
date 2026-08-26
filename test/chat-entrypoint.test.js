// O ambiente que o processo `claude` recebe (services/chat/bin.js).
//
// A regra que dói: o `/resume` do terminal ESCONDE da lista as sessões marcadas como
// SDK (`sdk-cli`, `sdk-ts`, `sdk-py`), e é a flag `-p` que faz o CLI se marcar assim.
// Conversa criada pelo navegador existia no disco e não aparecia no `/resume`.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const DE_SDK = new Set(['sdk-cli', 'sdk-ts', 'sdk-py']);

describe('childEnv', () => {
  let bin;

  before(async () => { bin = await import('../services/chat/bin.js'); });

  it('marca a conversa com um entrypoint que o /resume NÃO filtra', () => {
    const { CLAUDE_CODE_ENTRYPOINT } = bin.childEnv();
    assert.ok(CLAUDE_CODE_ENTRYPOINT, 'sem entrypoint o CLI se marcaria como sdk-cli');
    assert.equal(DE_SDK.has(CLAUDE_CODE_ENTRYPOINT), false);
  });

  it('não usa "cli": o CLI reescreve esse valor para sdk-cli em modo SDK', () => {
    assert.notEqual(bin.childEnv().CLAUDE_CODE_ENTRYPOINT, 'cli');
  });

  it('põe o diretório do binário na FRENTE do PATH (atalho .desktop tem PATH mínimo)', () => {
    if (!path.isAbsolute(bin.CLAUDE_BIN)) return;   // sem binário resolvido não há o que prefixar
    const primeiro = String(bin.childEnv().PATH).split(path.delimiter)[0];
    assert.equal(primeiro, path.dirname(bin.CLAUDE_BIN));
  });

  it('preserva o resto do ambiente do servidor', () => {
    const env = bin.childEnv();
    assert.equal(env.HOME, process.env.HOME);
  });
});

describe('childEnv com CHAT_ENTRYPOINT no ambiente', () => {
  let bin;

  before(async () => {
    process.env.CHAT_ENTRYPOINT = 'outro-app';
    // o valor é lido no import, então o módulo tem de ser carregado DEPOIS da troca
    bin = await import(`../services/chat/bin.js?entrypoint=${Date.now()}`);
  });

  it('respeita a escolha de quem sobe o servidor', () => {
    assert.equal(bin.childEnv().CLAUDE_CODE_ENTRYPOINT, 'outro-app');
  });
});
