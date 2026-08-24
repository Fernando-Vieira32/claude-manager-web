// core/claude-blocks.js — a leitura de blocos que os DOIS serviços usam (chat ao
// vivo e conversations no disco). Testado direto porque é contrato compartilhado:
// quebrar aqui quebra os dois de uma vez.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampText, detailOf, resultText, summaryOf, toolFromUse, MAX_DETAIL } from '../core/claude-blocks.js';

describe('clampText', () => {
  it('devolve null para vazio', () => {
    assert.equal(clampText(''), null);
    assert.equal(clampText(null), null);
  });

  it('não mexe no que cabe', () => {
    assert.deepEqual(clampText('curto'), { text: 'curto', truncated: false });
  });

  it('corta e avisa', () => {
    const r = clampText('x'.repeat(MAX_DETAIL + 10));
    assert.equal(r.truncated, true);
    assert.equal(r.text.length, MAX_DETAIL);
  });
});

describe('detailOf', () => {
  it('objeto vira JSON legível', () => {
    assert.match(detailOf({ a: 1 }).text, /"a": 1/);
  });

  it('string passa direto', () => {
    assert.equal(detailOf('oi').text, 'oi');
  });

  it('ausente é null, não "undefined"', () => {
    assert.equal(detailOf(undefined), null);
    assert.equal(detailOf(null), null);
  });
});

describe('resultText', () => {
  it('string passa direto', () => {
    assert.equal(resultText('saida'), 'saida');
  });

  it('junta blocos de texto', () => {
    assert.equal(resultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  });

  it('imagem vira marca, não base64', () => {
    assert.equal(resultText([{ type: 'image', source: { data: 'AAAA' } }]), '🖼 imagem');
  });

  it('formato inesperado não estoura', () => {
    assert.equal(resultText(undefined), '');
    assert.equal(resultText(42), '');
  });
});

describe('summaryOf', () => {
  it('subagente: tipo na frente da descrição', () => {
    assert.equal(
      summaryOf({ subagent_type: 'Explore', description: 'Recon do login', prompt: 'texto longo…' }),
      'Explore · Recon do login',
    );
  });

  it('subagente sem descrição mostra só o tipo', () => {
    assert.equal(summaryOf({ subagent_type: 'general-purpose', prompt: 'x' }), 'general-purpose');
  });

  it('usa a description quando existe (é o caso do Bash)', () => {
    assert.equal(summaryOf({ command: 'ls -la', description: 'Listar arquivos' }), 'Listar arquivos');
  });

  it('cai no command quando não há description', () => {
    assert.equal(summaryOf({ command: 'git status' }), 'git status');
  });

  it('caminho mostra as duas ultimas partes — o nome do arquivo identifica', () => {
    assert.equal(
      summaryOf({ file_path: '/home/fernando/www/personal/claude-manager-web/core/claude-blocks.js' }),
      'core/claude-blocks.js',
    );
  });

  it('comando longo é cortado no FIM, preservando o começo', () => {
    const s = summaryOf({ command: `git status ${'-x '.repeat(40)}` });
    assert.match(s, /^git status /);
    assert.match(s, /…$/);
  });

  it('caminho de arquivo na raiz não estoura', () => {
    assert.equal(summaryOf({ file_path: '/a.txt' }), 'a.txt');
  });

  it('normaliza espaço e quebra de linha', () => {
    assert.equal(summaryOf({ command: 'echo  a\n  b' }), 'echo a b');
  });

  it('sem campo conhecido devolve null (o chip fica só com o nome)', () => {
    assert.equal(summaryOf({ coisa: 'valor' }), null);
  });

  it('input ausente ou não-objeto devolve null', () => {
    assert.equal(summaryOf(undefined), null);
    assert.equal(summaryOf('texto'), null);
  });
});

describe('toolFromUse', () => {
  it('leva id, nome, resumo e pedido', () => {
    const t = toolFromUse({ id: 't1', name: 'Bash', input: { command: 'ls', description: 'Listar' } });

    assert.equal(t.id, 't1');
    assert.equal(t.name, 'Bash');
    assert.equal(t.summary, 'Listar');
    assert.match(t.input, /ls/);
    assert.equal(t.inputTruncated, false);
  });

  it('ferramenta sem nome não vira "undefined" na tela', () => {
    assert.equal(toolFromUse({ id: 't1' }).name, 'ferramenta');
  });
});
