// Painel "Nova conversa" — a tela inicial. Só COMPÕE: reaproveita createChat
// (feed + composer + streaming + indicador de atividade) e acrescenta uma barra
// de configuração — modelo (digitável), pasta (com navegador) e modo.
//
// A única lógica daqui é o "criar-ou-continuar": a primeira mensagem nasce a
// conversa (api.chat.start, que gera o session-id no servidor); as seguintes
// continuam nela (api.chat.send). O id vem no evento `init`.

import { api } from '../core/api.js';
import { el, toast } from '../core/ui.js';
import { createChat } from '../components/chat.js';
import { createChoiceSelect } from '../components/choice-select.js';
import { createDirField } from '../components/dir-field.js';
import { MODE_CHOICES, MODEL_CHOICES } from '../core/chat-fields.js';

/** rótulo + controle, no visual da barra de configuração. */
function field(label, ...nodes) {
  return el('label', { class: 'setup-field' }, el('span', { class: 'setup-key' }, label), ...nodes);
}

export default {
  id: 'new',
  icon: '＋',
  navTitle: 'Nova conversa',
  title: 'Nova conversa',
  description: 'Comece uma conversa nova com o Claude — escolha o modelo e a pasta',
  searchPlaceholder: false,

  async mount(root, ctx) {
    const state = { id: null, cwd: '', named: false };
    let chat = null;

    // pasta padrão: a mais recente com conversa, senão o HOME do servidor
    let home = '';
    try { home = (await api.fs.browse()).path; } catch { /* segue sem HOME */ }
    try {
      const { items } = await api.conversations.list();
      state.cwd = items.map((c) => c.project).filter(Boolean)[0] || home;
    } catch { state.cwd = home; }

    /* --- barra de configuração: 3 componentes reutilizáveis, nada inline --- */
    const model = createChoiceSelect({
      choices: MODEL_CHOICES, value: 'opus', allowCustom: true,
      customLabel: 'versão específica…', customPlaceholder: 'ex.: claude-opus-4-8',
      title: 'alias = última versão; para fixar uma versão use "versão específica…" (ex.: claude-opus-4-8)',
    });
    const dir = createDirField({
      browse: api.fs.browse, value: state.cwd, onChange: (d) => { state.cwd = d; },
    });
    const mode = createChoiceSelect({ choices: MODE_CHOICES, value: 'none', title: 'o que o Claude pode fazer nesta conversa' });

    const setup = el('div', { class: 'setup-bar' },
      field('modelo', model.node),
      field('pasta', dir.node),
      field('modo', mode.node));

    /* ------------------------------------------------------------------ chat */
    chat = createChat({
      pageSize: 20,
      placeholder: 'Escreva a primeira mensagem e pressione Enter…  (Shift+Enter quebra linha)',
      submitLabel: 'Iniciar conversa',

      fetchPage: (opts) => (state.id
        ? api.conversations.read(state.id, opts)
        : Promise.resolve({ messages: [], total: 0, from: 0, hasMore: false })),

      send: (text, _values, images, onEvent, signal) => {
        const chosen = model.value();
        const chosenMode = mode.value();
        if (state.id) {
          return api.chat.send(state.id, { text, mode: chosenMode, model: chosen, images }, onEvent, signal);
        }
        return api.chat.start({ cwd: dir.value(), text, mode: chosenMode, model: chosen, images }, (ev) => {
          if (ev.type === 'init' && ev.conversationId) {
            state.id = ev.conversationId;
            state.cwd = ev.cwd;
          }
          onEvent(ev);
        }, signal);
      },

      onStop: () => (state.id ? api.chat.stop(state.id) : Promise.resolve()),

      onFinish: () => {
        if (!state.id) return;
        if (!state.named) {
          state.named = true;
          chat.composer.setSubmitLabel('Enviar');
          dir.setDisabled(true);        // a pasta é fixada quando a conversa nasce
          setup.classList.add('locked');
          toast('Conversa criada. Ela já aparece em Conversas.', { type: 'ok' });
        }
        chat.reload().catch(() => {});
      },
    });

    const intro = el('div', { class: 'starter-intro' },
      el('strong', {}, 'Comece do zero'),
      el('p', {},
        'Escolha o modelo e a pasta, escreva a primeira mensagem. Ela nasce como uma '
        + 'conversa nova do Claude Code (grava em ~/.claude/projects) e passa a aparecer '
        + 'em Conversas, onde você pode continuar, compactar ou apagar.'));

    root.replaceChildren(el('div', { class: 'chat-wrap' }, intro, chat.node, setup, chat.footer));
    chat.attach(root);
    chat.composer.focus();

    return {
      refresh() { if (state.id) chat.reload().catch(() => {}); },
      destroy() { chat?.destroy(); chat = null; model.destroy(); dir.destroy(); mode.destroy(); },
    };
  },
};
