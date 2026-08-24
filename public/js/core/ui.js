// Componentes e formatadores compartilhados. Sem estado de negócio.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const fmt = {
  // número curto: 1532 -> "1.5k", 230000 -> "230k", 1000000 -> "1M"
  compact(n) {
    if (!Number.isFinite(n)) return '—';
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`.replace('.0', '');
    return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`.replace('.0', '');
  },
  bytes(n) {
    if (!Number.isFinite(n)) return '—';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
    return `${n < 10 && i ? n.toFixed(1) : Math.round(n)}${u[i]}`;
  },
  when(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'agora';
    if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h atrás`;
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  clock(iso) {
    return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
  },
};

// Teto de exibição de um toast. Nenhum fica mais que isso na tela.
export const TOAST_MS = 5000;

export function toast(message, { type = 'info', action, timeout = TOAST_MS } = {}) {
  const host = document.getElementById('toasts');
  const node = el('div', { class: `toast ${type}` }, el('span', {}, message));
  const ms = Math.min(timeout, TOAST_MS);
  let timer;

  // Sai levando o timer junto: fechar pelo botão não deixa setTimeout pendente.
  const close = () => { clearTimeout(timer); node.remove(); };
  const arm = () => { timer = setTimeout(close, ms); };

  if (action) {
    node.append(el('button', { type: 'button', onclick: () => { close(); action.run(); } }, action.label));
  }
  host.append(node);
  arm();

  // O mouse em cima só *adia* — dá tempo de mirar o "Desfazer". Ao sair, o relógio
  // volta a correr; antes ele era cancelado e o toast ficava para sempre na tela.
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', arm);
  return node;
}

export function confirmAction({ title = 'Confirmar', text = '', okLabel = 'Confirmar', danger = true }) {
  const modal = document.getElementById('modal');
  const ok = document.getElementById('modal-ok');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-text').textContent = text;
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? 'danger' : 'primary'}`;
  modal.hidden = false;
  ok.focus();

  return new Promise((resolve) => {
    const done = (value) => {
      modal.hidden = true;
      ok.onclick = null;
      document.removeEventListener('keydown', onKey);
      modal.querySelectorAll('[data-cancel]').forEach((n) => (n.onclick = null));
      document.getElementById('modal-cancel').onclick = null;
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    };
    ok.onclick = () => done(true);
    document.getElementById('modal-cancel').onclick = () => done(false);
    modal.querySelectorAll('[data-cancel]').forEach((n) => (n.onclick = () => done(false)));
    document.addEventListener('keydown', onKey);
  });
}

export const drawer = {
  _onClose: null,

  /**
   * body: Node | Node[]. Passe `onClose` quando o conteúdo tiver recursos a
   * liberar (observers, timers) — é chamado ao fechar ou ao abrir outro conteúdo.
   */
  open({ title, subtitle, body, footer, onClose }) {
    if (onClose !== undefined) {
      const previous = drawer._onClose;
      drawer._onClose = onClose;
      if (previous) previous();
    }

    const host = document.getElementById('drawer');
    document.getElementById('drawer-title').textContent = title || '';
    document.getElementById('drawer-sub').textContent = subtitle || '';
    const target = document.getElementById('drawer-body');
    target.replaceChildren(...[body].flat().filter(Boolean));

    const foot = document.getElementById('drawer-foot');
    if (footer === undefined) {
      // mantém o rodapé atual (ex.: troca só o corpo durante o carregamento)
    } else if (footer) {
      foot.replaceChildren(...[footer].flat().filter(Boolean));
      foot.hidden = false;
    } else {
      foot.replaceChildren();
      foot.hidden = true;
    }
    host.hidden = false;
    host.querySelectorAll('[data-close]').forEach((n) => (n.onclick = () => drawer.close()));
    document.addEventListener('keydown', drawer._esc);
  },

  /** Elemento que rola — use para scroll infinito e para ancorar a posição. */
  scroller() {
    return document.getElementById('drawer-body');
  },

  /** Cabeçalho secundário, para atualizar contadores sem redesenhar o corpo. */
  setSubtitle(text) {
    document.getElementById('drawer-sub').textContent = text || '';
  },

  close() {
    document.getElementById('drawer').hidden = true;
    const foot = document.getElementById('drawer-foot');
    foot.replaceChildren();
    foot.hidden = true;
    document.removeEventListener('keydown', drawer._esc);
    const cb = drawer._onClose;
    drawer._onClose = null;
    if (cb) cb();
  },

  _esc(e) { if (e.key === 'Escape') drawer.close(); },
};

export const states = {
  loading(rows = 3) {
    return el('div', { class: 'cards' }, Array.from({ length: rows }, () => el('div', { class: 'skeleton' })));
  },
  empty(title, hint) {
    return el('div', { class: 'state' }, el('strong', {}, title), hint || '');
  },
  error(err, retry) {
    return el('div', { class: 'state' },
      el('strong', {}, 'Falhou'),
      el('div', { class: 'code' }, String(err.message || err)),
      retry ? el('div', { style: 'margin-top:14px' },
        el('button', { class: 'btn', type: 'button', onclick: retry }, 'Tentar de novo')) : null);
  },
};
