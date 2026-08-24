// Texto opcional: um interruptor + um campo de texto, editados num popover, com
// resumo no próprio botão. Serve para qualquer preferência do tipo "guarde esta
// frase e use quando estiver ligado" — a frase fixa da mensagem hoje; amanhã uma
// assinatura de commit, um cabeçalho de arquivo, um comando padrão.
//
// Burro e isolado: recebe o valor atual e devolve mudanças por callback. Não sabe
// o que é conversa, mensagem, rota ou arquivo de configuração. Registra listener
// em `document` (clique-fora e Esc), então tem `destroy()` de verdade.
//
//   const tt = createToggleText({
//     label: 'frase',
//     value: 'Responda em português.',
//     enabled: true,
//     onChange: ({ value, enabled }) => salvar(value, enabled),
//   });
//   header.append(tt.node);

import { el } from '../core/ui.js';

const RESUMO_MAX = 24;

/**
 * @param {object} opts
 * @param {string} [opts.label] rótulo curto no botão quando não há valor
 * @param {string} [opts.value] texto guardado
 * @param {boolean} [opts.enabled] começa ligado?
 * @param {string} [opts.placeholder]
 * @param {string} [opts.hint] uma linha explicando para que serve
 * @param {string} [opts.title] dica do botão
 * @param {number} [opts.maxLength]
 * @param {(estado:{value:string, enabled:boolean}) => void} [opts.onChange]
 */
export function createToggleText({
  label = 'texto',
  value = '',
  enabled = false,
  placeholder = '',
  hint = '',
  title = '',
  maxLength = 2000,
  onChange,
} = {}) {
  let texto = String(value || '');
  let ligado = Boolean(enabled) && Boolean(texto.trim());

  const marca = el('span', { class: 'tgt-mark' }, '✎');
  const resumo = el('span', { class: 'tgt-summary' });
  const btn = el('button', { class: 'tgt-btn', type: 'button', title: title || label }, marca, resumo);

  const chave = el('input', { type: 'checkbox', class: 'tgt-check' });
  const campo = el('textarea', { class: 'tgt-input', rows: 3, placeholder, maxlength: String(maxLength) });
  const pop = el('div', { class: 'tgt-pop', hidden: true },
    el('label', { class: 'tgt-switch' }, chave, el('span', {}, `usar ${label} em toda mensagem`)),
    campo,
    hint ? el('p', { class: 'tgt-hint' }, hint) : null);

  const node = el('span', { class: 'tgt' }, btn, pop);

  /** O botão precisa dizer o estado sem abrir: ligado, desligado ou vazio. */
  function pintar() {
    const limpo = texto.trim();
    resumo.textContent = limpo
      ? (limpo.length > RESUMO_MAX ? `${limpo.slice(0, RESUMO_MAX - 1)}…` : limpo)
      : label;
    node.classList.toggle('tgt-on', ligado && Boolean(limpo));
    node.classList.toggle('tgt-empty', !limpo);
    btn.title = limpo
      ? `${ligado ? 'ligado' : 'desligado'} — ${limpo}`
      : (title || `nenhum ${label} definido`);
    chave.checked = ligado;
    chave.disabled = !limpo;
    campo.value = texto;
  }
  pintar();

  const avisar = () => onChange?.({ value: texto.trim(), enabled: ligado });

  function onFora(e) {
    if (!node.contains(e.target)) abrir(false);
  }
  function onEsc(e) {
    if (e.key === 'Escape') abrir(false);
  }
  function abrir(open) {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      document.addEventListener('mousedown', onFora);
      document.addEventListener('keydown', onEsc);
      campo.focus();
    } else {
      document.removeEventListener('mousedown', onFora);
      document.removeEventListener('keydown', onEsc);
    }
  }

  btn.addEventListener('click', () => abrir(pop.hidden));

  // `change` (e não `input`): grava ao sair do campo, não a cada tecla — configuração
  // é arquivo, e uma gravação por letra é rajada de escrita à toa
  campo.addEventListener('change', () => {
    const novo = campo.value.trim();
    if (novo === texto.trim()) return;
    texto = novo;
    if (!texto) ligado = false;      // sem frase não há o que ligar
    pintar();
    avisar();
  });

  chave.addEventListener('change', () => {
    ligado = chave.checked && Boolean(texto.trim());
    pintar();
    avisar();
  });

  const api = {
    node,
    value: () => texto.trim(),
    enabled: () => ligado && Boolean(texto.trim()),
    /** Estado pronto para quem vai usar (ex.: a regra que monta a mensagem). */
    state: () => ({ phrase: texto.trim(), enabled: api.enabled() }),

    set({ value: v, enabled: e } = {}) {
      if (v !== undefined) texto = String(v || '');
      if (e !== undefined) ligado = Boolean(e);
      if (!texto.trim()) ligado = false;
      pintar();
      return api;
    },

    destroy() {
      document.removeEventListener('mousedown', onFora);
      document.removeEventListener('keydown', onEsc);
    },
  };

  return api;
}
