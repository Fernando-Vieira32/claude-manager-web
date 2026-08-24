// Como uma sessão é identificada: certeza (o comando declara o id) versus
// palpite (o .jsonl mais novo da pasta). Confundir os dois fez a interface
// afirmar que uma conversa criada pelo navegador estava aberta num terminal.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const ID = '6ef553f6-692a-4d94-add2-4521343e0bd7';
let declaredSessionId;
let isHeadless;

before(async () => {
  ({ declaredSessionId, isHeadless } = await import('../services/sessions/repo.js'));
});

describe('declaredSessionId', () => {
  describe('o comando declara o id', () => {
    it('--resume com espaço', () => {
      assert.equal(declaredSessionId(`claude --resume ${ID}`), ID);
    });

    it('--resume com igual', () => {
      assert.equal(declaredSessionId(`claude --resume=${ID}`), ID);
    });

    it('-r curto', () => {
      assert.equal(declaredSessionId(`claude -r ${ID}`), ID);
    });

    it('--session-id (conversa nascendo, o que este painel usa)', () => {
      assert.equal(declaredSessionId(`claude -p oi --session-id ${ID} --output-format stream-json`), ID);
    });

    it('no meio de outras flags', () => {
      assert.equal(declaredSessionId(`claude -p texto --resume ${ID} --model claude-opus-5 --verbose`), ID);
    });
  });

  describe('o comando NÃO declara nada', () => {
    it('claude cru do terminal', () => {
      assert.equal(declaredSessionId('claude'), null);
    });

    it('--continue não traz id (é "a mais recente", que muda de dono)', () => {
      assert.equal(declaredSessionId('claude --continue'), null);
    });

    it('--resume sem valor abre o seletor interativo', () => {
      assert.equal(declaredSessionId('claude --resume'), null);
    });

    it('--resume seguido de outra flag não é id', () => {
      assert.equal(declaredSessionId('claude --resume --verbose'), null);
    });

    it('valor que não é uuid não vale', () => {
      assert.equal(declaredSessionId('claude --resume ultima'), null);
    });

    // um uuid solto no comando (num caminho, por exemplo) não diz qual conversa
    // o processo abriu — só a flag diz
    it('uuid perdido nos argumentos não conta', () => {
      assert.equal(declaredSessionId(`claude --add-dir /tmp/${ID}/x`), null);
    });

    it('a flag tem de estar separada, não colada em outra palavra', () => {
      assert.equal(declaredSessionId(`claude --no-r ${ID}`), null);
    });
  });
});

describe('isHeadless', () => {
  it('-p é execução do painel, não terminal', () => {
    assert.equal(isHeadless('claude -p oi --output-format stream-json'), true);
  });

  it('--print também', () => {
    assert.equal(isHeadless('claude --print oi'), true);
  });

  it('claude interativo não é headless', () => {
    assert.equal(isHeadless('claude'), false);
  });

  // `-p` colado noutra flag (ou dentro de um caminho) não é o flag `-p`
  it('não confunde -p com pedaço de outra coisa', () => {
    assert.equal(isHeadless('claude --permission-mode plan'), false);
    assert.equal(isHeadless('claude --add-dir /home/x-p/y'), false);
  });
});
