// Tradução do stream-json do CLI para os eventos do contrato do chat
// (readme/10-chat.md). É a peça com mais regra por linha do serviço: uma linha de
// texto entra, zero ou mais eventos saem.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox } from './helpers/sandbox.js';

let box, chat;

before(async () => {
  box = await createSandbox();
  chat = await import('../services/chat/stream.js');
});
after(() => box.cleanup());

/** Coletor no lugar do SSE: guarda o que o serviço tentou enviar. */
function capture(line) {
  const eventos = [];
  chat.forward(typeof line === 'string' ? line : JSON.stringify(line), { send: (e) => eventos.push(e) });
  return eventos;
}

const assistantCom = (...blocks) => ({ type: 'assistant', message: { content: blocks } });
const userCom = (...blocks) => ({ type: 'user', message: { content: blocks } });

describe('linhas que não são evento', () => {
  it('ignora linha vazia', () => {
    assert.deepEqual(capture('   '), []);
  });

  it('trata texto solto como aviso (é stderr do CLI)', () => {
    const [e] = capture('algum aviso do binário');
    assert.equal(e.type, 'notice');
    assert.match(e.message, /aviso do binário/);
  });

  it('ignora JSON quebrado sem estourar', () => {
    assert.deepEqual(capture('{"type":"assistant"'), []);
  });

  it('ignora tipo desconhecido', () => {
    assert.deepEqual(capture({ type: 'coisa_nova_do_cli' }), []);
  });
});

describe('texto', () => {
  it('delta de texto vira delta', () => {
    const [e] = capture({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'oi' } } });
    assert.deepEqual(e, { type: 'delta', text: 'oi' });
  });

  it('bloco de texto vira message', () => {
    const [e] = capture(assistantCom({ type: 'text', text: 'pronto' }));
    assert.deepEqual(e, { type: 'message', text: 'pronto' });
  });
});

describe('chamada de ferramenta', () => {
  it('leva id, nome e o que foi pedido', () => {
    const [e] = capture(assistantCom({
      type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la' },
    }));

    assert.equal(e.type, 'tool');
    assert.equal(e.id, 'toolu_1');
    assert.equal(e.name, 'Bash');
    assert.match(e.input, /ls -la/);
    assert.equal(e.inputTruncated, false);
  });

  it('subagente vem com tipo e prompt, como qualquer ferramenta', () => {
    const [e] = capture(assistantCom({
      type: 'tool_use', id: 'toolu_2', name: 'Agent',
      input: { subagent_type: 'Explore', description: 'Recon', prompt: 'investigue X' },
    }));

    assert.equal(e.name, 'Agent');
    assert.match(e.input, /Explore/);
    assert.match(e.input, /investigue X/);
  });

  it('corta o pedido gigante e AVISA que cortou', () => {
    const [e] = capture(assistantCom({
      type: 'tool_use', id: 'toolu_3', name: 'Agent', input: { prompt: 'x'.repeat(50_000) },
    }));

    assert.equal(e.inputTruncated, true);
    assert.ok(e.input.length < 5000, `veio ${e.input.length} chars`);
  });

  it('sem input não inventa texto', () => {
    const [e] = capture(assistantCom({ type: 'tool_use', id: 'toolu_4', name: 'Read' }));

    assert.equal(e.input, null);
  });

  it('texto e ferramenta na mesma mensagem saem como dois eventos', () => {
    const eventos = capture(assistantCom(
      { type: 'text', text: 'vou olhar' },
      { type: 'tool_use', id: 'toolu_5', name: 'Grep', input: { pattern: 'x' } },
    ));

    assert.deepEqual(eventos.map((e) => e.type), ['message', 'tool']);
  });
});

describe('resultado da ferramenta', () => {
  it('casa com a chamada pelo tool_use_id', () => {
    const [e] = capture(userCom({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'total 8' }));

    assert.equal(e.type, 'toolResult');
    assert.equal(e.id, 'toolu_1');
    assert.equal(e.text, 'total 8');
    assert.equal(e.isError, false);
  });

  it('aceita conteúdo em blocos, não só string', () => {
    const [e] = capture(userCom({
      type: 'tool_result', tool_use_id: 'toolu_2',
      content: [{ type: 'text', text: 'linha 1' }, { type: 'text', text: 'linha 2' }],
    }));

    assert.equal(e.text, 'linha 1\nlinha 2');
  });

  it('marca imagem sem tentar embutir os bytes', () => {
    const [e] = capture(userCom({
      type: 'tool_result', tool_use_id: 'toolu_3',
      content: [{ type: 'image', source: { data: 'AAAA' } }],
    }));

    assert.equal(e.text, '🖼 imagem');
  });

  it('propaga erro da ferramenta', () => {
    const [e] = capture(userCom({
      type: 'tool_result', tool_use_id: 'toolu_4', content: 'command not found', is_error: true,
    }));

    assert.equal(e.isError, true);
  });

  it('corta resultado gigante e avisa', () => {
    const [e] = capture(userCom({
      type: 'tool_result', tool_use_id: 'toolu_5', content: 'y'.repeat(50_000),
    }));

    assert.equal(e.truncated, true);
    assert.ok(e.text.length < 5000);
  });

  it('mensagem de usuário sem tool_result não gera evento', () => {
    assert.deepEqual(capture(userCom({ type: 'text', text: 'oi' })), []);
  });
});

describe('ciclo de vida da resposta', () => {
  it('init do sistema informa modelo e sessão', () => {
    const [e] = capture({ type: 'system', subtype: 'init', model: 'claude-opus-5', session_id: 'abc' });

    assert.deepEqual(e, { type: 'system', model: 'claude-opus-5', sessionId: 'abc' });
  });

  it('result traz custo e turnos', () => {
    const [e] = capture({ type: 'result', subtype: 'success', result: 'ok', total_cost_usd: 0.0116, num_turns: 2 });

    assert.equal(e.type, 'result');
    assert.equal(e.ok, true);
    assert.equal(e.costUsd, 0.0116);
    assert.equal(e.turns, 2);
  });

  it('result com erro explica o motivo em português', () => {
    const [e] = capture({ type: 'result', subtype: 'error_max_turns', is_error: true });

    assert.equal(e.ok, false);
    assert.match(e.message, /limite de turnos/);
  });

  it('limite de uso vira aviso', () => {
    const [e] = capture({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } });

    assert.equal(e.type, 'notice');
    assert.match(e.message, /limite de uso/);
  });

  it('limite de uso "allowed" não incomoda o usuário', () => {
    assert.deepEqual(capture({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), []);
  });
});
