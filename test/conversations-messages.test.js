// Leitura do histórico: as ferramentas de uma conversa salva precisam voltar
// ESTRUTURADAS (pedido + resultado casados por id), senão o detalhe se perde
// quando a resposta termina e a conversa é relida do disco.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSandbox, nextSessionId } from './helpers/sandbox.js';

let box, repo;

before(async () => {
  box = await createSandbox();
  repo = await import('../services/conversations/repo.js');
});
after(() => box.cleanup());

/** Escreve um transcript com as entradas dadas e devolve o id da conversa. */
async function givenTranscript(...entries) {
  const projectDir = '-tmp-teste';
  const sessionId = nextSessionId();
  const dir = path.join(box.projectsDir, projectDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${sessionId}.jsonl`),
    `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
  return `${projectDir}:${sessionId}`;
}

const fala = (text) => ({ type: 'user', origin: { kind: 'human' }, message: { content: [{ type: 'text', text }] } });
const usa = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const devolve = (id, content, extra = {}) =>
  ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] } });

const ler = async (id) => (await repo.getConversation(id, { limit: 50 })).messages;

describe('ferramentas no histórico', () => {
  it('a mensagem carrega a ferramenta com pedido', async () => {
    const id = await givenTranscript(fala('rode ls'), usa('t1', 'Bash', { command: 'ls -la' }));

    const msgs = await ler(id);
    const comTool = msgs.find((m) => m.tools);

    assert.ok(comTool, 'alguma mensagem devia ter tools');
    assert.equal(comTool.tools[0].name, 'Bash');
    assert.equal(comTool.tools[0].id, 't1');
    assert.match(comTool.tools[0].input, /ls -la/);
  });

  it('casa o resultado com a chamada pelo id', async () => {
    const id = await givenTranscript(
      fala('rode ls'),
      usa('t1', 'Bash', { command: 'ls' }),
      devolve('t1', 'um.txt\ndois.txt'),
    );

    const [tool] = (await ler(id)).find((m) => m.tools).tools;

    assert.equal(tool.result.text, 'um.txt\ndois.txt');
    assert.equal(tool.result.isError, false);
  });

  it('mensagem que só tem ferramenta NÃO é descartada como ruído', async () => {
    const id = await givenTranscript(fala('vai'), usa('t1', 'Read', { file_path: '/a.txt' }));

    const msgs = await ler(id);

    assert.equal(msgs.length, 2, `veio ${msgs.length} mensagem(ns): ${JSON.stringify(msgs.map((m) => m.text))}`);
  });

  it('a mensagem de resultado não vira mensagem própria', async () => {
    const id = await givenTranscript(
      fala('vai'),
      usa('t1', 'Bash', { command: 'ls' }),
      devolve('t1', 'saida'),
    );

    const msgs = await ler(id);

    assert.equal(msgs.length, 2, 'fala humana + a chamada; o resultado entra dentro da chamada');
  });

  it('o texto não traz mais o "⚙ nome" cravado', async () => {
    const id = await givenTranscript(fala('vai'), usa('t1', 'Bash', { command: 'ls' }));

    const msgs = await ler(id);

    assert.ok(!msgs.some((m) => m.text.includes('⚙')), 'ferramenta agora é estruturada, não texto');
  });

  it('propaga erro da ferramenta', async () => {
    const id = await givenTranscript(
      fala('vai'),
      usa('t1', 'Bash', { command: 'catt' }),
      devolve('t1', 'command not found', { is_error: true }),
    );

    const [tool] = (await ler(id)).find((m) => m.tools).tools;

    assert.equal(tool.result.isError, true);
  });

  it('resultado em blocos e imagem não estouram', async () => {
    const id = await givenTranscript(
      fala('vai'),
      usa('t1', 'Read', { file_path: '/a.png' }),
      devolve('t1', [{ type: 'image', source: { data: 'AAAA' } }]),
    );

    const [tool] = (await ler(id)).find((m) => m.tools).tools;

    assert.equal(tool.result.text, '🖼 imagem');
  });

  it('resultado sem chamada correspondente não quebra a leitura', async () => {
    const id = await givenTranscript(fala('vai'), devolve('orfao', 'sem dono'));

    const msgs = await ler(id);

    assert.equal(msgs.length, 1, 'só a fala humana');
  });

  it('ferramenta que nunca voltou fica com result nulo', async () => {
    const id = await givenTranscript(fala('vai'), usa('t1', 'Bash', { command: 'sleep 999' }));

    const [tool] = (await ler(id)).find((m) => m.tools).tools;

    assert.equal(tool.result, null);
  });

  it('corta pedido e resultado gigantes, avisando', async () => {
    const id = await givenTranscript(
      fala('vai'),
      usa('t1', 'Agent', { prompt: 'x'.repeat(50_000) }),
      devolve('t1', 'y'.repeat(50_000)),
    );

    const [tool] = (await ler(id)).find((m) => m.tools).tools;

    assert.equal(tool.inputTruncated, true);
    assert.equal(tool.result.truncated, true);
    assert.ok(tool.input.length < 5000 && tool.result.text.length < 5000);
  });

  it('várias ferramentas na mesma mensagem, cada uma com seu resultado', async () => {
    const id = await givenTranscript(
      fala('vai'),
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a' } },
          ],
        },
      },
      devolve('t2', 'conteudo de a'),
      devolve('t1', 'listagem'),
    );

    const { tools } = (await ler(id)).find((m) => m.tools);

    assert.equal(tools.length, 2);
    assert.equal(tools.find((t) => t.id === 't1').result.text, 'listagem');
    assert.equal(tools.find((t) => t.id === 't2').result.text, 'conteudo de a');
  });
});

describe('texto continua funcionando', () => {
  it('mensagem de texto puro não ganha tools', async () => {
    const id = await givenTranscript(fala('bom dia'), { type: 'assistant', message: { content: [{ type: 'text', text: 'bom dia!' }] } });

    const msgs = await ler(id);

    assert.equal(msgs.length, 2);
    assert.equal(msgs[1].text, 'bom dia!');
    assert.equal(msgs[1].tools, undefined);
  });
});
