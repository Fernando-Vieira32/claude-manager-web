// Dropdown de escolha — UM componente para todo `<select>` de opção do app:
// modo (no chat e na barra de nova conversa), modelo, e o que vier.
// Com `allowCustom`, ganha a opção "outro (digitar)…" que revela um campo de
// texto para um valor livre (ex.: um id de modelo completo, `claude-opus-4-8`).
//
// Desacoplado: recebe as opções por parâmetro, não sabe de API nem de painel.
//
//   const mode = createChoiceSelect({ choices: MODE_CHOICES, value: 'none' });
//   const model = createChoiceSelect({ choices: MODEL_CHOICES, value: 'opus', allowCustom: true });
//   enviar({ mode: mode.value(), model: model.value() });

import { el } from '../core/ui.js';

const CUSTOM = '__custom__';

/**
 * @param {object} opts
 * @param {Array<{value:string,label:string,title?:string}>} opts.choices
 * @param {string} [opts.value] valor inicial (uma das opções, ou livre se allowCustom)
 * @param {boolean} [opts.allowCustom=false] adiciona a opção livre + campo de texto
 * @param {string} [opts.customLabel] rótulo da opção livre (padrão "outro (digitar)…")
 * @param {string} [opts.customPlaceholder]
 * @param {string} [opts.title] dica do <select>
 * @param {(value:string) => void} [opts.onChange] chamado quando o valor efetivo muda
 */
export function createChoiceSelect({ choices = [], value = '', allowCustom = false, customLabel = 'outro (digitar)…', customPlaceholder = '', title = '', onChange } = {}) {
  const select = el('select', { class: 'composer-select', title },
    ...choices.map((c) => el('option', { value: c.value, title: c.title || '' }, c.label)),
    ...(allowCustom ? [el('option', { value: CUSTOM, title: 'digite um valor' }, customLabel)] : []));

  const custom = allowCustom
    ? el('input', { class: 'setup-input', placeholder: customPlaceholder, spellcheck: 'false', hidden: true })
    : null;

  // posiciona o valor inicial: uma das opções, ou "outro" com o texto preenchido
  if (choices.some((c) => c.value === value)) {
    select.value = value;
  } else if (allowCustom && value) {
    select.value = CUSTOM;
    custom.value = value;
    custom.hidden = false;
  }

  // valor efetivo: a opção escolhida, ou o texto de "outro"
  const current = () => (allowCustom && select.value === CUSTOM ? custom.value.trim() : select.value);

  select.addEventListener('change', () => {
    if (allowCustom) {
      const isCustom = select.value === CUSTOM;
      custom.hidden = !isCustom;
      if (isCustom) custom.focus();
    }
    onChange?.(current());
  });
  if (allowCustom) custom.addEventListener('input', () => onChange?.(current()));

  // Ícone "?" ao lado do campo: ao passar o mouse, explica cada opção. Um select
  // nativo não aceita ícone/tooltip por <option>, então a ajuda vive aqui — e
  // como está no componente, todo dropdown (modo, modelo…) ganha de graça.
  const explained = choices.filter((c) => c.title);
  const help = explained.length
    ? el('span', { class: 'choice-help', tabindex: '0', role: 'button', 'aria-label': 'O que são as opções' },
        '?',
        el('span', { class: 'choice-help-pop' },
          ...explained.map((c) => el('span', { class: 'choice-help-row' },
            el('b', {}, c.label), el('span', {}, c.title)))))
    : null;

  return {
    node: el('span', { class: 'choice-field' }, select, custom, help),

    /** Valor efetivo: a opção escolhida, ou o texto de "outro". */
    value: current,

    setDisabled(v) {
      select.disabled = v;
      if (custom) custom.disabled = v;
    },

    destroy() { /* sem timers/listeners externos */ },
  };
}
