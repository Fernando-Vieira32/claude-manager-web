// Os modos de permissão (services/chat/args.js) — o que cada um passa para o CLI.
//
// Existe por uma reclamação real: "no navegador dá erro de permissão, no terminal a
// mesma coisa funciona". A causa nunca pode ser bloqueio NOSSO, e é isso que o último
// teste tranca: fora do "só conversa", nenhum modo tira ferramenta do Claude.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MODE_POLICIES, modeArgs } from '../services/chat/args.js';

const GATED = ['auto', 'acceptEdits', 'bypassPermissions'];

describe('modeArgs sem CHAT_ALLOW_FULL_TOOLS', () => {
  let antes;

  before(() => { antes = process.env.CHAT_ALLOW_FULL_TOOLS; delete process.env.CHAT_ALLOW_FULL_TOOLS; });
  after(() => { if (antes !== undefined) process.env.CHAT_ALLOW_FULL_TOOLS = antes; });

  for (const mode of GATED) {
    it(`recusa "${mode}": quem edita/executa exige opt-in no servidor`, () => {
      assert.throws(() => modeArgs(mode), /CHAT_ALLOW_FULL_TOOLS/);
    });
  }

  it('deixa passar os modos que não alteram nada', () => {
    assert.deepEqual(modeArgs('plan'), ['--permission-mode', 'plan']);
    assert.ok(modeArgs('none').includes('--disallowedTools'));
  });
});

describe('modeArgs com CHAT_ALLOW_FULL_TOOLS=1', () => {
  let antes;

  before(() => { antes = process.env.CHAT_ALLOW_FULL_TOOLS; process.env.CHAT_ALLOW_FULL_TOOLS = '1'; });
  after(() => {
    if (antes === undefined) delete process.env.CHAT_ALLOW_FULL_TOOLS;
    else process.env.CHAT_ALLOW_FULL_TOOLS = antes;
  });

  it('automático é o auto mode do terminal', () => {
    assert.deepEqual(modeArgs('auto'), ['--permission-mode', 'auto']);
  });

  it('aceitar edições vira acceptEdits', () => {
    assert.deepEqual(modeArgs('acceptEdits'), ['--permission-mode', 'acceptEdits']);
  });

  // A paridade com o terminal: em `auto` o classificador barra e o terminal PERGUNTA;
  // headless não tem a quem perguntar (medido: o CLI só emite `permission_denied`).
  it('direto vira bypassPermissions — nenhuma checagem, como o terminal em modo perigoso', () => {
    assert.deepEqual(modeArgs('bypassPermissions'), ['--permission-mode', 'bypassPermissions']);
  });

  it('recusa modo desconhecido em vez de rodar com o padrão do CLI', () => {
    assert.throws(() => modeArgs('liberado'), /modo de permissão inválido/);
  });

  // A trava: bloqueio só no "só conversa". Se alguém acrescentar --disallowedTools ou
  // --allowedTools a outro modo, o navegador volta a ser mais restrito que o terminal.
  it('nenhum modo além de "só conversa" corta ferramenta do Claude', () => {
    for (const mode of Object.keys(MODE_POLICIES)) {
      if (mode === 'none') continue;
      const args = modeArgs(mode);
      assert.equal(args.includes('--disallowedTools'), false, `${mode} tirou ferramenta`);
      assert.equal(args.includes('--allowedTools'), false, `${mode} limitou a lista de ferramentas`);
      assert.equal(args.includes('--tools'), false, `${mode} limitou a lista de ferramentas`);
    }
  });
});
