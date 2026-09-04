// A tradução markdown -> blocos (public/js/core/markdown.js + markdown-inline.js).
//
// Nasceu de uma queixa com print: a resposta do Claude aparecia CRUA na bolha —
// `**Criados — o mecanismo**`, ``` e `|---|` na cara de quem lê. O dono colou a mesma
// mensagem num interpretador de markdown para mostrar como devia ficar.
//
// Aqui só a REGRA é testada, e é de propósito: parse é a parte que erra silencioso (um `_`
// no meio de `eco_decision` virando itálico), e é a única que roda no `node --test`. O
// desenho (`components/markdown-text.js`) é verificado no navegador.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../public/js/core/markdown.js';
import { parseInline } from '../public/js/core/markdown-inline.js';

/** Só o texto que sobra depois do parse — para dizer "isto NÃO virou marcação". */
const texto = (pedacos) => pedacos.map((p) => p.text ?? texto(p.children || [])).join('');
const kinds = (blocks) => blocks.map((b) => b.kind);

describe('parseInline', () => {
  describe('negrito, itálico, riscado', () => {
    it('**x** vira strong', () => {
      assert.deepEqual(parseInline('o **belt** novo').map((p) => p.kind), ['text', 'strong', 'text']);
    });

    it('*x* vira em', () => {
      assert.equal(parseInline('é *quase* isso')[1].kind, 'em');
    });

    it('~~x~~ vira riscado', () => {
      assert.equal(parseInline('~~fora~~')[0].kind, 'strike');
    });

    it('marcação aninhada: **com `código` dentro**', () => {
      const dentro = parseInline('**veja `policy.rb` agora**')[0].children;

      assert.deepEqual(dentro.map((p) => p.kind), ['text', 'code', 'text']);
    });
  });

  // O caso que mais dói neste projeto: quase todo nome de arquivo e de método Ruby tem `_`.
  // Sem a guarda, `eco_confirm_outcome.rb` perde os underscores e ganha itálico no meio.
  describe('`_` dentro de palavra', () => {
    it('não é ênfase: o nome fica inteiro', () => {
      assert.equal(texto(parseInline('built_in_copy_spec.rb')), 'built_in_copy_spec.rb');
    });

    it('mas `_x_` solto continua sendo ênfase', () => {
      assert.equal(parseInline('vale _isto_ aqui')[1].kind, 'em');
    });
  });

  describe('código com asterisco dentro', () => {
    it('o que está entre crases não é negrito', () => {
      const [pedaco] = parseInline('`ls **/*.rb`');

      assert.equal(pedaco.kind, 'code');
      assert.equal(pedaco.text, 'ls **/*.rb');
    });
  });

  describe('links', () => {
    it('[texto](url) vira link com o texto dentro', () => {
      const [link] = parseInline('[o readme](https://x.dev/a)');

      assert.equal(link.kind, 'link');
      assert.equal(link.href, 'https://x.dev/a');
      assert.equal(texto(link.children), 'o readme');
    });

    it('url solta também vira link', () => {
      assert.equal(parseInline('veja http://localhost:7788/x')[1].href, 'http://localhost:7788/x');
    });
  });

  describe('barra invertida antes do marcador', () => {
    it('mostra o caractere, não a marcação', () => {
      assert.equal(texto(parseInline('literal \\*asterisco\\*')), 'literal *asterisco*');
    });
  });

  describe('marcação que o Claude abriu e ainda não fechou (stream a meio)', () => {
    it('fica texto — nada de comer o resto da resposta', () => {
      assert.equal(texto(parseInline('**Cria')), '**Cria');
    });
  });
});

describe('parseMarkdown', () => {
  describe('título', () => {
    it('## vira heading nível 2', () => {
      const [b] = parseMarkdown('## Criados — o mecanismo');

      assert.equal(b.kind, 'heading');
      assert.equal(b.level, 2);
      assert.equal(texto(b.inline), 'Criados — o mecanismo');
    });

    it('`#` sem espaço não é título (é `#3` de uma issue)', () => {
      assert.equal(parseMarkdown('#3 quebrou')[0].kind, 'para');
    });
  });

  describe('cerca de código', () => {
    it('guarda a linguagem e o texto EXATO (indentação inclusive)', () => {
      const [b] = parseMarkdown('```ruby\ndef x\n  1\nend\n```');

      assert.equal(b.kind, 'code');
      assert.equal(b.lang, 'ruby');
      assert.equal(b.text, 'def x\n  1\nend');
    });

    it('não interpreta nada lá dentro — `- item` é código, não lista', () => {
      const [b] = parseMarkdown('```\n- item\n## não é título\n```');

      assert.equal(b.text, '- item\n## não é título');
    });

    // O caso do stream: o fechamento ainda não chegou. Tratar como parágrafo faria o bloco
    // piscar entre um desenho e outro a cada pedaço que chega.
    it('cerca ABERTA vale até o fim do texto', () => {
      const [b] = parseMarkdown('```sh\nnpm test');

      assert.equal(b.kind, 'code');
      assert.equal(b.text, 'npm test');
    });
  });

  describe('lista', () => {
    it('cada item é um mini-documento', () => {
      const [b] = parseMarkdown('- um\n- dois');

      assert.equal(b.kind, 'list');
      assert.equal(b.ordered, false);
      assert.equal(b.items.length, 2);
      assert.equal(texto(b.items[0].blocks[0].inline), 'um');
    });

    it('`1.` é lista ordenada', () => {
      assert.equal(parseMarkdown('1. um\n2. dois')[0].ordered, true);
    });

    it('o que está mais indentado é sub-lista DENTRO do item', () => {
      const [b] = parseMarkdown('- pai\n  - filho\n- outro');

      assert.equal(b.items.length, 2, 'o filho não pode virar item do pai');
      assert.deepEqual(kinds(b.items[0].blocks), ['para', 'list']);
      assert.equal(texto(b.items[0].blocks[1].items[0].blocks[0].inline), 'filho');
    });

    // É o item mais RASO que fecha a sub-lista. Sem isso, `filho` entrava na lista de
    // `neto` e a resposta ganhava um nível de indentação que o Claude não escreveu.
    it('item mais raso encerra a sub-lista', () => {
      const [b] = parseMarkdown('- pai\n    - neto\n  - filho');

      assert.deepEqual(kinds(b.items[0].blocks), ['para', 'list', 'list']);
      assert.equal(texto(b.items[0].blocks[1].items[0].blocks[0].inline), 'neto');
      assert.equal(texto(b.items[0].blocks[2].items[0].blocks[0].inline), 'filho');
    });

    it('trocar de marcador começa outra lista (número depois de traço)', () => {
      assert.deepEqual(kinds(parseMarkdown('- um\n1. dois')), ['list', 'list']);
    });

    it('código indentado dentro do item também é do item', () => {
      const [b] = parseMarkdown('- roda:\n  ```sh\n  npm test\n  ```');

      assert.deepEqual(kinds(b.items[0].blocks), ['para', 'code']);
      assert.equal(b.items[0].blocks[1].text, 'npm test');
    });
  });

  describe('régua e citação', () => {
    it('--- é régua, não lista nem título', () => {
      assert.equal(parseMarkdown('---')[0].kind, 'rule');
    });

    it('> abre citação, e o que está dentro é lido como markdown', () => {
      const [b] = parseMarkdown('> **cuidado** aqui');

      assert.equal(b.kind, 'quote');
      assert.equal(b.blocks[0].inline[0].kind, 'strong');
    });
  });

  describe('tabela', () => {
    it('cabeçalho + separador + linhas', () => {
      const [b] = parseMarkdown('| arquivo | linhas |\n|---|---:|\n| a.rb | 52 |\n| b.rb | 81 |');

      assert.equal(b.kind, 'table');
      assert.deepEqual(b.head.map(texto), ['arquivo', 'linhas']);
      assert.equal(b.rows.length, 2);
      assert.deepEqual(b.rows[1].map(texto), ['b.rb', '81']);
    });

    // O `|` aparece à vontade em comando de shell. Quem manda é o separador embaixo.
    it('sem a linha separadora, é parágrafo — `ps aux | grep node` não é tabela', () => {
      assert.equal(parseMarkdown('ps aux | grep node')[0].kind, 'para');
    });
  });

  describe('parágrafo', () => {
    it('junta as linhas seguintes, preservando a quebra que o Claude escreveu', () => {
      const [b] = parseMarkdown('linha um\nlinha dois');

      assert.equal(texto(b.inline), 'linha um\nlinha dois');
    });

    it('para quando o bloco seguinte começa (não come a lista abaixo)', () => {
      assert.deepEqual(kinds(parseMarkdown('Enquanto roda:\n- um\n- dois')), ['para', 'list']);
    });

    it('linha em branco separa parágrafos', () => {
      assert.deepEqual(kinds(parseMarkdown('um\n\ndois')), ['para', 'para']);
    });
  });

  describe('texto vazio ou sem marcação nenhuma', () => {
    it('vazio não gera bloco', () => {
      assert.deepEqual(parseMarkdown(''), []);
    });

    it('só espaços e quebras também não', () => {
      assert.deepEqual(parseMarkdown('\n  \n\n'), []);
    });

    it('texto simples é um parágrafo só', () => {
      assert.deepEqual(kinds(parseMarkdown('só uma frase.')), ['para']);
    });
  });

  // A mensagem do print, na íntegra: é ela que tem de sair certa, não os casos de manual.
  describe('a resposta real que motivou isto', () => {
    const fonte = [
      'Enquanto roda, os arquivos. Commit `da9dda011`, 19 arquivos:',
      '',
      '**Criados — o mecanismo (273 linhas)**',
      '```',
      'app/services/engine/v2/policy/configurable_handoff/belt.rb   81',
      'app/services/engine/v2/policy/configurable_handoff/mode.rb   64',
      '```',
      '',
      '**Alterados — o fio (~110 linhas)**',
      '```',
      'app/services/engine/v2/policy/eco_decision.rb  +35  _regulatory_complaint_belt',
      '```',
      '',
      '**Re-pinados** — `knobs/registry_spec.rb` (62→64 knobs) e `built_in_copy_spec.rb` (3→4 reasons).',
      '',
      'Nada fora disso. Nada em `config/agents/`.',
    ].join('\n');
    const blocos = parseMarkdown(fonte);

    it('sai na ordem certa: prosa, rótulo, cerca, rótulo, cerca, rótulo, prosa', () => {
      assert.deepEqual(kinds(blocos), ['para', 'para', 'code', 'para', 'code', 'para', 'para']);
    });

    it('o `**Criados…**` vira negrito, e não aparece com asterisco na tela', () => {
      assert.equal(blocos[1].inline[0].kind, 'strong');
      assert.equal(texto(blocos[1].inline), 'Criados — o mecanismo (273 linhas)');
    });

    it('a cerca guarda os caminhos alinhados como estavam', () => {
      assert.match(blocos[2].text, /belt\.rb {3}81/);
    });

    it('`_regulatory_complaint_belt` dentro da cerca fica intacto', () => {
      assert.match(blocos[4].text, /_regulatory_complaint_belt$/);
    });

    it('e `built_in_copy_spec.rb` na prosa continua com os underscores', () => {
      assert.match(texto(blocos[5].inline), /built_in_copy_spec\.rb/);
    });
  });
});
