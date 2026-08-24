// A janela de uma conversa: janela flutuante + chat + medidor de contexto +
// seletor de cor, montados juntos. É a vista completa de "estar dentro de uma
// conversa".
//
// Existe como componente porque DOIS caminhos abrem a mesma coisa: clicar em Ler
// na lista de Conversas e iniciar uma conversa nova. Painel não importa painel,
// então a peça compartilhada mora aqui e cada painel compõe.
//
// Burro do jeito de sempre: o transporte (`fetchPage`, `send`, `stop`) e o que
// fazer ao gravar/compactar entram por parâmetro — não importa `api.js`.
//
//   const janela = createConversationWindow({
//     id: c.id, title: c.title, project: c.project, bytes: c.bytes, model: c.model,
//     settings: salvas, modeChoices: MODE_CHOICES, modelChoices: MODEL_CHOICES,
//     fetchPage: (opts) => api.conversations.read(c.id, opts),
//     send: (text, values, images, onEvent, signal) => api.chat.send(...),
//     onSaveSetting: (patch) => api.settings.save(c.id, patch),
//   });

import { fmt } from '../core/ui.js';
import { createChat } from './chat.js';
import { createContextMeter } from './context-meter.js';
import { createColorPicker } from './color-picker.js';
import { createFloatingWindow } from './floating-window.js';

// Uma janela por conversa. O registro vive AQUI, e não no painel, senão abrir pela
// lista e depois pela tela de nova conversa daria duas janelas da mesma conversa.
const abertas = new Map();

/** Já existe janela desta conversa? Devolve a instância (ou undefined). */
export const openConversationWindow = (id) => abertas.get(id);

export function createConversationWindow({
  id = null,
  title = 'Conversa',
  project = '',
  bytes = null,
  model = '',
  context = null,
  settings = {},
  modeChoices = [],
  modelChoices = [],
  swatches = [],
  fetchPage,
  send,
  stop,
  onSaveSetting,
  onCompact,
  onFinish,
  onClose,
} = {}) {
  const existente = id && abertas.get(id);
  if (existente) {
    existente.focus();
    return existente;
  }

  const save = (patch) => Promise.resolve(onSaveSetting?.(patch));
  let win;

  // Estado do cabeçalho num objeto só: o total de mensagens chega pelo feed e o
  // modelo pode só ser conhecido depois (conversa que nasceu agora). Guardar aqui
  // evita que atualizar um apague o outro.
  const header = { project, shown: null, total: null, bytes, model };
  const paintHeader = () => win?.setSubtitle(subtitle(header));

  const meter = createContextMeter({ onCompact: () => onCompact?.(api) });
  if (context) meter.set(context);

  const chat = createChat({
    pageSize: 20,
    fetchPage,
    send,
    onStop: stop,
    fields: [
      {
        name: 'mode',
        label: 'modo',
        value: settings.mode || 'none',
        choices: modeChoices,
        onChange: (mode) => save({ mode }),          // grava na hora, mesmo sem enviar
      },
      {
        name: 'model',
        label: 'modelo',
        value: settings.model || '',
        choices: modelChoices,
        allowCustom: true,
        customPlaceholder: 'ex.: claude-opus-4-8',
        onChange: (m) => save({ model: m }),
      },
    ],
    onState: (estado) => { Object.assign(header, estado); paintHeader(); },
    onFinish: () => onFinish?.(api),
  });

  const colorPicker = createColorPicker({
    value: settings.color || '',
    swatches,
    onChange: (color) => {
      win?.setAccent(color);
      save({ color });
    },
  });

  win = createFloatingWindow({
    title: String(title).slice(0, 70),
    subtitle: subtitle(header),
    actions: [colorPicker.node],
    onClose: () => {
      if (api.id) abertas.delete(api.id);
      chat.destroy({ abort: false });   // fechar não interrompe a resposta em curso
      meter.destroy();
      colorPicker.destroy();
      onClose?.(api);
    },
  });
  win.setAccent(settings.color || '');
  win.bodyEl.append(chat.node);
  win.setFooter([meter.node, chat.footer]);
  chat.attach(win.scroller());

  const api = {
    id,
    win,
    chat,
    meter,

    /**
     * A conversa nasceu agora e só temos o id depois do primeiro `init`. Registrar
     * aqui é o que impede uma segunda janela quando ela aparecer na lista.
     */
    setId(novo) {
      if (!novo || api.id === novo) return api;
      api.id = novo;
      abertas.set(novo, api);
      return api;
    },

    /** Cabeçalho: título e a linha "projeto · N de M mensagens · tamanho · modelo". */
    setTitle(t) { win.setTitle(String(t || '').slice(0, 70)); return api; },
    /** Mescla no que já está lá — dá para informar só o modelo, ou só o tamanho. */
    setHeader(info) { Object.assign(header, info); paintHeader(); return api; },

    focus() { win.focus(); chat.composer.focus(); return api; },

    destroy() { win.close(); return api; },
  };

  if (id) abertas.set(id, api);
  return api;
}

/** Linha de contexto do cabeçalho. Só mostra o que existe — sem campo vazio. */
function subtitle({ project, shown, total, bytes, model }) {
  const partes = [project];
  if (total != null) partes.push(`${shown} de ${total} mensagens`);
  else partes.push('carregando…');
  if (bytes != null) partes.push(fmt.bytes(bytes));
  if (model) partes.push(`modelo: ${model}`);
  return partes.filter(Boolean).join(' · ');
}
