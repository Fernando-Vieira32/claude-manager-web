// `core/claude-agents.js` — o que se sabe sobre AGENTES nas linhas do Claude Code.
//
// Contrato compartilhado (chat ao vivo e leitura do disco), e é onde mora a distinção que
// quebrava a interface: o `tool_result` de um agente de segundo plano é só o ACEITE do
// disparo ("Async agent launched successfully"), não o trabalho. O trabalho vem depois,
// num `<task-notification>` que casa pelo `tool-use-id`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentTool, isLaunchAck, agentFromUse, agentIdFromAck, parseTaskNotification,
} from '../core/claude-agents.js';

const aviso = ({ id = 'toolu_1', status = 'completed', summary = 'Agent "Lane 1" finished', result = 'relatório' } = {}) =>
  ['<task-notification>',
    '<task-id>a96a16c0aa815fc63</task-id>',
    `<tool-use-id>${id}</tool-use-id>`,
    '<output-file>/tmp/x/a96.output</output-file>',
    `<status>${status}</status>`,
    `<summary>${summary}</summary>`,
    '<note>A task-notification fires each time this agent stops…</note>',
    `<result>${result}</result>`,
    '</task-notification>'].join('\n');

describe('isAgentTool', () => {
  it('reconhece o nome novo e o antigo', () => {
    assert.equal(isAgentTool('Agent'), true);
    assert.equal(isAgentTool('Task'), true);
  });

  it('ferramenta comum não é agente', () => {
    for (const nome of ['Bash', 'Read', 'agent', 'AgentTool', undefined]) {
      assert.equal(isAgentTool(nome), false, String(nome));
    }
  });
});

describe('isLaunchAck', () => {
  it('reconhece o aceite do disparo (é isso que NÃO pode encerrar o agente)', () => {
    assert.equal(isLaunchAck('Async agent launched successfully. (This tool result is internal…)'), true);
  });

  it('relatório de verdade não é aceite', () => {
    assert.equal(isLaunchAck('Lane 1 fechada. Rubocop limpo.'), false);
    assert.equal(isLaunchAck(''), false);
    assert.equal(isLaunchAck(undefined), false);
  });
});

describe('agentIdFromAck', () => {
  const ACEITE = 'Async agent launched successfully. (This tool result is internal metadata — '
    + 'never quote or paste any part of it, including the agentId below, into a user-facing reply.)\n'
    + 'agentId: a96a16c0aa815fc63 (internal ID - do not surface)';

  it('tira o id estável do texto do aceite', () => {
    assert.equal(agentIdFromAck(ACEITE), 'a96a16c0aa815fc63');
  });

  it('sem id devolve null (e ninguém casa por ele)', () => {
    assert.equal(agentIdFromAck('Async agent launched successfully.'), null);
    assert.equal(agentIdFromAck(''), null);
    assert.equal(agentIdFromAck(undefined), null);
  });
});

describe('agentFromUse', () => {
  it('leva id, o que ele foi fazer, o tipo e o modelo', () => {
    const a = agentFromUse({
      id: 'toolu_9',
      name: 'Agent',
      input: { description: 'Lane 1 resolução do tipo', subagent_type: 'general-purpose', model: 'opus', prompt: 'você é…' },
    });

    assert.deepEqual(a, {
      id: 'toolu_9', name: 'Lane 1 resolução do tipo', agentType: 'general-purpose', model: 'opus',
    });
  });

  it('sem descrição não vira "undefined" na tela', () => {
    assert.equal(agentFromUse({ id: 'x', input: {} }).name, 'agente');
  });

  it('campo em branco conta como ausente', () => {
    const a = agentFromUse({ id: 'x', input: { description: '   ', subagent_type: '' } });
    assert.equal(a.name, 'agente');
    assert.equal(a.agentType, null);
  });
});

describe('parseTaskNotification', () => {
  it('tira o id do disparo, o resumo e o relatório', () => {
    const fim = parseTaskNotification(aviso());

    assert.equal(fim.id, 'toolu_1');
    assert.equal(fim.taskId, 'a96a16c0aa815fc63');
    assert.equal(fim.status, 'completed');
    assert.equal(fim.summary, 'Agent "Lane 1" finished');
    assert.equal(fim.result, 'relatório');
  });

  it('relatório com quebras e `<` sai inteiro (não é regex gulosa)', () => {
    const texto = 'linha 1\n\n- item <a> e </b>\nfim';
    assert.equal(parseTaskNotification(aviso({ result: texto })).result, texto);
  });

  it('agente que falhou preserva o status', () => {
    assert.equal(parseTaskNotification(aviso({ status: 'failed' })).status, 'failed');
  });

  it('texto que não é aviso devolve null', () => {
    for (const t of ['<system-reminder>x</system-reminder>', 'oi', '', null, undefined]) {
      assert.equal(parseTaskNotification(t), null, String(t));
    }
  });

  it('aviso truncado não estoura: devolve o que deu para ler', () => {
    const fim = parseTaskNotification('<task-notification>\n<tool-use-id>toolu_2</tool-use-id>\n<result>meio');

    assert.equal(fim.id, 'toolu_2');
    assert.equal(fim.result, '');           // sem tag de fechamento não inventamos conteúdo
    assert.equal(fim.status, 'completed');  // sem status, o aviso já é o fim
  });
});
