// Painel de conversas: lista as transcrições, abre o leitor/chat e deleta.
// Este arquivo só COMPÕE componentes — a lógica visual reutilizável vive em
// public/js/components/ e o acesso a dados em public/js/core/api.js.

import { api } from '../core/api.js';
import { el, fmt, toast, confirmAction, states } from '../core/ui.js';
import { createDataTable } from '../components/data-table.js';
import { createInlineEdit } from '../components/inline-edit.js';
import { createConversationWindow, openConversationWindow } from '../components/conversation-window.js';
import { MODE_CHOICES, MODEL_CHOICES } from '../core/chat-fields.js';

// Amostras da paleta da janela — as mesmas cores vivas dos tokens do tema.
const WINDOW_COLORS = ['#ff6a45', '#ff4f8b', '#a855f7', '#3b82f6', '#06b6d4', '#17c964', '#ffb020', '#f43f5e'];

// A cor entra numa variável CSS inline, então só aceitamos hex de verdade: um valor
// torto no arquivo de config não pode virar declaração de estilo solta.
const HEX = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Estado do medidor de contexto. A janela vem do catálogo da API; quando o
 * catálogo não está disponível o servidor devolve um palpite, e aí a tela DIZ
 * que é palpite em vez de exibir um número com cara de verdade.
 */
const contextOf = (c) => ({
  tokens: c.contextTokens,
  window: c.contextWindow,
  note: c.contextWindowSource === 'guess'
    ? 'janela estimada (catálogo de modelos indisponível)'
    : c.contextNote,
});

/** `[{ id, settings }]` -> Map(id -> cor), só das conversas com cor válida. */
const colorsOf = (items) => new Map(items
  .filter((s) => HEX.test(s.settings?.color || ''))
  .map((s) => [s.id, s.settings.color]));

// Estado FORA do ciclo do painel: as janelas de conversa vivem soltas na tela (no
// <body>) e sobrevivem à navegação entre menus — quem guarda quais estão abertas é
// o `conversation-window`. `refreshList` aponta para o `load()` do painel montado
// no momento (ou null se não estamos em Conversas), pra uma resposta atualizar a
// lista só quando ela está visível.
const opening = new Set();      // ids abrindo agora (evita 2 janelas num clique-duplo)
let refreshList = null;

export default {
  id: 'conversations',
  icon: '❐',
  title: 'Conversas',
  description: 'Transcrições salvas em ~/.claude/projects — abra para ler e continuar',
  searchPlaceholder: 'filtrar por texto, projeto, data…',

  mount(root, ctx) {
    let term = ctx.search();
    const body = el('div', {});
    const info = el('span', {}, '');
    root.replaceChildren(el('div', { class: 'toolbar-line' }, info), body);
    refreshList = load; // enquanto este painel estiver montado, é ele que a lista atualiza

    /* ------------------------------------------------------------- lista */
    async function load() {
      body.replaceChildren(states.loading(4));
      try {
        // as cores vêm numa requisição só (não uma por conversa); se essa falhar,
        // a lista ainda aparece — sem cor é muito melhor que sem lista.
        const [{ items }, cfg] = await Promise.all([
          api.conversations.list(term),
          api.settings.all().catch(() => ({ items: [] })),
        ]);
        ctx.setCount(items.length);
        info.textContent = items.length
          ? `${items.length} conversa(s)${term ? ` casando com "${term}"` : ''}`
          : '';
        body.replaceChildren(table(items, colorsOf(cfg.items)));
      } catch (err) {
        body.replaceChildren(states.error(err, load));
      }
    }

    function table(items, colors) {
      return createDataTable({
        rows: items,
        // a linha da conversa que tem cor configurada nasce marcada, para achar de olho
        rowClass: (c) => (colors.has(c.id) ? 'accent' : null),
        rowStyle: (c) => (colors.has(c.id) ? `--row-accent:${colors.get(c.id)}` : null),
        empty: states.empty(
          term ? 'Nada casa com esse filtro' : 'Nenhuma conversa encontrada',
          term ? 'Tente outro termo.' : 'Converse com o Claude Code e volte aqui.'),
        columns: [
          {
            label: 'Quando',
            className: 'code',
            width: '110px',
            render: (c) => fmt.when(c.modifiedAt),
            title: (c) => fmt.clock(c.modifiedAt),
          },
          {
            label: 'Nome',
            width: '200px',
            render: (c) => rename(c).node,
          },
          {
            label: 'Projeto',
            width: '150px',
            render: (c) => el('span', { class: 'chip', title: c.project }, c.projectLabel),
          },
          { label: 'Msgs', className: 'code', width: '60px', key: 'messages' },
          {
            label: 'Contexto',
            className: 'code',
            width: '80px',
            render: (c) => (c.contextTokens != null ? fmt.compact(c.contextTokens) : '—'),
            title: (c) => (c.contextTokens != null
              ? `${c.contextTokens.toLocaleString('pt-BR')} tokens no último turno`
              : (c.contextNote || 'sem dado de uso')),
          },
          { label: 'Tam', className: 'code', width: '70px', render: (c) => fmt.bytes(c.bytes) },
          {
            label: 'Início da conversa',
            render: (c) => (c.title.length > 90 ? `${c.title.slice(0, 90)}…` : c.title),
            onClick: (c) => open(c),
          },
          {
            label: '',
            width: '150px',
            render: (c) => el('div', { class: 'actions' },
              el('button', { class: 'btn small', type: 'button', onclick: () => open(c) }, 'Ler'),
              el('button', { class: 'btn small', type: 'button', onclick: () => remove(c) }, 'Deletar')),
          },
        ],
      });
    }

    /** Célula "Nome" editável no lugar — renomear é o mesmo que /rename. */
    function rename(c) {
      return createInlineEdit({
        value: c.name || '',
        placeholder: 'nome da conversa',
        emptyLabel: 'sem nome',
        editTitle: 'Renomear (o mesmo que /rename no terminal)',
        onSave: async (name) => {
          const res = await api.conversations.rename(c.id, name);
          c.name = res.name;
          toast('Conversa renomeada.', { type: 'ok' });
        },
      });
    }

    /* --------------------------- leitor + chat em janela flutuante ------- */
    // Cada conversa abre numa janela própria: dá para abrir várias, redimensionar
    // e arrastar, e mexer no resto da página. Fechar a janela NÃO mata o processo
    // (a resposta em andamento termina em segundo plano) — matar é em Sessões.
    async function open(c) {
      const aberta = openConversationWindow(c.id);
      if (aberta) { aberta.focus(); return; }
      if (opening.has(c.id)) return;   // já tem um open() desta conversa em andamento
      opening.add(c.id);

      // preferências gravadas desta conversa (modo, cor, modelo) — sobrevivem a
      // fechar/reabrir. Falha aqui não impede abrir: só cai no padrão.
      const saved = await api.settings.get(c.id)
        .then((r) => r.settings || {})
        .catch(() => ({}))
        .finally(() => opening.delete(c.id));

      const janela = createConversationWindow({
        id: c.id,
        title: c.name || c.title,
        project: c.project,
        bytes: c.bytes,
        model: c.model,
        context: contextOf(c),
        settings: saved,
        modeChoices: MODE_CHOICES,
        modelChoices: MODEL_CHOICES,
        swatches: WINDOW_COLORS,
        fetchPage: (opts) => api.conversations.read(c.id, opts),
        send: (text, values, images, onEvent, signal) =>
          api.chat.send(c.id, { text, mode: values.mode, model: values.model, images }, onEvent, signal),
        stop: () => api.chat.stop(c.id),
        onSaveSetting: (patch) => api.settings.save(c.id, patch)
          // só a cor aparece na lista; não vale redesenhar 60 linhas por trocar de modo
          .then(() => { if ('color' in patch) refreshList?.(); })
          .catch((err) => toast(`Não deu para salvar a configuração: ${err.message}`, { type: 'err' })),
        onCompact: (j) => compact(c, j.meter, j.chat),
        onFinish: (j) => {
          j.chat.reload().catch(() => {});
          refreshMeter(c, j.meter);
          refreshList?.();   // atualiza a lista só se Conversas estiver aberto
        },
      });

      try {
        await janela.chat.start();
      } catch (err) {
        janela.win.setTitle('Erro ao ler a conversa');
        janela.win.setSubtitle(c.sessionId);
        janela.win.bodyEl.replaceChildren(states.error(err, () => { janela.win.close(); open(c); }));
        janela.win.setFooter(null);
        return;
      }
      janela.focus();
      warnIfBusy(c, janela.chat);
    }

    /**
     * Avisa **só quando é esta conversa, com certeza**: um terminal rodando
     * `claude --resume <este id>`. Nada de "tem um Claude na pasta": pasta não é
     * conversa, e aviso que não dá para confirmar é barulho — aparecia até em
     * conversa que o navegador acabou de criar.
     */
    async function warnIfBusy(c, chat) {
      try {
        const { items } = await api.sessions.list();
        // headless é execução deste painel (`claude -p`), não gente digitando —
        // e conflito nosso com o nosso já é barrado pelo 409 do serviço de chat
        const mesma = items.find((s) => s.kind !== 'headless'
          && s.conversationSource === 'args'
          && s.conversationId === c.sessionId);
        if (!mesma) return;

        chat.notice(
          `Esta conversa está aberta num terminal (PID ${mesma.pid}, ${mesma.tty || 'sem tty'}). `
          + 'Enviar daqui grava no mesmo arquivo — evite escrever nos dois ao mesmo tempo.', 'warn');
      } catch { /* aviso é bônus, não bloqueia */ }
    }

    /* -------------------------------------------------- contexto / compact */

    /** Relê o meta do transcript, atualiza o medidor e devolve o novo total. */
    async function refreshMeter(c, meter) {
      try {
        const { meta } = await api.conversations.read(c.id, { limit: 1 });
        c.contextTokens = meta.contextTokens;
        c.contextWindow = meta.contextWindow;
        c.contextWindowSource = meta.contextWindowSource;
        c.contextNote = meta.contextNote;
        meter.set(contextOf(meta));
        return meta.contextTokens;
      } catch {
        return null; /* medidor é informativo, não bloqueia */
      }
    }

    async function compact(c, meter, chat) {
      const ok = await confirmAction({
        title: 'Compactar o contexto?',
        text: 'O Claude vai resumir o histórico desta conversa e liberar contexto — '
          + 'igual ao /compact no terminal. As mensagens antigas continuam no arquivo; '
          + 'só o que ele "carrega" a cada turno diminui.',
        okLabel: 'Compactar',
        danger: false,
      });
      if (!ok) return;

      const before = meter.tokens();
      meter.setBusy(true);
      chat.composer.setLocked(true, 'compactando… aguarde para escrever');
      let failed = null;

      try {
        await api.chat.compact(c.id, {}, (event) => {
          if (event.type === 'compact' && !event.ok) failed = event.message;
          if (event.type === 'error') failed = event.message;
        });
      } catch (err) {
        failed = err.message;
      }

      meter.setBusy(false);
      chat.composer.setLocked(false);

      if (failed) {
        toast(`Não deu para compactar: ${failed}`, { type: 'err' });
        return;
      }

      chat.reload().catch(() => {});
      const after = await refreshMeter(c, meter);
      refreshList?.();

      // antes→depois: o feedback honesto que substitui a "% de progresso"
      if (before != null && after != null && after < before) {
        const pct = Math.round((1 - after / before) * 100);
        toast(`Contexto compactado: ${fmt.compact(before)} → ${fmt.compact(after)} (−${pct}%).`, { type: 'ok' });
      } else {
        toast('Contexto compactado.', { type: 'ok' });
      }
    }

    /* ------------------------------------------------------------ deletar */
    async function remove(c) {
      const ok = await confirmAction({
        title: 'Deletar conversa?',
        text: `"${c.title.slice(0, 70)}" (${c.messages} mensagens) vai para a lixeira em ~/.claude/.trash-conversas — dá para restaurar.`,
        okLabel: 'Mover para a lixeira',
      });
      if (!ok) return;

      try {
        const res = await api.conversations.remove(c.id);
        // limpa a config órfã junto (não acumular sujeira); guarda o que tinha para o Desfazer
        const prevCfg = await api.settings.remove(c.id).then((r) => r.settings || {}).catch(() => ({}));
        toast('Conversa movida para a lixeira.', {
          type: 'ok',
          action: {
            label: 'Desfazer',
            run: async () => {
              try {
                await api.conversations.restore(res.trashedAs);
                // restaurar a conversa restaura também a config que ela tinha
                if (Object.keys(prevCfg).length) await api.settings.save(c.id, prevCfg).catch(() => {});
                toast('Conversa restaurada.', { type: 'ok' });
              } catch (err) {
                toast(err.message, { type: 'err' });
              }
              load();
            },
          },
        });
        load();
      } catch (err) {
        toast(err.message, { type: 'err' });
      }
    }

    load();
    return {
      onSearch(value) { term = value; load(); },
      refresh: load,
      // sair do painel NÃO fecha as janelas — elas vivem soltas na tela. Só solta o
      // vínculo com esta lista (que some ao trocar de menu).
      destroy() { if (refreshList === load) refreshList = null; },
    };
  },
};
