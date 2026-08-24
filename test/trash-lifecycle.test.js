// Deletar → lixeira → restaurar. A promessa central do app é "deletar nunca apaga",
// e ela depende do nome do arquivo: é dele que a restauração tira projeto e sessão.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSandbox, givenConversation, trashNames } from './helpers/sandbox.js';

let box, repo;

before(async () => {
  box = await createSandbox();
  repo = await import('../services/conversations/repo.js');
});
after(() => box.cleanup());

const existe = (f) => fs.access(f).then(() => true, () => false);

describe('deleteConversation', () => {
  it('move para a lixeira em vez de apagar', async () => {
    const c = await givenConversation(box);

    const r = await repo.deleteConversation(c.id);

    assert.equal(await existe(c.file), false, 'saiu de projects/');
    assert.equal(await existe(path.join(box.trashDir, r.trashedAs)), true, 'chegou na lixeira');
  });

  it('preserva o conteúdo byte a byte', async () => {
    const linha = '{"cwd":"/tmp/teste","texto":"acentuação é preservada"}';
    const c = await givenConversation(box, { lines: [linha] });

    const r = await repo.deleteConversation(c.id);

    const salvo = await fs.readFile(path.join(box.trashDir, r.trashedAs), 'utf8');
    assert.equal(salvo, `${linha}\n`);
  });

  it('grava o nome no padrão data_projeto_sessao', async () => {
    const c = await givenConversation(box, { projectDir: '-tmp-projeto-x' });

    const r = await repo.deleteConversation(c.id);

    assert.match(r.trashedAs, /^\d{8}-\d{6}_-tmp-projeto-x_[A-Za-z0-9-]{8,}\.jsonl$/);
  });

  it('recusa conversa que não existe', () =>
    assert.rejects(() => repo.deleteConversation('-tmp-teste:nao-existe-9999'), /não encontrada/));

  it('recusa id fora do padrão', () =>
    assert.rejects(() => repo.deleteConversation('sem-dois-pontos'), /id de conversa inválido/));
});

describe('listTrash', () => {
  it('lê a data de deleção do nome, não do mtime', async () => {
    const c = await givenConversation(box);
    // mtime bem no passado: se a lista usasse mtime, apareceria como deletada em 2001
    await fs.utimes(c.file, new Date('2001-01-01'), new Date('2001-01-01'));

    const { trashedAs } = await repo.deleteConversation(c.id);
    const item = (await repo.listTrash()).find((t) => t.name === trashedAs);

    assert.ok(item, 'o item aparece na lista');
    assert.ok(new Date(item.deletedAt) > new Date('2020-01-01'), `deletedAt saiu como ${item.deletedAt}`);
  });
});

describe('restoreFromTrash', () => {
  it('devolve a conversa ao projeto de origem', async () => {
    const c = await givenConversation(box, { projectDir: '-tmp-origem' });
    const { trashedAs } = await repo.deleteConversation(c.id);

    const r = await repo.restoreFromTrash(trashedAs);

    assert.equal(r.restored, `${c.projectDir}:${c.sessionId}`);
    assert.equal(await existe(c.file), true, 'voltou para o caminho original');
    assert.equal((await trashNames(box)).includes(trashedAs), false, 'saiu da lixeira');
  });

  it('recusa nome que não segue o padrão', async () => {
    await fs.mkdir(box.trashDir, { recursive: true });
    await fs.writeFile(path.join(box.trashDir, 'bagunca.jsonl'), '{}');

    await assert.rejects(() => repo.restoreFromTrash('bagunca.jsonl'), /não segue o padrão/);
  });

  it('recusa nome com travessia de diretório', () =>
    assert.rejects(() => repo.restoreFromTrash('../../etc/passwd'), /nome inválido/));

  it('recusa arquivo que não está na lixeira', () =>
    assert.rejects(
      () => repo.restoreFromTrash('20200101-120000_-tmp-x_11111111-1111-1111-1111-111111111111.jsonl'),
      /não está na lixeira/,
    ));
});
