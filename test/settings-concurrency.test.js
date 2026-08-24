// REGRESSÃO de um bug real (24/08/2026): editar número e unidade da retenção em
// sequência disparava dois PUT, e os dois ciclos ler-mesclar-gravar se atropelavam.
// `fs.writeFile` trunca, então a escrita menor deixava o rabo da maior para trás:
// o data/settings.json terminou em "}\n}", JSON inválido. O `read()` engolia o erro
// de parse e devolvia {}, ou seja, a configuração parecia apagada — sem aviso.
//
// A correção foi escrita atômica (.tmp + rename) MAIS uma fila por caminho: só
// atomicidade não basta, porque duas chamadas leriam a mesma base e uma perderia
// a chave da outra.

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSandbox, nextSessionId } from './helpers/sandbox.js';

const CONCORRENTES = 30;
let box, repo;

before(async () => {
  box = await createSandbox();
  repo = await import('../services/settings/repo.js');
});
after(() => box.cleanup());
beforeEach(() => fs.rm(box.dataDir, { recursive: true, force: true }));

const chaves = (n) => Array.from({ length: n }, (_, i) => `k${i + 1}`);

describe('gravações concorrentes na config global', () => {
  it('deixam JSON válido', async () => {
    await Promise.all(chaves(CONCORRENTES).map((k, i) => repo.saveGlobalSettings({ [k]: i })));

    const cru = await fs.readFile(path.join(box.dataDir, 'settings.json'), 'utf8');
    assert.doesNotThrow(() => JSON.parse(cru), 'arquivo saiu partido pela metade');
  });

  it('não perdem nenhuma chave', async () => {
    await Promise.all(chaves(CONCORRENTES).map((k, i) => repo.saveGlobalSettings({ [k]: i })));

    const { settings } = await repo.getGlobalSettings();
    assert.deepEqual(Object.keys(settings).sort(), chaves(CONCORRENTES).sort());
  });

  it('não deixam .tmp para trás', async () => {
    await Promise.all(chaves(CONCORRENTES).map((k, i) => repo.saveGlobalSettings({ [k]: i })));

    const restos = (await fs.readdir(box.dataDir)).filter((f) => f.includes('.tmp'));
    assert.deepEqual(restos, []);
  });
});

describe('gravações concorrentes na config de uma conversa', () => {
  it('não perdem nenhuma chave', async () => {
    const id = `-tmp-teste:${nextSessionId()}`;

    await Promise.all(chaves(20).map((k, i) => repo.saveSettings(id, { [k]: i })));

    const { settings } = await repo.getSettings(id);
    assert.deepEqual(Object.keys(settings).sort(), chaves(20).sort());
  });
});

describe('o caso exato que quebrou: dois campos editados em sequência', () => {
  it('mantém as duas chaves da retenção', async () => {
    await Promise.all([
      repo.saveGlobalSettings({ trashRetentionValue: 1, trashRetentionUnit: 'days' }),
      repo.saveGlobalSettings({ trashRetentionValue: 2, trashRetentionUnit: 'months' }),
    ]);

    const { settings } = await repo.getGlobalSettings();
    assert.equal(Object.keys(settings).length, 2);
    assert.ok('trashRetentionValue' in settings);
    assert.ok('trashRetentionUnit' in settings);
  });
});

describe('apagar durante uma gravação', () => {
  it('não ressuscita o arquivo (o rm entra na mesma fila)', async () => {
    const id = `-tmp-teste:${nextSessionId()}`;
    await repo.saveSettings(id, { mode: 'plan' });

    await Promise.all([
      repo.saveSettings(id, { color: '#fff' }),
      repo.deleteSettings(id),
    ]);

    // ordem entre as duas é indiferente; o que não pode é sobrar arquivo corrompido
    const { settings } = await repo.getSettings(id);
    assert.doesNotThrow(() => JSON.stringify(settings));
  });
});
