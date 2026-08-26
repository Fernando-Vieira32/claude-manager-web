// Uma linha do TRANSCRIPT (.jsonl) → eventos do canal da conversa.
//
// Existe por um pedido concreto: abrir no navegador uma conversa que está sendo
// conduzida NO TERMINAL e ver o que acontece. Antes a leitura era uma foto — para ver o
// passo seguinte era fechar e abrir a janela. Só que navegador e terminal são a MESMA
// conversa, o mesmo arquivo; então é do arquivo que o navegador se informa.
//
// O transcript NÃO é o stream-json do `-p`: não tem linha `result`, e o fim do turno é
// um `system/turn_duration`. O que os dois têm igual são as linhas `assistant` e `user`
// (mesmo envelope `message.content`) — e por isso a tradução delas é a MESMA de sempre
// (`stream.js`). Um tradutor, não dois que divergem com o tempo.
//
// Regra pura de propósito: linha entra, eventos saem. Sem fs, sem HTTP, sem timer — é o
// que permite spec de verdade em vez de conferência no navegador.

import { forward } from './stream.js';
import { messageText, isNoiseText } from '../../core/claude-blocks.js';

/** Teto do texto de uma fala vinda do terminal (o mesmo do leitor de conversas). */
const MAX_FALA = 4000;

/**
 * @param {string} line uma linha crua do .jsonl
 * @param {{turn:boolean}} state `turn` = já há um turno aberto na tela
 * @returns {{state:{turn:boolean}, events:object[]}} eventos do canal, na ordem:
 *   `autoStart` (com `source: 'terminal'`) · eventos de stream (`message`, `tool`,
 *   `toolResult`…) · `autoEnd` no fim do turno · `peer` para fala digitada no terminal
 */
export function transcriptEvents(line, state = { turn: false }) {
  const turn = Boolean(state?.turn);
  const entry = parse(line);
  if (!entry) return { state: { turn }, events: [] };

  // fim do turno. Sem turno aberto não há o que encerrar: o `autoEnd` fecharia a bolha
  // de outra coisa (ou nenhuma) e viraria um piscar sem sentido na tela
  if (entry.type === 'system' && entry.subtype === 'turn_duration') {
    return { state: { turn: false }, events: turn ? [{ type: 'autoEnd' }] : [] };
  }

  const doTurno = translate(line);
  const fala = humanText(entry);
  // linha de `assistant` abre o turno mesmo sem render nenhum: o primeiro bloco costuma
  // ser `thinking`, e esperar pelo texto deixaria a tela parada por vários segundos
  // exatamente quando o Claude começou a trabalhar
  // Aviso de fim de agente NÃO é conteúdo de turno: ele chega sozinho, minutos depois do
  // disparo. Deixá-lo abrir um turno acenderia uma bolha viva que nada iria fechar.
  const soAgente = doTurno.length > 0 && doTurno.every((e) => e.type === 'agentEnd');
  const abre = !soAgente && (doTurno.length > 0 || entry.type === 'assistant');
  // Os dois podem estar na MESMA entrada: quando você digita no terminal enquanto uma
  // ferramenta roda, o CLI grava o resultado dela e a sua fala juntos. Escolher um dos
  // dois perderia o outro — então saem os dois, o do turno primeiro.
  const abertura = abre && !turn ? [{ type: 'autoStart', source: 'terminal' }] : [];
  const dela = fala ? [{ type: 'peer', role: 'user', text: fala, at: entry.timestamp || null }] : [];
  return { state: { turn: abre || turn }, events: [...abertura, ...doTurno, ...dela] };
}

/** Linha ilegível é ignorada em silêncio: transcript truncado é normal, não é aviso. */
function parse(line) {
  const raw = String(line || '').trim();
  if (!raw.startsWith('{')) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Alguém DIGITOU isto no terminal? Só entrada `user`, e só o que for texto: bloco de
 * `tool_result` é o CLI devolvendo resultado ao modelo (isso é do turno, e o
 * `messageText` já não o lê como texto), e marcador do CLI não é fala de gente.
 */
function humanText(entry) {
  if (entry.type !== 'user') return '';
  const text = messageText(entry.message?.content).trim();
  return isNoiseText(text) ? '' : text.slice(0, MAX_FALA);
}

/** Eventos de stream desta linha — o coletor no lugar do SSE, como nos testes. */
function translate(line) {
  const out = [];
  forward(line, { send: (event) => out.push(event) });
  return out;
}
