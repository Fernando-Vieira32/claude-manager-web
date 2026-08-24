// Texto editável no lugar: mostra um valor + um botão ✎ que troca por um campo
// com Salvar/Cancelar (Enter salva, Esc cancela). Desacoplado: recebe o valor e
// um callback onSave por parâmetro; não sabe de API nem de painel.
//
// Serve para renomear uma conversa hoje, um arquivo/aba no editor amanhã.
//
//   const ie = createInlineEdit({ value: nome, emptyLabel: 'sem nome',
//     onSave: async (novo) => api.conversations.rename(id, novo) });
//   cell.append(ie.node);

import { el } from '../core/ui.js';

/**
 * @param {object} opts
 * @param {string} [opts.value] valor atual
 * @param {string} [opts.placeholder]
 * @param {string} [opts.emptyLabel] texto discreto quando não há valor
 * @param {string} [opts.editTitle] tooltip do botão de editar
 * @param {(value:string) => Promise<any>|any} [opts.onSave] rejeita → fica em edição
 */
export function createInlineEdit({ value = '', placeholder = '', emptyLabel = '—', editTitle = 'Editar', onSave } = {}) {
  let current = value || '';

  const text = el('span', { class: 'ie-text' });
  const editBtn = el('button', { class: 'icon-btn ie-edit', type: 'button', title: editTitle }, '✎');
  const view = el('span', { class: 'ie-view' }, text, editBtn);

  const input = el('input', { class: 'ie-input', spellcheck: 'false', placeholder });
  const save = el('button', { class: 'btn small primary', type: 'button' }, 'Salvar');
  const cancel = el('button', { class: 'btn small', type: 'button' }, 'Cancelar');
  const editRow = el('span', { class: 'ie-edit-row', hidden: true }, input, save, cancel);

  const node = el('span', { class: 'inline-edit' }, view, editRow);

  function renderText() {
    text.textContent = current || emptyLabel;
    text.classList.toggle('muted', !current);
  }
  function toEdit() {
    input.value = current;
    view.hidden = true;
    editRow.hidden = false;
    input.focus();
    input.select();
  }
  function toView() {
    editRow.hidden = true;
    view.hidden = false;
  }
  function busy(on) {
    input.disabled = on;
    save.disabled = on;
    cancel.disabled = on;
  }

  async function commit() {
    const val = input.value.trim();
    if (!val || val === current) { toView(); return; }
    busy(true);
    try {
      await onSave?.(val);
      current = val;
      renderText();
      toView();
    } catch { /* mantém em edição para tentar de novo; quem chama mostra o erro */ }
    finally { busy(false); }
  }

  // impede que cliques/teclas vazem para a linha da tabela por baixo
  const stop = (e) => e.stopPropagation();
  editBtn.addEventListener('click', (e) => { stop(e); toEdit(); });
  save.addEventListener('click', (e) => { stop(e); commit(); });
  cancel.addEventListener('click', (e) => { stop(e); toView(); });
  input.addEventListener('click', stop);
  input.addEventListener('keydown', (e) => {
    stop(e);
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); toView(); }
  });

  renderText();

  return {
    node,
    edit() { toEdit(); },            // permite disparar por um botão externo
    value: () => current,
    set(v) { current = v || ''; renderText(); },
    destroy() { /* sem timers/listeners externos ao próprio nó */ },
  };
}
