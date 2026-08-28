// Bootstrap do front: registra painéis, cuida de navegação, busca e tema.
// Nenhuma regra de negócio aqui — só orquestração.

import panels from '../panels/index.js';
import { api } from './api.js';
import { el, toast, confirmAction } from './ui.js';
import { createServerStatus } from '../components/server-status.js';

const nav = document.getElementById('nav');
const root = document.getElementById('panel-root');
const searchInput = document.getElementById('search');
const searchWrap = document.getElementById('search-wrap');
const titleEl = document.getElementById('panel-title');
const descEl = document.getElementById('panel-desc');

const registry = new Map(panels.map((p) => [p.id, p]));
const counts = new Map();
const state = { activeId: null, search: '', instance: null };

/* ------------------------------------------------------------------- nav */
function renderNav() {
  nav.replaceChildren(...panels.map((p) => el('button', {
    type: 'button',
    'aria-current': String(p.id === state.activeId),
    dataset: { id: p.id },
    onclick: () => go(p.id),
  },
    el('span', { class: 'ico' }, p.icon || '•'),
    el('span', {}, p.navTitle || p.title),
    counts.has(p.id) ? el('span', { class: 'count' }, counts.get(p.id)) : null)));
}

async function go(id, { pushHash = true } = {}) {
  const panel = registry.get(id) || panels[0];
  if (state.instance?.destroy) {
    try { state.instance.destroy(); } catch (err) { console.error(err); }
  }

  state.activeId = panel.id;
  state.search = '';
  state.instance = null;
  if (pushHash) location.hash = `#/${panel.id}`;

  titleEl.textContent = panel.title;
  descEl.textContent = panel.description || '';
  searchInput.value = '';
  searchInput.placeholder = panel.searchPlaceholder || 'filtrar…';
  searchWrap.hidden = panel.searchPlaceholder === false;
  root.replaceChildren();
  renderNav();

  const ctx = {
    search: () => state.search,
    setCount: (n) => { counts.set(panel.id, n); renderNav(); },
    toast,
    go,
  };

  try {
    state.instance = (await panel.mount(root, ctx)) || {};
  } catch (err) {
    console.error(err);
    root.replaceChildren(el('div', { class: 'state' }, el('strong', {}, 'Painel falhou'), String(err.message || err)));
  }
}

/* ---------------------------------------------------------------- busca */
let debounce;
searchInput.addEventListener('input', (e) => {
  state.search = e.target.value.trim();
  clearTimeout(debounce);
  debounce = setTimeout(() => state.instance?.onSearch?.(state.search), 180);
});

document.getElementById('refresh').addEventListener('click', () => state.instance?.refresh?.());

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if (e.key === '/' && !typing) { e.preventDefault(); searchInput.focus(); }
  if (e.key === 'Escape' && document.activeElement === searchInput) searchInput.blur();
  if (e.key === 'r' && !typing) state.instance?.refresh?.();
});

/* ----------------------------------------------------------------- tema */
const THEME_KEY = 'cmw:theme';
const setTheme = (t) => {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
};
setTheme(localStorage.getItem(THEME_KEY) || 'dark');
document.getElementById('theme-toggle').addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

/* ------------------------------------------------- status do servidor */
const sub = document.getElementById('brand-sub');
let startCmd = './docker-app.sh'; // ganha o caminho da máquina no 1º ping

const serverStatus = createServerStatus({
  onRestart: async () => {
    serverStatus.set('wait');
    try { await api.server.restart(); } catch { /* o processo cai durante o restart */ }
    waitUp(15);
  },
  onStop: async () => {
    const ok = await confirmAction({
      title: 'Desligar o servidor?',
      text: 'A página para de funcionar. Para religar você vai precisar do terminal — '
        + 'o navegador não liga um servidor desligado.',
      okLabel: 'Desligar',
    });
    if (!ok) return;
    try { await api.server.stop(); } catch { /* cai durante o desligamento */ }
    serverStatus.set('down');
  },
  onStart: async () => {
    try {
      await navigator.clipboard.writeText(startCmd);
      toast('Comando copiado — cole no terminal para ligar o servidor.', { type: 'info' });
    } catch {
      toast(`Rode no terminal: ${startCmd}`, { type: 'info' });
    }
  },
});
document.getElementById('server-status').replaceChildren(serverStatus.node);

async function ping() {
  try {
    await api.meta.health();
    serverStatus.set('up');
    const meta = await api.meta.services();
    if (meta.hostRoot) startCmd = `cd ${meta.hostRoot} && ./docker-app.sh`;
    sub.textContent = `v${meta.version} · ${meta.services.length} serviços`;
  } catch {
    if (serverStatus.node.dataset.state !== 'wait') serverStatus.set('down');
    sub.textContent = 'servidor offline';
  }
}

// Após um restart o servidor some por ~1s; tenta até voltar antes de dar por fora.
function waitUp(tries) {
  api.meta.health()
    .then(() => ping())
    .catch(() => (tries > 0 ? setTimeout(() => waitUp(tries - 1), 700) : serverStatus.set('down')));
}

/* ----------------------------------------------------------------- boot */
window.addEventListener('hashchange', () => {
  const id = location.hash.replace(/^#\/?/, '');
  if (id && id !== state.activeId) go(id, { pushHash: false });
});

ping();
setInterval(ping, 15000);
go(location.hash.replace(/^#\/?/, '') || panels[0].id, { pushHash: false });
