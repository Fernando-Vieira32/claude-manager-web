import { api } from '../core/api.js';
import { el, fmt, toast, states, confirmAction } from '../core/ui.js';
import { createDurationField, DURATION_UNITS, formatDuration } from '../components/duration-field.js';

// Chaves na config global (data/settings.json). Só a interface sabe o que significam.
const KEY_VALUE = 'trashRetentionValue';
const KEY_UNIT = 'trashRetentionUnit';
const DEFAULT_RETENTION = { value: 30, unit: 'days' };

/** Retenção salva, caindo no padrão se nunca foi configurada (ou vier torta). */
async function readRetention() {
  try {
    const { settings } = await api.settings.getGlobal();
    const value = Number(settings[KEY_VALUE]);
    const unit = settings[KEY_UNIT];
    return {
      value: Number.isInteger(value) && value > 0 ? value : DEFAULT_RETENTION.value,
      unit: DURATION_UNITS.some((u) => u.value === unit) ? unit : DEFAULT_RETENTION.unit,
    };
  } catch {
    return { ...DEFAULT_RETENTION };
  }
}

export default {
  id: 'trash',
  icon: '⌫',
  title: 'Lixeira',
  description: 'Conversas removidas — restaure, ou apague de vez as mais antigas',
  searchPlaceholder: 'filtrar por projeto, id…',

  async mount(root, ctx) {
    let term = ctx.search();
    const body = el('div', {});
    const info = el('span', {});

    const saved = await readRetention();
    const retention = createDurationField({
      label: 'apagar o que está aqui há mais de',
      value: saved.value,
      unit: saved.unit,
      title: 'idade a partir da qual a conversa é apagada de vez',
      onChange: saveRetention,
    });

    const purgeBtn = el('button',
      { class: 'btn small danger', type: 'button', onclick: purge }, 'Excluir antigas');

    root.replaceChildren(
      el('div', { class: 'toolbar-line' },
        info,
        el('span', { class: 'trash-purge' }, retention.node, purgeBtn)),
      body,
    );

    const matches = (t) => !term
      || `${t.name} ${t.projectDir} ${t.sessionId}`.toLowerCase().includes(term.toLowerCase());

    /** A escolha vale para a próxima vez: grava na config global. */
    async function saveRetention({ value, unit }) {
      try {
        await api.settings.saveGlobal({ [KEY_VALUE]: value, [KEY_UNIT]: unit });
      } catch (err) {
        toast(`não consegui salvar a retenção: ${err.message}`, { type: 'err' });
      }
    }

    // Pergunta ao servidor o que iria embora (dryRun) para a confirmação mostrar
    // número e tamanho de verdade — quem decide a idade é uma só regra, a de lá.
    async function purge() {
      const { value, unit } = retention.value();
      const age = formatDuration({ value, unit });
      purgeBtn.disabled = true;
      try {
        const preview = await api.conversations.purgeTrash({ value, unit, dryRun: true });
        if (!preview.count) {
          toast(`Nada na lixeira há mais de ${age}.`, { type: 'info' });
          return;
        }
        const ok = await confirmAction({
          title: 'Apagar de vez?',
          text: `${preview.count} conversa(s) estão na lixeira há mais de ${age}`
            + ` (${fmt.bytes(preview.bytes)}). Os arquivos saem do disco — isto NÃO tem Desfazer.`,
          okLabel: `Apagar ${preview.count}`,
        });
        if (!ok) return;

        const done = await api.conversations.purgeTrash({ value, unit });
        toast(`${done.count} conversa(s) apagadas — ${fmt.bytes(done.bytes)} liberados.`, { type: 'ok' });
        load();
      } catch (err) {
        toast(err.message, { type: 'err' });
      } finally {
        purgeBtn.disabled = false;
      }
    }

    async function load() {
      body.replaceChildren(states.loading(2));
      try {
        const { items } = await api.conversations.trash();
        const visible = items.filter(matches);
        const bytes = items.reduce((sum, t) => sum + t.bytes, 0);
        ctx.setCount(items.length);
        info.textContent = items.length
          ? `${items.length} na lixeira · ${fmt.bytes(bytes)}`
          : 'lixeira vazia';
        purgeBtn.disabled = !items.length;

        if (!visible.length) {
          body.replaceChildren(states.empty(
            items.length ? 'Nada casa com o filtro' : 'Lixeira vazia',
            items.length ? '' : 'Conversas deletadas aparecem aqui.'));
          return;
        }
        body.replaceChildren(el('div', { class: 'cards' }, ...visible.map(card)));
      } catch (err) {
        body.replaceChildren(states.error(err, load));
      }
    }

    function card(t) {
      return el('div', { class: 'card row' },
        el('div', { class: 'card-main' },
          el('div', { class: 'card-title code' }, t.sessionId),
          el('div', { class: 'meta' },
            el('span', { class: 'chip' }, t.projectDir),
            el('span', {}, `deletada ${fmt.when(t.deletedAt)}`),
            el('span', {}, fmt.bytes(t.bytes)))),
        el('div', { class: 'actions' },
          el('button', {
            class: 'btn small primary',
            type: 'button',
            onclick: async () => {
              try {
                await api.conversations.restore(t.name);
                toast('Conversa restaurada.', { type: 'ok' });
              } catch (err) {
                toast(err.message, { type: 'err' });
              }
              load();
            },
          }, 'Restaurar')));
    }

    load();
    return {
      onSearch(v) { term = v; load(); },
      refresh: load,
      destroy() { retention.destroy(); },
    };
  },
};
