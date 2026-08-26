// Seguir o arquivo de uma conversa (services/chat/follow.js).
//
// O bug que isto conserta: conversa rodando no TERMINAL, janela aberta no navegador, e a
// tela parada — só fechando e abrindo aparecia o passo novo. Aqui o arquivo é de verdade
// (pasta temporária) e o `tick()` é chamado à mão: teste de leitura de arquivo não deve
// depender de relógio.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTranscriptFollower, followTranscript, followerCount } from '../services/chat/follow.js';
import { subscribe } from '../services/chat/channel.js';

const assistente = (texto) =>
  `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: texto }] } })}\n`;
const fala = (texto) =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: texto } })}\n`;
const fimDeTurno = `${JSON.stringify({ type: 'system', subtype: 'turn_duration' })}\n`;

describe('createTranscriptFollower', () => {
  let dir;
  let file;
  let eventos;
  let pausado;
  let seguidor;

  const tipos = () => eventos.map((e) => e.type);
  const escrever = (texto) => fs.appendFile(file, texto, 'utf8');

  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmw-follow-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  beforeEach(async () => {
    file = path.join(dir, `${Math.floor(performance.now() * 1000)}.jsonl`);
    await fs.writeFile(file, '', 'utf8');
    eventos = [];
    pausado = false;
    seguidor = createTranscriptFollower({
      file,
      publish: (e) => eventos.push(e),
      paused: () => pausado,
      intervalMs: 5,
    });
    await seguidor.tick();     // primeiro passo: marca onde é o fim de hoje
  });

  describe('o que acontece a partir de agora', () => {
    it('linha nova vira evento', async () => {
      await escrever(assistente('trabalhando aqui'));
      await seguidor.tick();

      assert.deepEqual(tipos(), ['autoStart', 'message']);
      assert.equal(eventos[0].source, 'terminal');
      assert.equal(eventos[1].text, 'trabalhando aqui');
    });

    it('um turno inteiro sai na ordem', async () => {
      await escrever(assistente('vou olhar') + fimDeTurno + fala('olha isso'));
      await seguidor.tick();

      assert.deepEqual(tipos(), ['autoStart', 'message', 'autoEnd', 'peer']);
    });

    it('nada novo no arquivo não gera evento nenhum', async () => {
      await seguidor.tick();
      await seguidor.tick();
      assert.deepEqual(eventos, []);
    });

    it('o que JÁ estava no arquivo não é republicado (a janela leu do disco ao abrir)', async () => {
      await fs.writeFile(path.join(dir, 'velha.jsonl'), assistente('conversa de ontem'), 'utf8');
      const outro = createTranscriptFollower({
        file: path.join(dir, 'velha.jsonl'),
        publish: (e) => eventos.push(e),
      });

      await outro.tick();
      await outro.tick();
      assert.deepEqual(eventos, []);
    });
  });

  describe('o arquivo está sendo escrito agora', () => {
    it('linha pela metade espera o fim da linha', async () => {
      const completa = assistente('meia linha');
      const corte = completa.length - 12;
      await escrever(completa.slice(0, corte));
      await seguidor.tick();
      assert.deepEqual(eventos, []);

      await escrever(completa.slice(corte));
      await seguidor.tick();
      assert.deepEqual(tipos(), ['autoStart', 'message']);
    });

    it('caractere partido entre duas leituras não vira lixo', async () => {
      const bytes = Buffer.from(assistente('coração partido'), 'utf8');
      const meio = bytes.indexOf(Buffer.from('ç', 'utf8')) + 1;   // no MEIO do "ç"
      await fs.appendFile(file, bytes.subarray(0, meio));
      await seguidor.tick();
      await fs.appendFile(file, bytes.subarray(meio));
      await seguidor.tick();

      assert.deepEqual(tipos(), ['autoStart', 'message']);
      assert.equal(eventos[1].text, 'coração partido');
    });
  });

  describe('pausado (a resposta é NOSSA e já tem stream próprio)', () => {
    it('não publica nada', async () => {
      pausado = true;
      await escrever(assistente('isto sai pelo SSE do turno'));
      await seguidor.tick();
      assert.deepEqual(eventos, []);
    });

    it('e ao voltar NÃO despeja o que passou — o cursor andou', async () => {
      pausado = true;
      await escrever(assistente('resposta nossa'));
      await seguidor.tick();

      pausado = false;
      await escrever(assistente('agora é o terminal'));
      await seguidor.tick();

      assert.deepEqual(tipos(), ['autoStart', 'message']);
      assert.equal(eventos[1].text, 'agora é o terminal');
    });
  });

  describe('arquivo estranho', () => {
    it('arquivo que ainda não existe: espera sem estourar', async () => {
      const futuro = createTranscriptFollower({
        file: path.join(dir, 'nao-existe-ainda.jsonl'),
        publish: (e) => eventos.push(e),
      });

      await futuro.tick();
      await futuro.tick();
      assert.deepEqual(eventos, []);
      assert.equal(futuro.cursor, null);
    });

    it('arquivo que encolheu (reescrito) recomeça do novo fim, sem despejar nada', async () => {
      await escrever(assistente('linha 1') + assistente('linha 2'));
      await seguidor.tick();
      eventos.length = 0;

      await fs.writeFile(file, '', 'utf8');
      await seguidor.tick();
      assert.deepEqual(eventos, []);
      assert.equal(seguidor.cursor, 0);

      await escrever(assistente('depois da reescrita'));
      await seguidor.tick();
      assert.deepEqual(tipos(), ['autoStart', 'message']);
    });
  });

  describe('o relógio', () => {
    it('start() acompanha sozinho; stop() para de acompanhar', async () => {
      seguidor.start();
      await escrever(assistente('sem ninguém chamar tick'));
      await esperar(() => eventos.length >= 2);

      seguidor.stop();
      eventos.length = 0;
      await escrever(assistente('depois do stop'));
      await new Promise((r) => setTimeout(r, 40));
      assert.deepEqual(eventos, []);
    });
  });
});

describe('followTranscript', () => {
  let dir;
  let file;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmw-follow2-'));
    file = path.join(dir, 'sessao.jsonl');
    await fs.writeFile(file, '', 'utf8');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('o que aparece no arquivo chega a quem ouve o canal da conversa', async () => {
    const id = '-tmp-follow:sessao-1';
    const recebidos = [];
    subscribe(id, { closed: false, send: (e) => recebidos.push(e) });
    const solta = followTranscript(id, { file, paused: () => false });

    try {
      await fs.appendFile(file, assistente('o terminal está trabalhando'), 'utf8');
      await esperar(() => recebidos.length >= 2);
      assert.deepEqual(recebidos.map((e) => e.type), ['autoStart', 'message']);
    } finally {
      solta();
    }
  });

  it('duas janelas na mesma conversa compartilham UM seguidor (senão sai em dobro)', () => {
    const id = '-tmp-follow:sessao-2';
    const antes = followerCount();
    const a = followTranscript(id, { file, paused: () => false });
    const b = followTranscript(id, { file, paused: () => false });

    assert.equal(followerCount(), antes + 1);
    a();
    assert.equal(followerCount(), antes + 1, 'ainda tem uma janela ouvindo');
    b();
    assert.equal(followerCount(), antes);
  });

  it('soltar duas vezes não derruba o seguidor da outra janela', () => {
    const id = '-tmp-follow:sessao-3';
    const antes = followerCount();
    const a = followTranscript(id, { file, paused: () => false });
    const b = followTranscript(id, { file, paused: () => false });

    a();
    a();
    assert.equal(followerCount(), antes + 1);
    b();
    assert.equal(followerCount(), antes);
  });
});

/** Espera uma condição virar verdade (o seguidor tem relógio próprio). */
async function esperar(condicao, limiteMs = 2000) {
  const fim = performance.now() + limiteMs;
  while (performance.now() < fim) {
    if (condicao()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('a condição não aconteceu no tempo esperado');
}
