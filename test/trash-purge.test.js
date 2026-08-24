// Expurgo da lixeira: o único caminho do app que apaga conversa sem volta.
// Cobre a regra de idade, a validação e a garantia de que dryRun não apaga.

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createSandbox, givenTrashed, ago, trashNames } from './helpers/sandbox.js';

let box, repo;

before(async () => {
  box = await createSandbox();
  repo = await import('../services/conversations/repo.js');
});
after(() => box.cleanup());
beforeEach(() => fs.rm(box.trashDir, { recursive: true, force: true }));

describe('purgeTrash', () => {
  describe('validação da retenção', () => {
    it('recusa quantidade zero', () =>
      assert.rejects(() => repo.purgeTrash({ value: 0, unit: 'days' }), /quantidade inválida/));

    it('recusa quantidade acima do teto', () =>
      assert.rejects(() => repo.purgeTrash({ value: 1000, unit: 'days' }), /quantidade inválida/));

    it('recusa quantidade fracionada', () =>
      assert.rejects(() => repo.purgeTrash({ value: 1.5, unit: 'days' }), /quantidade inválida/));

    it('recusa unidade que não existe', () =>
      assert.rejects(() => repo.purgeTrash({ value: 1, unit: 'semanas' }), /unidade inválida/));

    it('recusa chamada sem argumento', () =>
      assert.rejects(() => repo.purgeTrash(), /quantidade inválida/));
  });

  describe('dryRun', () => {
    it('conta o que passou do corte sem apagar', async () => {
      await givenTrashed(box, { at: ago({ days: 10 }), bytes: 500 });
      await givenTrashed(box, { at: new Date(), bytes: 999 });

      const r = await repo.purgeTrash({ value: 1, unit: 'days', dryRun: true });

      assert.equal(r.dryRun, true);
      assert.equal(r.count, 1);
      assert.equal(r.bytes, 500);
      assert.equal((await trashNames(box)).length, 2, 'dryRun não pode encostar no disco');
    });
  });

  describe('expurgo real', () => {
    it('apaga o antigo e preserva o recente', async () => {
      await givenTrashed(box, { at: ago({ days: 40 }), projectDir: '-tmp-velho' });
      const novo = await givenTrashed(box, { at: ago({ days: 2 }), projectDir: '-tmp-novo' });

      const r = await repo.purgeTrash({ value: 30, unit: 'days' });

      assert.equal(r.count, 1);
      assert.deepEqual(await trashNames(box), [novo]);
    });

    it('devolve os bytes liberados', async () => {
      await givenTrashed(box, { at: ago({ years: 1 }), bytes: 1234 });

      const r = await repo.purgeTrash({ value: 1, unit: 'days' });

      assert.equal(r.bytes, 1234);
    });

    it('não apaga o que foi deletado hoje, nem na retenção mínima', async () => {
      await givenTrashed(box, { at: new Date() });

      const r = await repo.purgeTrash({ value: 1, unit: 'days' });

      assert.equal(r.count, 0);
      assert.equal((await trashNames(box)).length, 1);
    });
  });

  describe('meses e anos são calendário, não múltiplos de 30 dias', () => {
    it('item de 1 mês e meio é velho para 1 mês e novo para 2', async () => {
      await givenTrashed(box, { at: ago({ months: 1, days: 15 }) });

      const um = await repo.purgeTrash({ value: 1, unit: 'months', dryRun: true });
      const dois = await repo.purgeTrash({ value: 2, unit: 'months', dryRun: true });

      assert.equal(um.count, 1);
      assert.equal(dois.count, 0);
    });

    it('item de 13 meses é velho para 1 ano', async () => {
      await givenTrashed(box, { at: ago({ months: 13 }) });

      const r = await repo.purgeTrash({ value: 1, unit: 'years', dryRun: true });

      assert.equal(r.count, 1);
    });

    // Este é o caso que separa calendário de "n × 30 dias": 12 meses de calendário
    // são ~365 dias, e o atalho errado daria 360. Um item de 362 dias cai de lados
    // opostos nas duas contas — sem ele, trocar setMonth por dias*30 passa batido.
    it('12 meses não são 360 dias', async () => {
      await givenTrashed(box, { at: ago({ days: 362 }) });

      const r = await repo.purgeTrash({ value: 12, unit: 'months', dryRun: true });

      assert.equal(r.count, 0, 'item de 362 dias é mais novo que 12 meses de calendário');
    });
  });

  describe('lixeira ausente ou vazia', () => {
    it('devolve zero sem estourar', async () => {
      const r = await repo.purgeTrash({ value: 1, unit: 'years' });

      assert.equal(r.count, 0);
      assert.equal(r.bytes, 0);
      assert.deepEqual(r.items, []);
    });
  });

  describe('arquivo estranho na pasta', () => {
    it('ignora quem não é .jsonl', async () => {
      await fs.mkdir(box.trashDir, { recursive: true });
      await fs.writeFile(`${box.trashDir}/anotacao.txt`, 'nao sou conversa');

      const r = await repo.purgeTrash({ value: 1, unit: 'days' });

      assert.equal(r.count, 0);
      assert.equal((await fs.readdir(box.trashDir)).length, 1, 'o .txt fica onde está');
    });
  });
});
