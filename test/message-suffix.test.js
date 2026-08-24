// A frase fixa no fim da mensagem: quando entra, quando não entra, e o que sai.
// É a única regra do recurso — o resto é desenho.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let applySuffix;

before(async () => {
  ({ applySuffix } = await import('../public/js/core/message-suffix.js'));
});

const FRASE = 'Responda sempre em português.';
const ligado = (phrase = FRASE) => ({ phrase, enabled: true });

describe('applySuffix', () => {
  describe('ligado', () => {
    it('põe a frase depois de uma linha em branco', () => {
      assert.equal(applySuffix('e aí?', ligado()), `e aí?\n\n${FRASE}`);
    });

    it('não duplica linha quando a mensagem já termina em quebra', () => {
      assert.equal(applySuffix('e aí?\n\n', ligado()), `e aí?\n\n${FRASE}`);
    });

    it('preserva as quebras internas da mensagem', () => {
      assert.equal(applySuffix('um\ndois', ligado()), `um\ndois\n\n${FRASE}`);
    });

    it('mensagem vazia (só imagens) vira só a frase', () => {
      assert.equal(applySuffix('', ligado()), FRASE);
      assert.equal(applySuffix('   ', ligado()), FRASE);
    });

    // reenviar uma mensagem que já saiu com a frase não pode empilhar cópias
    it('não repete se a mensagem já termina com a frase', () => {
      const jaTem = `e aí?\n\n${FRASE}`;
      assert.equal(applySuffix(jaTem, ligado()), jaTem);
    });

    it('espaço em volta da frase não conta', () => {
      assert.equal(applySuffix('oi', ligado(`  ${FRASE}  `)), `oi\n\n${FRASE}`);
    });
  });

  describe('desligado ou sem frase', () => {
    it('desligado não mexe no texto', () => {
      assert.equal(applySuffix('e aí?', { phrase: FRASE, enabled: false }), 'e aí?');
    });

    it('ligado com frase vazia não mexe no texto', () => {
      assert.equal(applySuffix('e aí?', { phrase: '   ', enabled: true }), 'e aí?');
    });

    it('sem configuração nenhuma devolve o que entrou', () => {
      assert.equal(applySuffix('e aí?'), 'e aí?');
    });

    it('não inventa texto quando a mensagem é vazia', () => {
      assert.equal(applySuffix('', { phrase: FRASE, enabled: false }), '');
    });
  });
});
