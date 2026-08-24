// Resolução de modelo -> janela de contexto. Existe porque a janela era
// ADIVINHADA pelo nome ("tem [1m]? então 1M") e `claude-opus-5` não tem sufixo:
// a interface mostrava 200k numa conversa de 1M.
//
// A API responde 404 para alias (`opus`) e para variante com sufixo
// (`claude-opus-5[1m]`), então o casamento tem que acontecer aqui.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelId, resolveModel, contextWindowOf, modelFromApi } from '../core/claude-models.js';

// Recorte do catálogo real da API, **de propósito fora de ordem**: o mais antigo
// da família opus vem primeiro. Assim "alias resolve para o mais novo" só passa
// se a ordenação por data existir de verdade — com a lista já ordenada, o teste
// passaria por acidente (foi o que aconteceu na primeira versão dele).
const CATALOGO = [
  { id: 'claude-opus-4-8', createdAt: '2026-05-01T00:00:00Z', maxInputTokens: 1_000_000 },
  { id: 'claude-opus-5', createdAt: '2026-07-24T00:00:00Z', maxInputTokens: 1_000_000 },
  { id: 'claude-sonnet-5', createdAt: '2026-06-01T00:00:00Z', maxInputTokens: 1_000_000 },
  { id: 'claude-haiku-4-5', createdAt: '2025-10-01T00:00:00Z', maxInputTokens: 200_000 },
];

describe('normalizeModelId', () => {
  it('id normal passa direto', () => {
    assert.deepEqual(normalizeModelId('claude-opus-5'), { id: 'claude-opus-5', familia: null });
  });

  it('tira o sufixo de variante [1m] — a API 404 com ele', () => {
    assert.equal(normalizeModelId('claude-opus-5[1m]').id, 'claude-opus-5');
  });

  it('tira o sufixo -fast', () => {
    assert.equal(normalizeModelId('claude-opus-4-8-fast').id, 'claude-opus-4-8');
  });

  it('reconhece alias como família', () => {
    assert.deepEqual(normalizeModelId('opus'), { id: 'opus', familia: 'opus' });
  });

  it('<synthetic> não é modelo (é o turno que o /compact grava)', () => {
    assert.equal(normalizeModelId('<synthetic>'), null);
  });

  it('vazio e ausente devolvem null', () => {
    assert.equal(normalizeModelId(''), null);
    assert.equal(normalizeModelId(undefined), null);
  });
});

describe('resolveModel', () => {
  it('casa pelo id exato', () => {
    assert.equal(resolveModel(CATALOGO, 'claude-opus-5').id, 'claude-opus-5');
  });

  it('casa a variante com sufixo no modelo de base', () => {
    assert.equal(resolveModel(CATALOGO, 'claude-opus-5[1m]').id, 'claude-opus-5');
  });

  it('alias resolve para o mais NOVO da família', () => {
    assert.equal(resolveModel(CATALOGO, 'opus').id, 'claude-opus-5');
  });

  it('alias de outra família não vaza para a errada', () => {
    assert.equal(resolveModel(CATALOGO, 'haiku').id, 'claude-haiku-4-5');
  });

  it('modelo desconhecido devolve null (não inventa)', () => {
    assert.equal(resolveModel(CATALOGO, 'claude-inexistente-9'), null);
  });

  it('catálogo vazio devolve null', () => {
    assert.equal(resolveModel([], 'claude-opus-5'), null);
    assert.equal(resolveModel(undefined, 'claude-opus-5'), null);
  });
});

describe('contextWindowOf', () => {
  it('Opus 5 é 1M — o caso que estava errado na tela', () => {
    assert.equal(contextWindowOf(CATALOGO, 'claude-opus-5'), 1_000_000);
  });

  it('Haiku 4.5 é 200k — não é tudo 1M', () => {
    assert.equal(contextWindowOf(CATALOGO, 'claude-haiku-4-5'), 200_000);
  });

  it('sem catálogo devolve null para quem chamar decidir', () => {
    assert.equal(contextWindowOf([], 'claude-opus-5'), null);
  });

  it('entrada sem maxInputTokens não vira NaN nem 0', () => {
    assert.equal(contextWindowOf([{ id: 'x', maxInputTokens: null }], 'x'), null);
  });
});

describe('modelFromApi', () => {
  it('mapeia os campos da API (max_input_tokens é a janela)', () => {
    const m = modelFromApi({
      id: 'claude-opus-5',
      display_name: 'Claude Opus 5',
      created_at: '2026-07-24T00:00:00Z',
      max_input_tokens: 1_000_000,
      max_tokens: 128_000,
    });

    assert.equal(m.id, 'claude-opus-5');
    assert.equal(m.displayName, 'Claude Opus 5');
    assert.equal(m.maxInputTokens, 1_000_000);
    assert.equal(m.maxOutputTokens, 128_000);
  });

  it('não existe campo context_window na resposta — ignorar o que não vier', () => {
    const m = modelFromApi({ id: 'x', context_window: 999 });

    assert.equal(m.maxInputTokens, null);
    assert.equal(m.displayName, 'x');
  });
});
