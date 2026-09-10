// Painel "Nova conversa" — a tela inicial. É um LANÇADOR: escolha modelo, pasta e
// modo, escreva a primeira mensagem, e a conversa abre na mesma janela flutuante
// de quando você clica em "Ler" na lista.
//
// Antes a conversa nascia e ficava embutida neste painel: dois lugares diferentes
// para a mesma coisa, e você perdia a conversa de vista ao trocar de aba. Hoje os
// dois caminhos compõem o mesmo `conversation-window` — painel não importa painel,
// a peça compartilhada é componente.
//
// A única lógica daqui é o "criar-ou-continuar": a primeira mensagem nasce a
// conversa (api.chat.start, que gera o session-id no servidor); as seguintes
// continuam nela (api.chat.send). O id vem no evento `init`.

import { api } from '../core/api.js';
import { el, toast } from '../core/ui.js';
import { createComposer } from '../components/composer.js';
import { createChoiceSelect } from '../components/choice-select.js';
import { createDirField } from '../components/dir-field.js';
import { createConversationWindow } from '../components/conversation-window.js';
import { MODE_CHOICES, MODEL_CHOICES } from '../core/chat-fields.js';

// Mesmas amostras da janela de Conversas — a cor é preferência da conversa.
const WINDOW_COLORS = ['#ff6a45', '#ff4f8b', '#a855f7', '#3b82f6', '#06b6d4', '#17c964', '#ffb020', '#f43f5e'];

/** rótulo + controle, no visual da barra de configuração. */
function field(label, ...nodes) {
  return el('label', { class: 'setup-field' }, el('span', { class: 'setup-key' }, label), ...nodes);
}

export default {
  id: 'new',
  icon: '＋',
  navTitle: 'Nova conversa',
  title: 'Nova conversa',
  description: 'Comece uma conversa nova com o Claude — ela abre numa janela própria',
  searchPlaceholder: false,

  async mount(root) {
    // pasta padrão: a mais recente com conversa, senão o HOME do servidor
    let inicial = '';
    try { inicial = (await api.fs.browse()).path; } catch { /* segue sem HOME */ }
    try {
      const { items } = await api.conversations.list();
      inicial = items.map((c) => c.project).filter(Boolean)[0] || inicial;
    } catch { /* fica o HOME */ }

    /* --- barra de configuração: 3 componentes reutilizáveis, nada inline --- */
    const model = createChoiceSelect({
      choices: MODEL_CHOICES, value: 'opus', allowCustom: true,
      customLabel: 'versão específica…', customPlaceholder: 'ex.: claude-opus-4-8',
      title: 'alias = última versão; para fixar uma versão use "versão específica…" (ex.: claude-opus-4-8)',
    });
    const dir = createDirField({ browse: api.fs.browse, value: inicial });
    const mode = createChoiceSelect({
      choices: MODE_CHOICES, value: 'none', title: 'o que o Claude pode fazer nesta conversa',
    });

    const setup = el('div', { class: 'setup-bar' },
      field('modelo', model.node),
      field('pasta', dir.node),
      field('modo', mode.node));

    /**
     * Abre a janela da conversa que ainda vai nascer e manda a primeira mensagem
     * de dentro dela. O `id` é local: cada início é uma conversa diferente, então
     * dá para lançar várias sem uma atropelar a outra.
     */
    async function iniciar(text, images) {
      const cwd = dir.value();
      const escolhido = { mode: mode.value(), model: model.value() };
      let id = null;

      const janela = createConversationWindow({
        title: text.slice(0, 70),
        project: cwd,
        settings: escolhido,
        modeChoices: MODE_CHOICES,
        modelChoices: MODEL_CHOICES,
        swatches: WINDOW_COLORS,

        // enquanto a conversa não existe não há histórico para paginar
        fetchPage: (opts) => (id
          ? api.conversations.read(id, opts)
          : Promise.resolve({ messages: [], total: 0, from: 0, hasMore: false })),

        // o `id` só existe depois do primeiro `init`; até lá não há agente para abrir
        fetchAgentSteps: (agentId) => (id
          ? api.conversations.agentSteps(id, agentId)
          : Promise.reject(new Error('a conversa ainda está sendo criada'))),

        send: (t, values, imgs, onEvent, signal) => {
          const opts = { text: t, mode: values.mode, model: values.model, images: imgs };
          if (id) return api.chat.send(id, opts, onEvent, signal);
          return api.chat.start({ cwd, ...opts }, (ev) => {
            if (ev.type === 'init' && ev.conversationId) {
              id = ev.conversationId;
              janela.setId(id);          // registra: reabrir pela lista foca esta janela
              // A conversa só passa a existir AQUI, e é aqui que o modo/modelo escolhidos
              // no lançador viram preferência dela. Sem isto, `onSaveSetting` não tinha id
              // para gravar e reabrir a janela caía no padrão ("só conversa"): a mensagem
              // seguinte ia com assinatura diferente da do processo vivo e batia em 409
              // ("está respondendo com outro modo/modelo").
              api.settings.save(id, { mode: values.mode, model: values.model }).catch(() => {});
            }
            onEvent(ev);
          }, signal);
        },

        // o canal só existe depois do primeiro `init` (é ele que dá o id); quem chama
        // é o `setId` da janela
        watch: (onEvent) => api.chat.events(id, onEvent),

        stop: () => (id ? api.chat.stop(id) : Promise.resolve()),
        onSaveSetting: (patch) => (id ? api.settings.save(id, patch) : Promise.resolve())
          .catch((err) => toast(`Não deu para salvar a configuração: ${err.message}`, { type: 'err' })),
        // ao terminar, o transcript já existe: dá para dizer no cabeçalho QUAL
        // modelo respondeu de fato (o do composer é o que vai no próximo envio)
        onFinish: async (j) => {
          await j.chat.reload().catch(() => {});
          if (!id) return;
          const { meta } = await api.conversations.read(id, { limit: 1 }).catch(() => ({}));
          if (meta) j.setHeader({ model: meta.model, bytes: meta.bytes });
        },
      });

      await janela.chat.start().catch(() => {});   // abre vazia; o feed mostra "início"
      janela.chat.submit(text, images);
      toast('Conversa criada — ela abriu numa janela e já aparece em Conversas.', { type: 'ok' });
    }

    const composer = createComposer({
      placeholder: 'Escreva a primeira mensagem e pressione Enter…  (Shift+Enter quebra linha)',
      submitLabel: 'Iniciar conversa',
      allowImages: true,
      onSubmit: (text, _values, images) => iniciar(text, images),
    });

    const intro = el('div', { class: 'starter-intro' },
      el('strong', {}, 'Comece do zero'),
      el('p', {},
        'Escolha o modelo e a pasta, escreva a primeira mensagem. A conversa abre numa '
        + 'janela própria (a mesma de "Ler"), nasce como conversa do Claude Code '
        + '(grava em ~/.claude/projects) e passa a aparecer em Conversas.'));

    root.replaceChildren(el('div', { class: 'chat-wrap' }, intro, setup, composer.node));
    composer.focus();

    return {
      // o composer não tem destroy: seus listeners são nos próprios nós (inclusive o
      // `paste`, que o image-tray liga no textarea) e morrem com eles. Os três
      // controles têm, porque o dir-field/choice-select escutam clique-fora.
      destroy() { model.destroy(); dir.destroy(); mode.destroy(); },
    };
  },
};
