// Caixa de escrever — textarea + campos de opção + enviar/parar.
//
// Genérica de propósito: não sabe o que faz com o texto. Quem monta passa
// `onSubmit(text, values)`. Serve para o chat de conversas hoje e para
// "commit message", "prompt do editor" ou "comando" amanhã.
//
//   const composer = createComposer({
//     placeholder: 'Escreva para continuar…',
//     fields: [{ name: 'mode', label: 'modo', value: 'none',
//                choices: [{ value: 'none', label: 'só conversa' }] }],
//     onSubmit: async (text, { mode }) => { … },
//     onStop: () => api.chat.stop(id),
//   });

import { el } from '../core/ui.js';
import { createChoiceSelect } from './choice-select.js';
import { createImageTray } from './image-tray.js';

/**
 * @param {object} opts
 * @param {(text:string, values:Record<string,string>, images:Array<{media_type,data}>) => Promise<void>|void} opts.onSubmit
 * @param {() => void} [opts.onStop] se existir, mostra o botão de interromper enquanto ocupado
 * @param {string} [opts.placeholder]
 * @param {string} [opts.submitLabel]
 * @param {Array<{name:string,label?:string,value?:string,title?:string,onChange?:(v:string)=>void,choices:Array<{value:string,label:string,title?:string}>}>} [opts.fields]
 * @param {string} [opts.hint] texto de rodapé (dica, custo, aviso)
 * @param {boolean} [opts.submitOnEnter=true] Enter envia, Shift+Enter quebra linha
 * @param {boolean} [opts.allowImages=false] habilita anexar/colar imagens
 */
export function createComposer({
  onSubmit,
  onStop,
  placeholder = 'Escreva…',
  submitLabel = 'Enviar',
  fields = [],
  hint = '',
  submitOnEnter = true,
  allowImages = false,
} = {}) {
  let label = submitLabel;
  const input = el('textarea', {
    class: 'composer-input',
    rows: 2,
    placeholder,
    spellcheck: 'false',
  });

  // anexar imagem (botão + colar) é um componente à parte; o composer só o encaixa
  const tray = allowImages ? createImageTray() : null;
  if (tray) tray.attachPaste(input);

  // cada campo é um choice-select (o mesmo componente da barra de nova conversa)
  const controls = new Map();
  const fieldNodes = fields.map((field) => {
    const control = createChoiceSelect({
      choices: field.choices,
      value: field.value,
      allowCustom: field.allowCustom,
      customPlaceholder: field.customPlaceholder,
      title: field.title || field.label || field.name,
      onChange: field.onChange,
    });
    controls.set(field.name, control);
    return el('label', { class: 'composer-field' },
      field.label ? el('span', {}, field.label) : null, control.node);
  });

  const hintNode = el('span', { class: 'composer-hint' }, hint);
  const noticeNode = el('div', { class: 'composer-notice', hidden: true });
  const submit = el('button', { class: 'btn primary', type: 'submit' }, label);
  const stop = el('button', { class: 'btn small danger', type: 'button', hidden: true }, 'Parar');

  const form = el('form', { class: 'composer' },
    noticeNode,
    tray ? tray.strip : null,
    input,
    el('div', { class: 'composer-row' }, ...fieldNodes, tray ? tray.button : null, hintNode, stop, submit));

  const values = () => Object.fromEntries([...controls].map(([k, c]) => [k, c.value()]));

  let busy = false;

  async function fire() {
    const text = input.value.trim();
    const images = tray ? tray.items() : [];
    if ((!text && !images.length) || busy) return;
    input.value = '';
    tray?.clear();
    await onSubmit?.(text, values(), images);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    fire();
  });

  input.addEventListener('keydown', (e) => {
    if (!submitOnEnter) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      fire();
    }
  });

  if (onStop) stop.addEventListener('click', () => onStop());

  const api = {
    node: form,
    values,

    /** Trava a caixa enquanto uma resposta está em andamento. */
    setBusy(value) {
      busy = value;
      input.disabled = value;
      submit.disabled = value;
      submit.textContent = value ? 'Enviando…' : label;
      controls.forEach((c) => c.setDisabled(value));
      tray?.setDisabled(value);
      if (onStop) stop.hidden = !value;
      return api;
    },

    /** Troca o rótulo do botão (ex.: "Iniciar conversa" → "Enviar" após criar). */
    setSubmitLabel(text) {
      label = text;
      if (!busy) submit.textContent = text;
      return api;
    },

    setHint(text) {
      hintNode.textContent = text || '';
      return api;
    },

    /** Faixa de aviso acima da caixa (ex.: conversa aberta num terminal). */
    setNotice(text, kind = 'warn') {
      noticeNode.className = `composer-notice ${kind}`;
      noticeNode.textContent = text || '';
      noticeNode.hidden = !text;
      return api;
    },

    focus() {
      input.focus();
      return api;
    },

    get value() { return input.value; },
    set value(v) { input.value = v; },
  };

  return api;
}
