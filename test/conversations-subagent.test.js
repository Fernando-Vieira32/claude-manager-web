// Os PASSOS de um subagente (services/conversations/subagent.js + core/claude-paths.js).
//
// Nasceu de uma queixa concreta: o agente aparecia trabalhando e clicar nele não mostrava
// nada. O trabalho dele não está no arquivo da conversa — medido: zero entradas de
// sidechain em 923 transcritos —, e sim num arquivo próprio, ao lado:
//   ~/.claude/projects/<projeto>/<sessão>/subagents/agent-<agentId>.jsonl
// No mesmo formato das conversas, então quem lê conversa lê isto.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSandbox } from './helpers/sandbox.js';

let box;
let getAgentSteps;
let subagentFiles;

const PROJETO = '-tmp-teste';
const SESSAO = '11111111-2222-3333-4444-555555555555';
const ID = `${PROJETO}:${SESSAO}`;

const fala = (text) => ({ type: 'user', message: { content: [{ type: 'text', text }] } });
const usa = (id, name, input) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] },
});
const diz = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

/** Grava o transcrito de um agente onde o CLI grava. */
async function givenAgentTranscript(agentId, entries, meta) {
  const dir = path.join(box.projectsDir, PROJETO, SESSAO, 'subagents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `agent-${agentId}.jsonl`),
    `${entries.map((e) => JSON.stringify({ isSidechain: true, agentId, ...e })).join('\n')}\n`,
  );
  if (meta) {
    await fs.writeFile(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
  }
}

let settleOpenAgents;

before(async () => {
  box = await createSandbox();
  ({ getAgentSteps, settleOpenAgents } = await import('../services/conversations/subagent.js'));
  ({ subagentFiles } = await import('../core/claude-paths.js'));
  // a conversa precisa existir para o id resolver
  await fs.mkdir(path.join(box.projectsDir, PROJETO), { recursive: true });
  await fs.writeFile(path.join(box.projectsDir, PROJETO, `${SESSAO}.jsonl`), '');
});

after(() => box.cleanup());

describe('subagentFiles', () => {
  it('aponta para o arquivo do agente ao lado da conversa', () => {
    const { file, meta } = subagentFiles(ID, 'ad5b3d00de6075401');

    assert.equal(path.basename(file), 'agent-ad5b3d00de6075401.jsonl');
    assert.equal(path.basename(meta), 'agent-ad5b3d00de6075401.meta.json');
    assert.equal(path.basename(path.dirname(file)), 'subagents');
    assert.equal(path.basename(path.dirname(path.dirname(file))), SESSAO);
  });

  it('recusa id de agente que tenta escapar da pasta', () => {
    assert.throws(() => subagentFiles(ID, '../../../etc/passwd'), /id de agente inválido/);
  });

  it('recusa id de agente vazio', () => {
    assert.throws(() => subagentFiles(ID, ''), /id de agente inválido/);
  });
});

// O fantasma que motivou isto: 5 agentes de 19 DIAS com relógio correndo na faixa do
// rodapé, numa conversa sem nenhum aviso de fim e sem o contador do CLI. O transcrito dos
// cinco terminava com a resposta entregue — a informação estava lá, só não era lida.
describe('settleOpenAgents', () => {
  const aberto = (id) => [{ blocks: [{ kind: 'agent', id, running: true, name: 'Lane' }] }];
  const agente = (messages) => messages[0].blocks[0];

  describe('o transcrito dele termina FALANDO (entregou)', () => {
    before(() => givenAgentTranscript(
      'dddd1111eeee2222',
      [usa('t1', 'Bash', { command: 'git log' }), diz('Achei 7 branches')],
      { toolUseId: 'toolu_ENTREGOU' },
    ));

    it('encerra, e o texto dele vira o relatório que o aviso nunca trouxe', async () => {
      const messages = aberto('toolu_ENTREGOU');
      await settleOpenAgents(ID, messages);

      assert.equal(agente(messages).running, false);
      assert.equal(agente(messages).summary, 'terminou (sem aviso no arquivo)');
      assert.equal(agente(messages).status, 'unknown');
      assert.equal(agente(messages).report, 'Achei 7 branches');
    });
  });

  // Os dois sinais de "estava no meio" precisam ser testados SEPARADOS, senão um cobre a
  // falta do outro e a spec deixa de acusar quem apagar um deles (foi o que aconteceu).
  describe('a última coisa dele foi uma CHAMADA de ferramenta', () => {
    before(() => givenAgentTranscript(
      'ffff3333aaaa4444',
      [diz('vou olhar'), usa('t9', 'Bash', { command: 'sleep 600' })],   // sem stop_reason
      { toolUseId: 'toolu_NOMEIO' },
    ));

    it('não decide nada: ele estava no meio do trabalho', async () => {
      const messages = aberto('toolu_NOMEIO');
      await settleOpenAgents(ID, messages);

      assert.equal(agente(messages).running, true);
    });
  });

  describe('o CLI marcou `stop_reason: tool_use` na última mensagem', () => {
    before(() => givenAgentTranscript(
      'aaaa9999bbbb8888',
      [{ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'vou rodar o script' }] } }],
      { toolUseId: 'toolu_PEDIU' },
    ));

    it('não decide nada, mesmo com a última fala sendo texto', async () => {
      const messages = aberto('toolu_PEDIU');
      await settleOpenAgents(ID, messages);

      assert.equal(agente(messages).running, true);
    });
  });

  // Tentador ler "sem arquivo" como "morreu" — e errado: mataria o relógio de um agente
  // vivo cujo arquivo ainda não apareceu. Sem o transcrito, quem julga é o contador do CLI.
  describe('sem transcrito do agente', () => {
    it('não decide nada', async () => {
      const messages = aberto('toolu_SUMIU');
      await settleOpenAgents(ID, messages);

      assert.equal(agente(messages).running, true);
    });
  });

  describe('conversa sem agente aberto', () => {
    it('não toca em nada (e não vai ao disco)', async () => {
      const messages = [{ blocks: [{ kind: 'agent', id: 'x', running: false, status: 'completed' }] }];
      await settleOpenAgents(ID, messages);

      assert.equal(messages[0].blocks[0].status, 'completed');
    });
  });
});

describe('getAgentSteps', () => {
  describe('agente que trabalhou', () => {
    before(() => givenAgentTranscript(
      'aaaa1111bbbb2222',
      [fala('investigue X'), usa('t1', 'Bash', { command: 'ls -la' }), diz('achei isto')],
      { agentType: 'general-purpose', description: 'Investigar X', model: 'opus' },
    ));

    it('devolve os passos como BLOCOS, do jeito que a tela já sabe desenhar', async () => {
      const r = await getAgentSteps(ID, 'aaaa1111bbbb2222');
      const kinds = r.messages.flatMap((m) => (m.blocks || []).map((b) => b.kind));

      assert.deepEqual(kinds, ['text', 'tool', 'text']);
    });

    it('traz o meta que o CLI gravou (o que ele foi fazer, tipo e modelo)', async () => {
      const r = await getAgentSteps(ID, 'aaaa1111bbbb2222');

      assert.equal(r.meta.description, 'Investigar X');
      assert.equal(r.meta.agentType, 'general-purpose');
    });

    it('diz quando ele escreveu por último — é o sinal honesto de "ainda mexendo?"', async () => {
      const r = await getAgentSteps(ID, 'aaaa1111bbbb2222');

      assert.ok(Date.parse(r.lastActivityAt) > 0, 'lastActivityAt tem de ser uma data');
    });
  });

  describe('transcrito longo com teto', () => {
    before(() => givenAgentTranscript(
      'cccc3333dddd4444',
      [diz('um'), diz('dois'), diz('três'), diz('quatro')],
    ));

    it('devolve as ÚLTIMAS entradas (é o fim que responde "o que ele está fazendo")', async () => {
      const r = await getAgentSteps(ID, 'cccc3333dddd4444', { limit: 2 });

      assert.equal(r.total, 4);
      assert.equal(r.from, 2, 'o `from` é o que permite dizer na tela que veio cortado');
      assert.deepEqual(r.messages.map((m) => m.blocks[0].text), ['três', 'quatro']);
    });
  });

  // A tela só conhece o id do DISPARO: o id estável do agente nunca é mandado para ela (o
  // CLI pede para não mostrá-lo, e há spec disso em conversations-messages.test.js). Então
  // a tradução "id do disparo -> arquivo do agente" tem de acontecer aqui.
  describe('pedido pelo id do DISPARO', () => {
    before(() => givenAgentTranscript(
      'bbbb7777cccc8888',
      [diz('trabalhei')],
      { agentType: 'general-purpose', description: 'Lane 1', toolUseId: 'toolu_ABC123' },
    ));

    it('acha o arquivo do agente pelo `toolUseId` do meta', async () => {
      const r = await getAgentSteps(ID, 'toolu_ABC123');

      assert.equal(r.messages.length, 1);
      assert.equal(r.meta.description, 'Lane 1');
    });

    it('id do disparo que não é de agente nenhum: erro claro', async () => {
      await assert.rejects(() => getAgentSteps(ID, 'toolu_NAOEXISTE'), /não estão mais no disco/);
    });
  });

  describe('agente sem meta gravado', () => {
    before(() => givenAgentTranscript('eeee5555ffff6666', [diz('feito')]));

    it('lê os passos de todo jeito — meta ausente não pode derrubar a leitura', async () => {
      const r = await getAgentSteps(ID, 'eeee5555ffff6666');

      assert.equal(r.meta, null);
      assert.equal(r.messages.length, 1);
    });
  });

  describe('arquivo do agente já apagado pelo CLI', () => {
    it('erro que diz a verdade, e não "conversa não encontrada"', async () => {
      await assert.rejects(
        () => getAgentSteps(ID, 'naoexiste123456'),
        /não estão mais no disco/,
      );
    });
  });
});
