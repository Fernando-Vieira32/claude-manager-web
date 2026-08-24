// Bandeja de imagens para anexar a uma mensagem: botão de escolher arquivo,
// "colar" (Ctrl+V) e uma tira de miniaturas com remover. Desacoplado — não sabe
// de API nem de painel; guarda as imagens em memória e as entrega em base64.
//
// Tem duas partes de UI (a tira e o botão) porque vivem em lugares diferentes do
// composer, então expõe `strip` e `button` separados.
//
//   const tray = createImageTray();
//   above.append(tray.strip);        // miniaturas acima da caixa
//   row.append(tray.button);         // botão na linha de ações
//   tray.attachPaste(textarea);      // liga o Ctrl+V
//   enviar({ images: tray.items() }); tray.clear();

import { el } from '../core/ui.js';

const OK_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Lê um Blob/File como { mediaType, dataUrl, data(base64), name }. */
function readImage(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({
        mediaType: blob.type || 'image/png',
        dataUrl: url,
        data: url.slice(url.indexOf(',') + 1),
        name: blob.name || 'imagem',
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {object} opts
 * @param {number} [opts.max=6] máximo de imagens
 * @param {(count:number) => void} [opts.onChange]
 */
export function createImageTray({ max = 6, onChange } = {}) {
  const items = [];
  let disabled = false;

  const strip = el('div', { class: 'att-strip', hidden: true });

  const fileInput = el('input', { type: 'file', accept: OK_TYPES.join(','), multiple: true, hidden: true });
  const realBtn = el('button', { class: 'btn small att-btn', type: 'button', title: 'Anexar imagem' }, '🖼');
  const button = el('span', { class: 'att-btn-wrap' }, realBtn, fileInput);

  function render() {
    strip.replaceChildren(...items.map((im, i) =>
      el('span', { class: 'att-thumb', title: im.name },
        el('img', { src: im.dataUrl, alt: im.name }),
        el('button', { class: 'att-remove', type: 'button', title: 'Remover', onclick: () => remove(i) }, '×'))));
    strip.hidden = items.length === 0;
    onChange?.(items.length);
  }

  function remove(i) {
    if (disabled) return;
    items.splice(i, 1);
    render();
  }

  async function add(blobs) {
    for (const blob of blobs) {
      if (items.length >= max) break;
      if (!blob || !OK_TYPES.includes(blob.type)) continue;
      try { items.push(await readImage(blob)); } catch { /* arquivo ilegível: ignora */ }
    }
    render();
  }

  realBtn.addEventListener('click', () => { if (!disabled) fileInput.click(); });
  fileInput.addEventListener('change', () => { add([...fileInput.files]); fileInput.value = ''; });

  return {
    strip,
    button,

    /** Liga o "colar imagem" (Ctrl+V) num elemento (a textarea). Devolve o desligador. */
    attachPaste(target) {
      const onPaste = (e) => {
        if (disabled) return;
        const imgs = [...(e.clipboardData?.items || [])].filter((it) => it.type.startsWith('image/'));
        if (!imgs.length) return;
        e.preventDefault(); // é imagem colada, não texto
        add(imgs.map((it) => it.getAsFile()).filter(Boolean));
      };
      target.addEventListener('paste', onPaste);
      return () => target.removeEventListener('paste', onPaste);
    },

    /** [{ media_type, data }] pronto para o backend. */
    items: () => items.map((im) => ({ media_type: im.mediaType, data: im.data })),
    count: () => items.length,
    clear() { items.length = 0; render(); },
    setDisabled(v) { disabled = v; realBtn.disabled = v; },
    destroy() { /* listeners morrem com os nós */ },
  };
}
