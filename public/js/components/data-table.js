// Tabela de dados declarativa. Descreva colunas, passe linhas, receba o nó.
// Reaproveitável por qualquer painel que liste registros (conversas, arquivos,
// commits, resultados de busca).
//
//   createDataTable({
//     columns: [
//       { key: 'when',  label: 'Quando', className: 'code' },
//       { key: 'title', label: 'Assunto', grow: true, onClick: (row) => abrir(row) },
//       { label: '', render: (row) => botões(row) },
//     ],
//     rows: items,
//     empty: states.empty('Nada aqui'),
//   })

import { el } from '../core/ui.js';

/**
 * @param {object} opts
 * @param {Array<{key?:string,label?:string,render?:(row:any)=>any,className?:string,
 *                width?:string,onClick?:(row:any)=>void,title?:(row:any)=>string}>} opts.columns
 * @param {Array<object>} opts.rows
 * @param {Node} [opts.empty] nó mostrado quando não há linhas
 * @param {(row:any) => void} [opts.onRowClick]
 */
export function createDataTable({ columns, rows, empty, onRowClick }) {
  if (!rows?.length && empty) return empty;

  const head = el('thead', {},
    el('tr', {}, ...columns.map((c) =>
      el('th', { style: c.width ? `width:${c.width}` : null }, c.label || ''))));

  const body = el('tbody', {}, ...(rows || []).map((row) => {
    const tr = el('tr', {});
    if (onRowClick) {
      tr.classList.add('clickable');
      tr.addEventListener('click', () => onRowClick(row));
    }
    for (const col of columns) {
      const content = col.render ? col.render(row) : row[col.key];
      const td = el('td', {
        class: [col.className, col.onClick ? 'clickable' : null].filter(Boolean).join(' ') || null,
        title: col.title ? col.title(row) : null,
      }, content ?? '');
      if (col.onClick) td.addEventListener('click', (e) => { e.stopPropagation(); col.onClick(row); });
      tr.append(td);
    }
    return tr;
  }));

  return el('table', { class: 'grid' }, head, body);
}
