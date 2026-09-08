// Opções dos campos do chat, compartilhadas entre painéis (nova conversa e
// conversas). Ficam num só lugar para não divergirem — espelham o back:
//   - modos de permissão: services/chat/args.js (MODE_POLICIES) e o terminal
//     (`claude --permission-mode`)
//   - modelos: aliases aceitos por `claude --model`

/**
 * Modos de permissão — os mesmos do terminal. Em headless não há "perguntar
 * antes": o modo já libera ou não. Os que editam/executam (auto, aceitar edições,
 * direto) só funcionam com CHAT_ALLOW_FULL_TOOLS=1 no servidor.
 *
 * "direto" é o que dá paridade real com o terminal: em `auto`, quando o
 * classificador barra, o terminal pergunta e você libera — aqui não há a quem
 * perguntar, então a negativa seria final.
 */
export const MODE_CHOICES = [
  { value: 'none', label: 'só conversa', title: 'não lê, não edita, não roda nada' },
  { value: 'plan', label: 'plano', title: 'lê o projeto e propõe um plano, sem alterar nada (como o modo plano do terminal)' },
  { value: 'auto', label: 'automático', title: 'o Claude decide o que é seguro e edita/roda direto — o "auto mode" do terminal (exige CHAT_ALLOW_FULL_TOOLS=1)' },
  { value: 'acceptEdits', label: 'aceitar edições', title: 'aplica edições e roda comandos sem perguntar (exige CHAT_ALLOW_FULL_TOOLS=1)' },
  { value: 'bypassPermissions', label: 'direto (sem barreira)', title: 'nenhuma checagem de permissão: roda o que precisar, sem classificador e sem pedir — igual ao terminal em modo perigoso (exige CHAT_ALLOW_FULL_TOOLS=1)' },
];

/**
 * Modelos do seletor `/model`. Os aliases (opus/fable/sonnet/haiku) apontam para
 * a ÚLTIMA versão de cada família — são ambíguos quanto à versão exata. Para
 * FIXAR uma versão (ex.: `claude-opus-4-8`, `claude-opus-4-6`), use a opção
 * "versão específica…" do seletor e digite o id completo — vira `claude --model
 * claude-opus-4-8`. `value` vazio = não passa --model (usa o padrão do CLI).
 */
export const MODEL_CHOICES = [
  { value: '', label: 'padrão', title: 'usa o modelo configurado no CLI (recomendado)' },
  { value: 'opus', label: 'opus (última)', title: 'Opus mais recente · contexto de 1M · tarefas complexas do dia a dia' },
  { value: 'fable', label: 'fable (última)', title: 'Fable mais recente · para as tarefas mais difíceis e longas' },
  { value: 'sonnet', label: 'sonnet (última)', title: 'Sonnet mais recente · eficiente para tarefas rotineiras' },
  { value: 'haiku', label: 'haiku (última)', title: 'Haiku mais recente · respostas rápidas' },
];
