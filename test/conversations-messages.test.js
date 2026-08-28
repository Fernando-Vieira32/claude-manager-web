// Leitura do histórico: uma mensagem salva volta em BLOCOS, na ordem em que as coisas
// aconteceram (`{ kind: 'text' | 'tool' | 'agent' }`), com pedido e resultado casados por
// id. Antes era `text` + `tools` no pé, o que embrulhava tudo numa caixa, perdia a ordem e
// enterrava um agente de doze minutos dentro de uma mensagem já terminada.

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
/** Os blocos de um tipo, achatados — é assim que a tela consome. */
const blocos = (msgs, kind) => msgs.flatMap((m) => m.blocks).filter((b) => b.kind === kind);
const textos = (msgs) => blocos(msgs, 'text').map((b) => b.text);

describe('ferramentas no histórico', () => {
  it('a mensagem carrega a ferramenta com pedido', async () => {
    const id = await givenTranscript(fala('rode ls'), usa('t1', 'Bash', { command: 'ls -la' }));

    const [tool] = blocos(await ler(id), 'tool');

    assert.ok(tool, 'a chamada devia ser um bloco da conversa');
    assert.equal(tool.name, 'Bash');
    assert.equal(tool.id, 't1');
    assert.match(tool.input, /ls -la/);
  });

  it('casa o resultado com a chamada pelo id', async () => {
    const id = await givenTranscript(
      fala('rode ls'),
      usa('t1', 'Bash', { command: 'ls' }),
      devolve('t1', 'um.txt\ndois.txt'),
    );

    const [tool] = blocos(await ler(id), 'tool');

    assert.equal(tool.result.text, 'um.txt\ndois.txt');
    assert.equal(tool.result.isError, false);
  });

  it('mensagem que só tem ferramenta NÃO é descartada como ruído', async () => {
    const id = await givenTranscript(fala('vai'), usa('t1', 'Read', { file_path: '/a.txt' }));

    const msgs = await ler(id);

    assert.equal(msgs.length, 2, `veio ${msgs.length} mensagem(ns): ${JSON.stringify(msgs.map((m) => m.blocks))}`);
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

    assert.ok(!textos(await ler(id)).some((t) => t.includes('⚙')), 'ferramenta é bloco, não texto');
  });

  it('prosa e chamada da MESMA mensagem viram dois blocos, na ordem', async () => {
    const id = await givenTranscript(fala('vai'), {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'vou olhar o arquivo' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } },
        ],
      },
    });

    const msg = (await ler(id)).at(-1);

    assert.deepEqual(msg.blocks.map((b) => b.kind), ['text', 'tool']);
    assert.equal(msg.blocks[0].text, 'vou olhar o arquivo');
  });

  it('propaga erro da ferramenta', async () => {
    const id = await givenTranscript(
      fala('vai'),
      usa('t1', 'Bash', { command: 'catt' }),
      devolve('t1', 'command not found', { is_error: true }),
    );

    const [tool] = blocos(await ler(id), 'tool');

    assert.equal(tool.result.isError, true);
  });

  it('resultado em blocos e imagem não estouram', async () => {
    const id = await givenTranscript(
      fala('vai'),
      usa('t1', 'Read', { file_path: '/a.png' }),
      devolve('t1', [{ type: 'image', source: { data: 'AAAA' } }]),
    );

    const [tool] = blocos(await ler(id), 'tool');

    assert.equal(tool.result.text, '🖼 imagem');
  });

  it('resultado sem chamada correspondente não quebra a leitura', async () => {
    const id = await givenTranscript(fala('vai'), devolve('orfao', 'sem dono'));

    const msgs = await ler(id);

    assert.equal(msgs.length, 1, 'só a fala humana');
  });

  it('ferramenta que nunca voltou fica com result nulo', async () => {
    const id = await givenTranscript(fala('vai'), usa('t1', 'Bash', { command: 'sleep 999' }));

    const [tool] = blocos(await ler(id), 'tool');

    assert.equal(tool.result, null);
  });

  it('corta pedido e resultado gigantes, avisando', async () => {
    const id = await givenTranscript(
      fala('vai'),
      usa('t1', 'Bash', { command: 'x'.repeat(50_000) }),
      devolve('t1', 'y'.repeat(50_000)),
    );

    const [tool] = blocos(await ler(id), 'tool');

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

    const tools = blocos(await ler(id), 'tool');

    assert.equal(tools.length, 2);
    assert.equal(tools.find((t) => t.id === 't1').result.text, 'listagem');
    assert.equal(tools.find((t) => t.id === 't2').result.text, 'conteudo de a');
  });
});

describe('agente no histórico', () => {
  const dispara = (id, description, extra = {}) => usa(id, 'Agent', { description, subagent_type: 'general-purpose', ...extra });
  const notifica = (id, { status = 'completed', result = 'lane fechada', at } = {}) => ({
    type: 'user',
    timestamp: at,
    message: {
      content: '<task-notification>\n<task-id>a96</task-id>\n'
        + `<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n`
        + `<summary>Agent "x" finished</summary>\n<result>${result}</result>\n</task-notification>`,
    },
  });

  it('o disparo é um bloco de AGENTE, não de ferramenta', async () => {
    const id = await givenTranscript(fala('solte um agente'), dispara('t1', 'Lane 1'));

    const [agente] = blocos(await ler(id), 'agent');

    assert.equal(agente.name, 'Lane 1');
    assert.equal(agente.agentType, 'general-purpose');
    assert.equal(agente.running, true);
    assert.equal(blocos(await ler(id), 'tool').length, 0);
  });

  it('o aceite do disparo NÃO o encerra — ele segue rodando', async () => {
    const id = await givenTranscript(
      fala('vai'),
      dispara('t1', 'Lane 1'),
      devolve('t1', 'Async agent launched successfully. (This tool result is internal)'),
    );

    const [agente] = blocos(await ler(id), 'agent');

    assert.equal(agente.running, true, 'em 3s ele parecia pronto — era o bug');
    assert.equal(agente.report, null);
  });

  it('o aviso de fim entrega o relatório NO BLOCO DELE, mesmo dez minutos depois', async () => {
    const id = await givenTranscript(
      fala('vai'),
      { ...dispara('t1', 'Lane 1'), timestamp: '2026-08-25T19:00:00.000Z' },
      devolve('t1', 'Async agent launched successfully.'),
      { type: 'assistant', message: { content: [{ type: 'text', text: 'enquanto isso, outra coisa' }] } },
      notifica('t1', { at: '2026-08-25T19:12:06.000Z' }),
    );

    const msgs = await ler(id);
    const [agente] = blocos(msgs, 'agent');

    assert.equal(agente.running, false);
    assert.equal(agente.report, 'lane fechada');
    assert.equal(agente.summary, 'Agent "x" finished');
    assert.equal(agente.durationMs, 12 * 60 * 1000 + 6000, 'dá para dizer quanto ele levou');
  });

  it('o aviso não vira mensagem na conversa (não é fala de ninguém)', async () => {
    const id = await givenTranscript(fala('vai'), dispara('t1', 'Lane 1'), notifica('t1'));

    const msgs = await ler(id);

    assert.equal(msgs.length, 2, 'a fala e o disparo; o aviso entrou no bloco do agente');
    assert.equal(textos(msgs).some((t) => t.includes('task-notification')), false);
  });

  it('agente que falhou fica marcado como falha', async () => {
    const id = await givenTranscript(fala('vai'), dispara('t1', 'Lane 1'), notifica('t1', { status: 'failed', result: 'estourou' }));

    const [agente] = blocos(await ler(id), 'agent');

    assert.equal(agente.status, 'failed');
    assert.equal(agente.report, 'estourou');
  });

  it('sem aviso de fim, mas o CLI diz que ninguém está de pé: "não sei", não relógio correndo', async () => {
    // acontece de verdade: o aviso pode ter ficado fora do arquivo depois de um /compact
    const id = await givenTranscript(
      fala('vai'),
      dispara('t1', 'Recon generalidade'),
      devolve('t1', 'Async agent launched successfully.'),
      { type: 'system', subtype: 'turn_duration', pendingBackgroundAgentCount: 0 },
    );

    const [agente] = blocos(await ler(id), 'agent');

    assert.equal(agente.running, false);
    assert.equal(agente.status, 'unknown');
    assert.equal(agente.summary, 'sem aviso de fim');
  });

  it('mais agentes sem aviso do que o CLI diz ter de pé: os MAIS ANTIGOS é que terminaram', async () => {
    // caso real: 3 sem aviso e o CLI dizendo 1 de pé. Marcar todos como "não sei" apagava
    // justamente quem está trabalhando; deixar todos "rodando" acenderia relógio para quem
    // morreu ontem. O número manda na quantidade, e o mais antigo é quem cai.
    const id = await givenTranscript(
      fala('vai'),
      { ...dispara('t1', 'De ontem'), timestamp: '2026-08-25T18:00:00.000Z' },
      { ...dispara('t2', 'De hoje A'), timestamp: '2026-08-26T12:00:00.000Z' },
      { ...dispara('t3', 'De hoje B'), timestamp: '2026-08-26T12:01:00.000Z' },
      { type: 'system', subtype: 'turn_duration', pendingBackgroundAgentCount: 2, timestamp: '2026-08-26T12:02:00.000Z' },
    );

    const agentes = blocos(await ler(id), 'agent');

    assert.deepEqual(agentes.map((a) => a.name), ['De ontem', 'De hoje A', 'De hoje B']);
    assert.deepEqual(agentes.map((a) => a.running), [false, true, true]);
    assert.equal(agentes[0].status, 'unknown');
    assert.equal(agentes[0].summary, 'sem aviso de fim');
  });

  it('o contador é lido NA ORDEM: aviso que chega depois dele não é julgado antes da hora', async () => {
    // foi o que aconteceu de verdade: no instante do contador havia 5 de pé, e o aviso de
    // um deles só chegou depois. Julgar com o que se sabe no FIM do arquivo derrubava o
    // agente errado.
    const id = await givenTranscript(
      fala('vai'),
      { ...dispara('t1', 'Antigo sem aviso'), timestamp: '2026-08-25T18:00:00.000Z' },
      { ...dispara('t2', 'Avisado depois'), timestamp: '2026-08-26T12:00:00.000Z' },
      { ...dispara('t3', 'Rodando'), timestamp: '2026-08-26T12:01:00.000Z' },
      { type: 'system', subtype: 'turn_duration', pendingBackgroundAgentCount: 2, timestamp: '2026-08-26T12:02:00.000Z' },
      { ...notifica('t2', { result: 'fechou' }), timestamp: '2026-08-26T12:03:00.000Z' },
    );

    const agentes = blocos(await ler(id), 'agent');

    assert.equal(agentes[0].status, 'unknown', 'o antigo é quem o contador derruba');
    assert.equal(agentes[1].report, 'fechou');
    assert.equal(agentes[2].running, true, 'este segue de pé — nenhum contador o derrubou');
  });

  it('agente disparado depois do último contador segue de pé', async () => {
    const id = await givenTranscript(
      fala('vai'),
      { type: 'system', subtype: 'turn_duration', pendingBackgroundAgentCount: 0, timestamp: '2026-08-26T12:00:00.000Z' },
      { ...dispara('t1', 'Depois do contador'), timestamp: '2026-08-26T12:05:00.000Z' },
    );

    assert.equal(blocos(await ler(id), 'agent')[0].running, true);
  });

  it('contador ausente (`null`) não decide nada', async () => {
    const id = await givenTranscript(
      fala('vai'),
      dispara('t1', 'Lane'),
      { type: 'system', subtype: 'turn_duration', pendingBackgroundAgentCount: null },
    );

    assert.equal(blocos(await ler(id), 'agent')[0].running, true);
  });

  it('com agentes de pé, quem não tem aviso segue rodando (é a verdade)', async () => {
    const id = await givenTranscript(
      fala('vai'),
      dispara('t1', 'Lane 2'),
      devolve('t1', 'Async agent launched successfully.'),
      { type: 'system', subtype: 'turn_duration', pendingBackgroundAgentCount: 1 },
    );

    assert.equal(blocos(await ler(id), 'agent')[0].running, true);
  });

  it('o aviso de fim ganha do contador (ele veio antes na conversa)', async () => {
    const id = await givenTranscript(
      fala('vai'),
      dispara('t1', 'Lane 1'),
      notifica('t1', { result: 'fechou' }),
      { type: 'system', subtype: 'turn_duration', pendingBackgroundAgentCount: 0 },
    );

    const [agente] = blocos(await ler(id), 'agent');

    assert.equal(agente.status, 'completed');
    assert.equal(agente.report, 'fechou');
  });

  it('aviso de um agente que não está nesta conversa não quebra a leitura', async () => {
    const id = await givenTranscript(fala('vai'), notifica('deOutraConversa'));

    assert.equal((await ler(id)).length, 1);
  });

  it('agente RETOMADO: o aviso vem com o id de outra chamada, e o relatório acha o cartão dele', async () => {
    // acontece de verdade: o CLI manda mensagem para um agente vivo (`SendMessage`) e o
    // aviso seguinte traz o `tool-use-id` DAQUELA chamada. Casando só pelo disparo, o
    // relatório de doze minutos não achava dono e o cartão ficava "rodando…".
    const aceite = 'Async agent launched successfully. (interno)\nagentId: aXYZ123 (internal ID)';
    const id = await givenTranscript(
      fala('vai'),
      dispara('t1', 'Lane 3'),
      devolve('t1', aceite),
      {
        type: 'user',
        message: {
          content: '<task-notification>\n<task-id>aXYZ123</task-id>\n'
            + '<tool-use-id>toolu_daMensagem</tool-use-id>\n<status>completed</status>\n'
            + '<summary>Agent "Lane 3" finished</summary>\n<result>fechou depois de retomado</result>\n'
            + '</task-notification>',
        },
      },
    );

    const [agente] = blocos(await ler(id), 'agent');

    assert.equal(agente.running, false);
    assert.equal(agente.report, 'fechou depois de retomado');
  });

  it('o id estável NÃO vai para a tela (o CLI pede para não mostrá-lo)', async () => {
    const aceite = 'Async agent launched successfully.\nagentId: aSEGREDO (internal ID)';
    const id = await givenTranscript(fala('vai'), dispara('t1', 'Lane 3'), devolve('t1', aceite));

    const [agente] = blocos(await ler(id), 'agent');

    assert.equal(JSON.stringify(agente).includes('aSEGREDO'), false);
  });

  it('agente síncrono (sem aceite) termina pelo próprio resultado', async () => {
    const id = await givenTranscript(fala('vai'), dispara('t1', 'Explore'), devolve('t1', 'achei em app/models'));

    const [agente] = blocos(await ler(id), 'agent');

    assert.equal(agente.running, false);
    assert.equal(agente.report, 'achei em app/models');
  });
});

describe('quem está de pé é da conversa, não da página', () => {
  const dispara = (id, description) => usa(id, 'Agent', { description, subagent_type: 'general-purpose' });

  it('a leitura devolve os agentes rodando mesmo quando o disparo está fora da página', async () => {
    const id = await givenTranscript(
      fala('vai'),
      { ...dispara('t1', 'Lane 2'), timestamp: '2026-08-26T12:00:00.000Z' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'seguindo' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'e mais' }] } },
    );

    // página de UMA mensagem: o disparo ficou de fora, mas ele está de pé
    const page = await repo.getConversation(id, { limit: 1 });

    assert.equal(page.messages.length, 1);
    assert.deepEqual(page.agents.map((a) => a.name), ['Lane 2']);
    assert.equal(page.agents[0].id, 't1');
    assert.equal(page.agents[0].agentType, 'general-purpose');
    assert.equal(page.agents[0].startedAt, '2026-08-26T12:00:00.000Z');
  });

  it('agente que já voltou não entra na lista', async () => {
    const id = await givenTranscript(
      fala('vai'),
      dispara('t1', 'Lane 1'),
      { type: 'user', message: { content: '<task-notification>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n<summary>fim</summary>\n<result>ok</result>\n</task-notification>' } },
    );

    assert.deepEqual((await repo.getConversation(id, { limit: 50 })).agents, []);
  });
});

describe('título da conversa na lista', () => {
  const meta = async (id) => (await repo.getConversation(id, { limit: 1 })).meta;

  it('usa a fala marcada como humana quando existe', async () => {
    const id = await givenTranscript(fala('pergunta do terminal'));

    assert.equal((await meta(id)).title, 'pergunta do terminal');
  });

  it('cai na primeira fala mesmo sem origin.kind — é o caso do chat pelo navegador', async () => {
    // o CLI headless (claude -p) não grava origin.kind; sem fallback, toda conversa
    // criada por este app aparecia como "(sem texto)" na lista
    const id = await givenTranscript({ type: 'user', message: { content: [{ type: 'text', text: 'mensagem do navegador' }] } });

    assert.equal((await meta(id)).title, 'mensagem do navegador');
  });

  it('a fala humana ganha da não marcada, mesmo vindo depois', async () => {
    const id = await givenTranscript(
      { type: 'user', message: { content: [{ type: 'text', text: 'injetada' }] } },
      fala('a que a pessoa escreveu'),
    );

    assert.equal((await meta(id)).title, 'a que a pessoa escreveu');
  });

  it('sem fala nenhuma continua "(sem texto)"', async () => {
    const id = await givenTranscript({ type: 'assistant', message: { content: [{ type: 'text', text: 'oi' }] } });

    assert.equal((await meta(id)).title, '(sem texto)');
  });

  it('ignora ruído (<system-reminder>, Caveat:)', async () => {
    const id = await givenTranscript(
      { type: 'user', message: { content: [{ type: 'text', text: '<system-reminder>algo</system-reminder>' }] } },
      { type: 'user', message: { content: [{ type: 'text', text: 'a real' }] } },
    );

    assert.equal((await meta(id)).title, 'a real');
  });
});

describe('texto continua funcionando', () => {
  it('mensagem de texto puro é um bloco de texto e nada mais', async () => {
    const id = await givenTranscript(fala('bom dia'), { type: 'assistant', message: { content: [{ type: 'text', text: 'bom dia!' }] } });

    const msgs = await ler(id);

    assert.equal(msgs.length, 2);
    assert.deepEqual(msgs[1].blocks, [{ kind: 'text', text: 'bom dia!' }]);
  });

  it('conteúdo em string (do terminal) também vira bloco de texto', async () => {
    const id = await givenTranscript({ type: 'user', origin: { kind: 'human' }, message: { content: 'digitei no terminal' } });

    assert.deepEqual(textos(await ler(id)), ['digitei no terminal']);
  });
});
