// Os PASSOS de um subagente: o que ele fez, entrada por entrada.
//
// Existe por uma queixa concreta: na tela o agente aparecia trabalhando, mas clicar nele
// não mostrava nada — só "relatório: trabalhando…". O relatório só chega no fim, e o
// arquivo da conversa não tem o trabalho dele. Tem um arquivo próprio, ao lado
// (`core/claude-paths.js#subagentFiles`), no mesmo formato — então a leitura é a mesma
// (`loadMessages`), e o front desenha com os mesmos componentes de sempre.
//
// Módulo separado do `repo.js` porque é outra responsabilidade: aquele lê conversa, este lê
// o subagente de uma conversa.

import fs from 'node:fs/promises';
import path from 'node:path';
import { notFound } from '../../core/http.js';
import { subagentFiles } from '../../core/claude-paths.js';
import { loadMessages } from './messages.js';

/** Teto de passos devolvidos: transcrito de agente passa de 800 KB com facilidade. */
const MAX = 400;
const SUFIXO = '.meta.json';

/**
 * @param {string} id id da conversa (`<projeto>:<sessão>`)
 * @param {string} ref id do DISPARO do agente (`tool_use`) — ou o id estável dele, quando
 *   é tudo o que a tela tem (relatório órfão)
 * @param {{limit?:number}} [opts]
 * @returns {Promise<{ref:string, meta:object|null, lastActivityAt:string|null,
 *   total:number, from:number, messages:Array<object>}>} as ÚLTIMAS `limit` entradas —
 *   é o fim que responde "o que ele está fazendo agora"
 */
export async function getAgentSteps(id, ref, { limit = MAX } = {}) {
  const { file, meta } = await resolver(id, ref);

  // Mensagem própria: "não encontrei a conversa" mandaria a pessoa procurar o erro no
  // lugar errado. O arquivo do agente é apagado quando o CLI limpa a sessão.
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) throw notFound('os passos deste agente não estão mais no disco');

  const { messages } = await loadMessages(file);
  const size = Math.min(Math.max(Number(limit) || MAX, 1), 1000);
  const start = Math.max(0, messages.length - size);

  return {
    ref,
    meta: await lerMeta(meta),
    // mtime = a última vez que ele escreveu algo. É o sinal honesto de "ainda mexendo?"
    lastActivityAt: new Date(stat.mtimeMs).toISOString(),
    total: messages.length,
    from: start,
    messages: messages.slice(start),
  };
}

/**
 * Julga os agentes que ficaram "de pé" no arquivo da conversa **pelo transcrito de cada
 * um** — a única fonte que sabe o que aconteceu com eles.
 *
 * Por que existe: o aviso de fim às vezes não chega ao arquivo, e o contador do CLI
 * (`pendingBackgroundAgentCount`) não aparece em toda conversa. Numa real, 5 agentes de **19
 * dias** seguiam com relógio correndo na faixa do rodapé: nenhum aviso, nenhum contador. Só
 * que o transcrito dos cinco terminava com a resposta entregue — a informação estava lá.
 *
 * A regra é estrutural, sem teto de tempo e sem palpite:
 *
 *  - **arquivo não existe** (o CLI já limpou, ou nunca houve) → **não decidimos nada**. Foi
 *    tentador ler isso como "morreu", e é errado: mataria o relógio de um agente vivo por
 *    causa de um arquivo que ainda não apareceu. Quem julga sem o transcrito é o contador;
 *  - **a última coisa que ele fez foi FALAR** (mensagem `assistant` cujo último bloco é
 *    texto) → ele ENTREGOU. Parou, e esse texto é o relatório que o aviso nunca trouxe;
 *  - **a última coisa foi PEDIR ferramenta** (`stop_reason: 'tool_use'`, ou último bloco é
 *    uma chamada) → ele estava no meio do trabalho: não decidimos nada, continua de pé.
 *
 * O `stop_reason` sozinho não bastava: num transcrito real a última mensagem entregue vinha
 * com o campo **ausente** (o CLI não o gravou), e o agente ficava de pé para sempre. Por isso
 * a decisão olha a estrutura — o que ele fez por último —, com o `stop_reason` só como
 * desempate a favor de "ainda trabalhando".
 *
 * Custa I/O só para agente que ficou aberto — e o `loadMessages` tem cache por mtime.
 */
export async function settleOpenAgents(id, messages) {
  const abertos = messages
    .flatMap((m) => m.blocks || [])
    .filter((b) => b.kind === 'agent' && b.running);

  for (const bloco of abertos) {
    const fim = await julgar(id, bloco.id);
    if (fim) Object.assign(bloco, fim);
  }
  return messages;
}

async function julgar(id, ref) {
  if (!ref) return null;
  const dados = await getAgentSteps(id, ref, { limit: 1 }).catch(() => null);
  if (!dados) return null;   // sem o transcrito dele não há o que julgar

  const ultima = dados.messages[dados.messages.length - 1];
  if (ultima?.role !== 'assistant') return null;        // última linha é resultado: no meio
  if (ultima.stopReason === 'tool_use') return null;    // pediu ferramenta e não voltou
  const blocos = ultima.blocks || [];
  if (blocos[blocos.length - 1]?.kind !== 'text') return null;

  const texto = blocos.filter((b) => b.text).map((b) => b.text).join('\n\n');
  return {
    running: false,
    status: 'unknown',                       // ele entregou, mas o CLI não confirmou o fim
    summary: 'terminou (sem aviso no arquivo)',
    report: texto,
  };
}

/**
 * Do id que a TELA tem para o arquivo que o CLI escreveu.
 *
 * O front pede pelo id do **disparo** (`tool_use`), o único que ele conhece: o id estável
 * do agente de propósito nunca vai para a tela — o CLI pede para não mostrá-lo, e há spec
 * garantindo isso (`test/conversations-messages.test.js`). O nome do arquivo, porém, é o id
 * estável. A tradução mora aqui: cada agente tem um `.meta.json` com o `toolUseId`.
 *
 * Tentamos o caminho direto primeiro porque um relatório órfão (agente que terminou sem a
 * tela ter visto o disparo) só tem o id estável em mão.
 */
async function resolver(id, ref) {
  const direto = subagentFiles(id, ref);
  if (await existe(direto.file)) return direto;

  const dir = path.dirname(direto.file);
  for (const nome of await fs.readdir(dir).catch(() => [])) {
    if (!nome.endsWith(SUFIXO)) continue;
    const meta = await lerMeta(path.join(dir, nome));
    if (meta?.toolUseId === ref) {
      return subagentFiles(id, nome.slice('agent-'.length, -SUFIXO.length));
    }
  }
  throw notFound('os passos deste agente não estão mais no disco');
}

const existe = (file) => fs.stat(file).then(() => true, () => false);

/** `description`, `agentType`, `model`, `toolUseId` — some se o CLI não gravou. */
async function lerMeta(file) {
  const raw = await fs.readFile(file, 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;   // meta corrompido não pode derrubar a leitura dos passos
  }
}
