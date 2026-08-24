// Configurações chave/valor nos dois escopos (global e por conversa). Os dois
// dividem a mesma validação e a mesma mesclagem, então o que vale para um vale
// para o outro — daí os casos rodarem contra os dois pares de funções.

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createSandbox, nextSessionId } from './helpers/sandbox.js';

let box, repo, escopos;

before(async () => {
  box = await createSandbox();
  repo = await import('../services/settings/repo.js');
  escopos = [
    {
      nome: 'global',
      ler: () => repo.getGlobalSettings().then((r) => r.settings),
      gravar: (patch) => repo.saveGlobalSettings(patch).then((r) => r.settings),
    },
    {
      nome: 'por conversa',
      id: `-tmp-teste:${nextSessionId()}`,
      ler() { return repo.getSettings(this.id).then((r) => r.settings); },
      gravar(patch) { return repo.saveSettings(this.id, patch).then((r) => r.settings); },
    },
  ];
});
after(() => box.cleanup());
beforeEach(() => fs.rm(box.dataDir, { recursive: true, force: true }));

for (const escopo of [0, 1]) {
  describe(`escopo ${escopo === 0 ? 'global' : 'por conversa'}`, () => {
    const alvo = () => escopos[escopo];

    describe('sem nada gravado', () => {
      it('devolve objeto vazio', async () => {
        assert.deepEqual(await alvo().ler(), {});
      });
    });

    describe('gravação', () => {
      it('persiste e lê de volta', async () => {
        await alvo().gravar({ mode: 'plan', color: '#3b82f6' });

        assert.deepEqual(await alvo().ler(), { mode: 'plan', color: '#3b82f6' });
      });

      it('mescla em vez de substituir (semântica PATCH)', async () => {
        await alvo().gravar({ mode: 'plan', color: '#fff' });
        await alvo().gravar({ mode: 'acceptEdits' });

        assert.deepEqual(await alvo().ler(), { mode: 'acceptEdits', color: '#fff' });
      });

      it('aceita texto, número e booleano', async () => {
        const salvo = await alvo().gravar({ texto: 'x', numero: 7, ligado: true });

        assert.deepEqual(salvo, { texto: 'x', numero: 7, ligado: true });
      });
    });

    describe('voltar ao padrão', () => {
      it('string vazia remove a chave', async () => {
        await alvo().gravar({ color: '#fff', mode: 'plan' });

        assert.deepEqual(await alvo().gravar({ color: '' }), { mode: 'plan' });
      });

      it('null remove a chave', async () => {
        await alvo().gravar({ color: '#fff', mode: 'plan' });

        assert.deepEqual(await alvo().gravar({ color: null }), { mode: 'plan' });
      });
    });

    describe('entrada inválida', () => {
      it('recusa o que não é objeto', () =>
        assert.rejects(() => alvo().gravar('texto solto'), /objeto chave\/valor/));

      it('recusa array', () =>
        assert.rejects(() => alvo().gravar(['a']), /objeto chave\/valor/));

      it('recusa chave com caractere proibido', () =>
        assert.rejects(() => alvo().gravar({ 'chave com espaço': 1 }), /chave inválida/));

      it('recusa chave longa demais', () =>
        assert.rejects(() => alvo().gravar({ ['k'.repeat(41)]: 1 }), /chave inválida/));

      it('recusa valor objeto', () =>
        assert.rejects(() => alvo().gravar({ x: { aninhado: 1 } }), /valor inválido/));

      it('recusa config acima do teto de 16 KB', () =>
        assert.rejects(() => alvo().gravar({ grande: 'x'.repeat(20_000) }), /grande demais/));
    });

    describe('arquivo ilegível no disco', () => {
      it('não estoura: assume config vazia', async () => {
        await alvo().gravar({ mode: 'plan' });
        const arquivo = escopo === 0
          ? box.dataDir + '/settings.json'
          : `${box.dataDir}/conversas/${(await fs.readdir(`${box.dataDir}/conversas`))[0]}`;
        await fs.writeFile(arquivo, '{ isto nao e json');

        assert.deepEqual(await alvo().ler(), {});
      });
    });
  });
}

describe('os escopos não se misturam', () => {
  it('gravar na global não mexe na da conversa', async () => {
    await escopos[0].gravar({ trashRetentionValue: 30 });
    await escopos[1].gravar({ mode: 'plan' });

    assert.deepEqual(await escopos[0].ler(), { trashRetentionValue: 30 });
    assert.deepEqual(await escopos[1].ler(), { mode: 'plan' });
  });
});

describe('deleteSettings', () => {
  it('apaga e devolve o que existia, para o Desfazer regravar', async () => {
    const id = `-tmp-teste:${nextSessionId()}`;
    await repo.saveSettings(id, { mode: 'plan', color: '#fff' });

    const { settings } = await repo.deleteSettings(id);

    assert.deepEqual(settings, { mode: 'plan', color: '#fff' });
    assert.deepEqual((await repo.getSettings(id)).settings, {});
  });

  it('não erra quando não havia config', async () => {
    const { settings } = await repo.deleteSettings(`-tmp-teste:${nextSessionId()}`);

    assert.deepEqual(settings, {});
  });
});

describe('id de conversa', () => {
  it('recusa id fora do padrão', () =>
    assert.rejects(() => repo.getSettings('sem-dois-pontos'), /id de conversa inválido/));

  it('recusa travessia de diretório', () =>
    assert.rejects(() => repo.getSettings('../../etc:passwd0000'), /inválido|fora de/));
});
