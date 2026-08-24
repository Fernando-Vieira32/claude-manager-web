// Campo de duração: quantidade + unidade (dias/meses/anos) num só controle.
// Serve para qualquer "quanto tempo" do app — hoje a retenção da lixeira, amanhã
// um timeout ou um intervalo de auto-save.
//
// Não desenha `<select>` por conta própria: COMPÕE o `choice-select`, que é o
// único dropdown do app. Desacoplado — recebe valor e callback, não sabe de API
// nem de painel, e não decide o que fazer com o número.
//
//   const ret = createDurationField({
//     label: 'guardar por', value: 30, unit: 'days',
//     onChange: ({ value, unit }) => salvar(value, unit),
//   });
//   ret.value();            // { value: 30, unit: 'days' }

import { el } from '../core/ui.js';
import { createChoiceSelect } from './choice-select.js';

/**
 * Unidades aceitas — os `value` são os mesmos que o backend entende.
 * `one` é o singular, para quem monta frase ("há mais de 1 dia").
 */
export const DURATION_UNITS = [
  { value: 'days', label: 'dias', one: 'dia' },
  { value: 'months', label: 'meses', one: 'mês' },
  { value: 'years', label: 'anos', one: 'ano' },
];

/** "1 dia", "3 meses" — plural resolvido a partir das unidades do componente. */
export function formatDuration({ value, unit }, units = DURATION_UNITS) {
  const found = units.find((u) => u.value === unit);
  if (!found) return `${value} ${unit}`;
  return `${value} ${value === 1 ? (found.one || found.label) : found.label}`;
}

/**
 * @param {object} opts
 * @param {number} [opts.value=1] quantidade inicial
 * @param {string} [opts.unit='days'] unidade inicial (um dos `units`)
 * @param {Array<{value:string,label:string}>} [opts.units=DURATION_UNITS]
 * @param {string} [opts.label] rótulo à esquerda (omita para não ter)
 * @param {number} [opts.min=1]
 * @param {number} [opts.max=999]
 * @param {string} [opts.title] dica do campo numérico
 * @param {({value:number,unit:string}) => void} [opts.onChange] a cada edição válida
 */
export function createDurationField({
  value = 1, unit = 'days', units = DURATION_UNITS,
  label = '', min = 1, max = 999, title = '', onChange,
} = {}) {
  const clamp = (n) => Math.min(max, Math.max(min, Math.round(Number(n) || min)));

  const num = el('input', {
    class: 'setup-input duration-num',
    type: 'number',
    min: String(min),
    max: String(max),
    value: String(clamp(value)),
    title,
  });

  const unitSelect = createChoiceSelect({
    choices: units,
    value: unit,
    onChange: () => onChange?.(current()),
  });

  const current = () => ({ value: clamp(num.value), unit: unitSelect.value() });

  // Só 'change' (sai do campo / Enter), não 'input': digitar "30" passaria por "3"
  // e dispararia uma gravação intermediária que não é o que a pessoa quis.
  num.addEventListener('change', () => {
    num.value = String(clamp(num.value));
    onChange?.(current());
  });

  const field = el('span', { class: 'duration-field' }, num, unitSelect.node);

  return {
    node: label
      ? el('label', { class: 'setup-field' }, el('span', { class: 'setup-key' }, label), field)
      : field,

    /** `{ value, unit }` já normalizado (inteiro dentro de [min, max]). */
    value: current,

    setDisabled(v) {
      num.disabled = v;
      unitSelect.setDisabled(v);
    },

    destroy() { unitSelect.destroy(); },
  };
}
