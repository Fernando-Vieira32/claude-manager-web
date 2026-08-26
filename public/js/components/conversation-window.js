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
import { createToggleText } from './toggle-text.js';
import { createFloatingWindow } from './floating-window.js';
import { applySuffix } from '../core/message-suffix.js';
import { createAutoTurnWatcher } from './auto-turn-watcher.js';

// Uma janela por conversa. O registro vive AQUI, e não no painel, senão abrir pela
// lista e depois pela tela de nova conversa daria duas janelas da mesma conversa.
const abertas = new Map();

/**
 * Já existe janela desta conversa **na tela**? Devolve a instância (ou undefined).
 *
 * O registro se limpa sozinho: uma janela fechada que sobrou aqui viraria um
 * fantasma, e `focus()` em janela fechada não mostra nada — o clique em "Ler"
 * simplesmente não abria nada.
 */
export function openConversationWindow(id) {
  const janela = abertas.get(id);
  if (!janela) return undefined;
  if (janela.win.isOpen()) return janela;
  abertas.delete(id);
  return undefined;
}

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
  watch,
  stop,
  onSaveSetting,
  onCompact,
  onFinish,
  onClose,
} = {}) {
  const existente = id ? openConversationWindow(id) : null;
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

  // Frase fixa do fim da mensagem: preferência DESTA conversa (fica no arquivo de
  // configuração dela, como a cor e o modo). O componente só guarda e avisa; quem
  // aplica é a regra pura do `core/message-suffix.js`.
  const sufixo = createToggleText({
    label: 'frase',
    value: settings.suffix || '',
    enabled: settings.suffixOn === true || settings.suffixOn === 'true',
    placeholder: 'ex.: Responda sempre em português e em tópicos.',
    hint: 'vai no fim de toda mensagem que você mandar nesta conversa',
    title: 'Frase fixa no fim das mensagens',
    onChange: ({ value, enabled }) => save({ suffix: value, suffixOn: enabled }),
  });

  const chat = createChat({
    pageSize: 20,
    fetchPage,
    send,
    onStop: stop,
    // o texto que aparece na bolha é o mesmo que vai para o servidor
    beforeSend: (text) => applySuffix(text, sufixo.state()),
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

  // Canal da conversa: por ele chega o que o Claude faz SEM você pedir (turno que ele
  // começa sozinho quando um agente em segundo plano volta). Quem traduz isso em tela é
  // o `auto-turn-watcher`; aqui só se abre e se fecha a conexão.
  let canal = null;
  const observador = createAutoTurnWatcher({ chat });

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
    actions: [sufixo.node, colorPicker.node],
    onClose: () => {
      if (api.id) abertas.delete(api.id);
      canal?.close();                   // quem abre, fecha: o canal é uma conexão viva
      canal = null;
      observador.destroy();
      chat.destroy({ abort: false });   // fechar não interrompe a resposta em curso
      meter.destroy();
      colorPicker.destroy();
      sufixo.destroy();
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
     *
     * Só registra se a janela ainda está na tela: fechar **não** aborta o stream,
     * então o `init` pode chegar depois do fechamento — e registrar aí deixava um
     * fantasma que fazia "Ler" não abrir nada.
     */
    setId(novo) {
      if (!novo || api.id === novo) return api;
      api.id = novo;
      if (win.isOpen()) {
        abertas.set(novo, api);
        api.listen();     // conversa nova: só agora existe id para ouvir
      }
      return api;
    },

    /**
     * Liga o canal desta conversa (idempotente). Fica ligado enquanto a janela viver:
     * é como o trabalho que o Claude faz por conta própria chega até a tela.
     */
    listen() {
      if (canal || !watch || !api.id) return api;
      canal = watch((ev) => observador.handle(ev));
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
  api.listen();
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
