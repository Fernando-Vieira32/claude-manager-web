// Segue o .jsonl de uma conversa e conta ao canal o que aparece nele.
//
// O bug que isto conserta: com a conversa rodando no TERMINAL, a janela de leitura no
// navegador mostrava uma foto. Para ver o passo seguinte era fechar e abrir. Mas é a
// mesma conversa e o mesmo arquivo — então o servidor acompanha o fim do arquivo e
// publica no canal (`channel.js`) o que for aparecendo. Quem desenha é a MESMA peça que
// já desenha o turno que o CLI começa sozinho.
//
// Lê só os bytes NOVOS (transcript é append-only): seguir um arquivo de 2MB custa um
// `stat` por segundo. Linha pela metade espera o `\n`, e caractere partido entre duas
// leituras espera o resto — daí o `StringDecoder`, e não um `toString()` cru.
//
// Não conhece HTTP nem runner: recebe o arquivo, para onde publicar e um `paused()`.

import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { transcriptEvents } from './transcript-events.js';
import { publish as publishToChannel } from './channel.js';

const INTERVAL_MS = Number(process.env.CHAT_FOLLOW_MS || 1000);

/**
 * @param {object} opts
 * @param {string} opts.file caminho do .jsonl
 * @param {(event:object) => void} opts.publish para onde vão os eventos
 * @param {() => boolean} [opts.paused] "não publique agora" — o cursor anda mesmo assim
 * @returns {{start,stop,tick,cursor}} `tick()` é público para o teste dirigir sem relógio
 */
export function createTranscriptFollower({ file, publish, paused = () => false, intervalMs = INTERVAL_MS } = {}) {
  const decoder = new StringDecoder('utf8');
  // Onde é o fim do arquivo AGORA, medido na hora da criação e de propósito em `sync`:
  // se essa marca fosse tirada só no primeiro tick, tudo que o terminal escrevesse até
  // lá seria engolido (o cursor já nasceria depois daquelas linhas). Era exatamente o
  // que acontecia — o teste do canal ficou 2s esperando um evento que nunca vinha.
  let cursor = tamanhoAgora(file);
  let resto = '';         // linha pela metade, esperando o `\n`
  let rota = { turn: false };
  let timer = null;
  let lendo = false;

  /** Um passo. Erro de leitura não é fatal: o arquivo pode nascer ou sumir a qualquer hora. */
  async function tick() {
    if (lendo) return;    // tick lento não pode atropelar o próximo
    lendo = true;
    try {
      await passo();
    } catch {
      /* ilegível agora: tenta no próximo tick */
    } finally {
      lendo = false;
    }
  }

  async function passo() {
    const stat = await fs.stat(file).catch(() => null);
    // conversa recém-criada: o arquivo aparece só quando a primeira resposta chega
    if (!stat) { cursor = null; return; }
    // começamos a olhar DO FIM: o que já aconteceu a janela leu do disco ao abrir, e
    // republicar isso seria mostrar a conversa duas vezes
    if (cursor === null) { cursor = stat.size; return; }
    // arquivo reescrito (encolheu): o fio se perdeu. Recomeça do novo fim e esquece o
    // turno que estávamos seguindo, senão o conteúdo seguinte entraria numa bolha que
    // não é dele — e sem `autoStart` nenhum a tela não teria como saber que começou algo.
    if (stat.size < cursor) {
      cursor = stat.size;
      resto = '';
      rota = { turn: false };
      return;
    }
    if (stat.size === cursor) return;

    const bytes = await ler(stat.size - cursor);
    cursor += bytes.length;
    const linhas = (resto + decoder.write(bytes)).split('\n');
    resto = linhas.pop();     // sem `\n` no fim: a última linha ainda está sendo escrita
    // resposta NOSSA tem stream próprio; publicar daqui também mostraria tudo em dobro.
    // O cursor anda de qualquer jeito, senão ao voltar despejaríamos o histórico inteiro.
    if (paused()) return;
    for (const linha of linhas) entregar(linha);
  }

  async function ler(tamanho) {
    const handle = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(tamanho);
      const { bytesRead } = await handle.read(buf, 0, tamanho, cursor);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  function entregar(linha) {
    const { state, events } = transcriptEvents(linha, rota);
    rota = state;
    for (const event of events) publish(event);
  }

  const api = {
    tick,
    get cursor() { return cursor; },

    start() {
      if (timer) return api;
      timer = setInterval(() => { tick(); }, intervalMs);
      timer.unref?.();   // seguir um arquivo não é motivo para o processo não morrer
      return api;
    },

    stop() {
      clearInterval(timer);
      timer = null;
      return api;
    },
  };

  return api;
}

/** Tamanho do arquivo agora, ou `null` se ele ainda não existe (conversa recém-criada). */
function tamanhoAgora(file) {
  try {
    return statSync(file).size;
  } catch {
    return null;
  }
}

/** conversationId -> { follower, count } — um seguidor por conversa, N janelas ouvindo */
const seguidores = new Map();

/**
 * Acompanha esta conversa enquanto alguém estiver ouvindo. Dois navegadores abertos na
 * mesma conversa compartilham UM seguidor: dois lendo o mesmo arquivo publicariam cada
 * linha duas vezes no canal.
 *
 * @returns {() => void} solta — quem chama é quem solta (a rota, no `close`). Chamar
 *   duas vezes é inofensivo: `close` e `error` do mesmo pedido disparam os dois.
 */
export function followTranscript(conversationId, { file, paused } = {}) {
  const entry = seguidores.get(conversationId) || criar(conversationId, { file, paused });
  entry.count += 1;
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    entry.count -= 1;
    if (entry.count > 0) return;
    entry.follower.stop();
    if (seguidores.get(conversationId) === entry) seguidores.delete(conversationId);
  };
}

function criar(conversationId, { file, paused }) {
  const entry = { count: 0 };
  entry.follower = createTranscriptFollower({
    file,
    paused,
    publish: (event) => publishToChannel(conversationId, event),
  });
  seguidores.set(conversationId, entry);
  entry.follower.start();
  return entry;
}

/** Quantos seguidores vivos — para teste e diagnóstico. */
export const followerCount = () => seguidores.size;
