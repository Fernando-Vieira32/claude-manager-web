// Uma linha do transcript virando evento de canal (services/chat/transcript-events.js).
//
// O caso que dói: a conversa está rodando NO TERMINAL e a janela do navegador mostra uma
// foto — para ver o passo seguinte era fechar e abrir. É a mesma conversa e o mesmo
// arquivo, então o que aparece no arquivo tem de virar evento na tela.
//
// As linhas daqui são as de um transcript de verdade (lidas de um `.jsonl` do
// ~/.claude/projects): `assistant` com `thinking`/`text`/`tool_use`, `user` com
// `tool_result`, e o `system/turn_duration` que marca o fim do turno.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptEvents } from '../services/chat/transcript-events.js';

const FECHADO = { turn: false };
const ABERTO = { turn: true };

const linha = (obj) => JSON.stringify(obj);
const tipos = (r) => r.events.map((e) => e.type);

const assistente = (content) => linha({ type: 'assistant', message: { role: 'assistant', content } });
const doUsuario = (content, extra = {}) => linha({ type: 'user', message: { role: 'user', content }, ...extra });
const fimDeTurno = linha({ type: 'system', subtype: 'turn_duration', durationMs: 12 });

describe('transcriptEvents', () => {
  describe('o turno começa', () => {
    it('a primeira linha do assistente abre o turno e diz que veio do terminal', () => {
      const r = transcriptEvents(assistente([{ type: 'text', text: 'oi' }]), FECHADO);

      assert.deepEqual(tipos(r), ['autoStart', 'message']);
      assert.equal(r.events[0].source, 'terminal');
      assert.deepEqual(r.state, ABERTO);
    });

    it('só pensamento também abre: esperar o texto deixaria a tela parada', () => {
      const r = transcriptEvents(assistente([{ type: 'thinking', thinking: '…' }]), FECHADO);

      assert.deepEqual(tipos(r), ['autoStart']);
      assert.deepEqual(r.state, ABERTO);
    });

    it('a linha seguinte NÃO abre outro turno', () => {
      const r = transcriptEvents(assistente([{ type: 'text', text: 'mais' }]), ABERTO);

      assert.deepEqual(tipos(r), ['message']);
      assert.deepEqual(r.state, ABERTO);
    });
  });

  describe('ferramenta', () => {
    it('o pedido vira `tool` com id, nome e resumo', () => {
      const r = transcriptEvents(
        assistente([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
        ABERTO,
      );

      assert.deepEqual(tipos(r), ['tool']);
      assert.equal(r.events[0].id, 'toolu_1');
      assert.equal(r.events[0].name, 'Bash');
      assert.equal(r.events[0].summary, 'ls');
    });

    it('o resultado vira `toolResult` casado pelo id — e NÃO é fala de ninguém', () => {
      const r = transcriptEvents(
        doUsuario([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saída' }]),
        ABERTO,
      );

      assert.deepEqual(tipos(r), ['toolResult']);
      assert.equal(r.events[0].id, 'toolu_1');
      assert.equal(r.events[0].text, 'saída');
    });

    it('resultado E fala na MESMA entrada: saem os dois, o do turno primeiro', () => {
      // acontece de verdade: você digita no terminal enquanto uma ferramenta roda, e o
      // CLI grava o resultado dela junto com a sua mensagem
      const r = transcriptEvents(
        doUsuario([
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'saída' },
          { type: 'text', text: 'e faz isso também' },
        ]),
        ABERTO,
      );

      assert.deepEqual(tipos(r), ['toolResult', 'peer']);
      assert.equal(r.events[1].text, 'e faz isso também');
    });

    it('resultado com o turno fechado abre a bolha: melhor mostrar solto que sumir', () => {
      const r = transcriptEvents(
        doUsuario([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saída' }]),
        FECHADO,
      );

      assert.deepEqual(tipos(r), ['autoStart', 'toolResult']);
    });
  });

  describe('o turno termina', () => {
    it('o `turn_duration` encerra a bolha', () => {
      const r = transcriptEvents(fimDeTurno, ABERTO);

      assert.deepEqual(tipos(r), ['autoEnd']);
      assert.deepEqual(r.state, FECHADO);
    });

    it('sem turno aberto não encerra nada (não pisca bolha à toa)', () => {
      assert.deepEqual(transcriptEvents(fimDeTurno, FECHADO), { state: FECHADO, events: [] });
    });
  });

  describe('alguém digitando no terminal', () => {
    it('vira uma fala no feed, com o horário dela', () => {
      const r = transcriptEvents(
        doUsuario('e agora arruma isso', { timestamp: '2026-08-25T19:00:00.000Z' }),
        FECHADO,
      );

      assert.deepEqual(tipos(r), ['peer']);
      assert.deepEqual(r.events[0], {
        type: 'peer', role: 'user', text: 'e agora arruma isso', at: '2026-08-25T19:00:00.000Z',
      });
    });

    it('conteúdo em blocos também é fala', () => {
      const r = transcriptEvents(doUsuario([{ type: 'text', text: 'olha isso' }]), FECHADO);
      assert.equal(r.events[0].text, 'olha isso');
    });

    it('NÃO fecha o turno em andamento: no terminal a mensagem entra na fila', () => {
      const r = transcriptEvents(doUsuario('mais uma coisa'), ABERTO);

      assert.deepEqual(tipos(r), ['peer']);
      assert.deepEqual(r.state, ABERTO);
    });

    it('marcador do CLI não é fala de gente', () => {
      for (const ruido of ['<system-reminder>x</system-reminder>', 'Caveat: isto é aviso']) {
        assert.deepEqual(transcriptEvents(doUsuario(ruido), FECHADO), { state: FECHADO, events: [] });
      }
    });

    it('imagem colada no terminal aparece como marca, não como base64', () => {
      const r = transcriptEvents(doUsuario([{ type: 'image', source: { data: 'AAAA' } }]), FECHADO);
      assert.equal(r.events[0].text, '🖼 imagem');
    });
  });

  describe('agente em segundo plano', () => {
    const notificacao = (extra = '') => doUsuario(
      '<task-notification>\n<task-id>a96</task-id>\n<tool-use-id>toolu_7</tool-use-id>\n'
      + `<status>completed</status>\n<summary>Agent "Lane 1" finished</summary>\n<result>fechou a lane</result>${extra}\n`
      + '</task-notification>',
    );

    it('o disparo vira `agentStart`, não uma ferramenta comum', () => {
      const r = transcriptEvents(
        assistente([{ type: 'tool_use', id: 'toolu_7', name: 'Agent', input: { description: 'Lane 1', subagent_type: 'general-purpose' } }]),
        ABERTO,
      );

      assert.deepEqual(tipos(r), ['agentStart']);
      assert.equal(r.events[0].name, 'Lane 1');
      assert.equal(r.events[0].agentType, 'general-purpose');
    });

    it('o aceite do disparo vem marcado como `ack` — não é trabalho entregue', () => {
      const r = transcriptEvents(
        doUsuario([{ type: 'tool_result', tool_use_id: 'toolu_7', content: 'Async agent launched successfully. (interno)' }]),
        ABERTO,
      );

      assert.deepEqual(tipos(r), ['toolResult']);
      assert.equal(r.events[0].ack, true);
    });

    it('resultado de ferramenta comum NÃO vem marcado', () => {
      const r = transcriptEvents(
        doUsuario([{ type: 'tool_result', tool_use_id: 'toolu_8', content: 'saída' }]),
        ABERTO,
      );

      assert.equal(r.events[0].ack, false);
    });

    it('o fim dele vira `agentEnd`, com o relatório e o id do disparo', () => {
      const r = transcriptEvents(notificacao(), ABERTO);

      assert.deepEqual(tipos(r), ['agentEnd']);
      assert.equal(r.events[0].id, 'toolu_7');
      assert.equal(r.events[0].summary, 'Agent "Lane 1" finished');
      assert.equal(r.events[0].result, 'fechou a lane');
      assert.equal(r.events[0].status, 'completed');
    });

    it('e NÃO abre turno: o aviso chega sozinho, minutos depois', () => {
      const r = transcriptEvents(notificacao(), FECHADO);

      assert.deepEqual(tipos(r), ['agentEnd']);
      assert.deepEqual(r.state, FECHADO);
    });

    it('nem fecha o turno que estiver aberto', () => {
      assert.deepEqual(transcriptEvents(notificacao(), ABERTO).state, ABERTO);
    });

    it('o aviso não vira fala de gente', () => {
      const r = transcriptEvents(notificacao(), ABERTO);
      assert.equal(r.events.some((e) => e.type === 'peer'), false);
    });
  });

  describe('linhas que não são do turno', () => {
    it('as marcações internas do CLI são ignoradas', () => {
      const ignoradas = [
        { type: 'queue-operation', operation: 'enqueue' },
        { type: 'attachment' },
        { type: 'file-history-snapshot' },
        { type: 'ai-title', aiTitle: 'x' },
        { type: 'custom-title', customTitle: 'x' },
        { type: 'system', subtype: 'status' },
      ];
      for (const entry of ignoradas) {
        assert.deepEqual(transcriptEvents(linha(entry), FECHADO), { state: FECHADO, events: [] }, entry.type);
      }
    });

    it('linha pela metade não estoura nem inventa evento', () => {
      assert.deepEqual(transcriptEvents('{"type":"assis', ABERTO), { state: ABERTO, events: [] });
    });

    it('linha vazia, nula ou sem chaves idem', () => {
      for (const bruto of ['', '   ', null, undefined, 'texto solto']) {
        assert.deepEqual(transcriptEvents(bruto, ABERTO), { state: ABERTO, events: [] });
      }
    });

    it('sem estado assume turno fechado', () => {
      assert.deepEqual(tipos(transcriptEvents(assistente([{ type: 'text', text: 'oi' }]))), ['autoStart', 'message']);
    });
  });
});
