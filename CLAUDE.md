# CLAUDE.md — regras deste projeto

Leia isto **antes de qualquer alteração**. São as diretrizes de qualidade e
arquitetura que o dono do projeto exige. Elas vêm antes de conveniência ou pressa.
A documentação longa vive em [`readme/`](readme/README.md) — este arquivo é o resumo
que nunca pode ser ignorado.

## O que é

Gerenciador de sessões e conversas do Claude Code, via navegador. Node puro (sem
framework, sem build) no back; HTML/CSS/ES modules nativos no front. Objetivo de
longo prazo: virar um editor de código no navegador. Por isso **tudo nasce
desacoplado e reaproveitável** — não é enfeite, é o plano.

## Regras inegociáveis

1. **Componentes primeiro — mas cheque antes de criar.** Qualquer pedaço de interface
   que possa aparecer duas vezes nasce como componente em `public/js/components/` —
   nunca dentro do painel. **Antes de criar um componente novo, olhe se já não existe
   um que serve** (liste `public/js/components/` e leia os cabeçalhos): reaproveite ou
   estenda o que há em vez de duplicar. Só crie um arquivo novo quando nenhum existente
   cobre o caso. Antes de escrever UI num painel, pergunte "isso é reaproveitável?".
   Quase sempre é.
2. **Componente é burro e isolado.** Recebe **dados e callbacks por parâmetro**,
   devolve `{ node, ...métodos, destroy() }`. **Nunca** importa `api.js`, nunca conhece
   rota, serviço ou painel. Teste de cheiro: se para entendê-lo você precisa saber que
   existe uma rota `/api/algo`, está acoplado demais.
3. **Painel é cola.** Busca dados com `api.*` e **compõe** componentes. Não desenha UII
   complexa por conta própria.
4. **Serviço não conhece o resto.** `core/` não sabe do domínio; cada serviço em
   `services/<id>/` declara seu manifesto e é descoberto sozinho pelo `registry`.
   Um serviço nunca importa de outro.
5. **`destroy()` obrigatório** em todo componente que registra listener, timer ou
   observer. Quem cria, destrói (painel destrói no `onClose`/`destroy`).
6. **Arquivos pequenos e de responsabilidade única.** Nada de arquivo gigante. Se um
   arquivo passa de ~200 linhas ou faz duas coisas, quebre. Um componente = uma peça.
7. **CSS por tokens.** Só use variáveis de `tokens.css`; classes com prefixo do
   componente (`.activity-*`, `.ctx-*`). Suporte aos dois temas (claro/escuro) e a
   `prefers-reduced-motion` é obrigatório — nunca cor fixa que quebre um tema.
8. **Honestidade de UX.** Não invente progresso que não existe. Operação opaca (ex.:
   `/compact`) mostra atividade viva + tempo decorrido + resultado antes→depois, nunca
   uma "%" falsa.
9. **Métodos bem escritos.** Nomes claros, uma responsabilidade, encadeáveis quando
   fizer sentido (`return api`). Comentário explica o *porquê*, não o *o quê*.
10. **Atualize o README junto com o código.** Mexeu num componente/rota/contrato,
    documente em `readme/` no mesmo passo — com exemplo de uso de verdade.

## Erros já cometidos (não repita)

- **Renderizar o mesmo controle de dois jeitos.** O `<select>` de ferramentas existia
  no `composer` (chat) E inline num painel — dois renderizadores para a mesma coisa.
  Regra: um controle de UI = **um** componente (`choice-select`, `dir-field`…), usado
  por todos, inclusive por dentro de outros componentes (o `composer` compõe
  `choice-select`). Se você digitou `el('select'...)` ou `el('input'...)` num painel,
  pare: provavelmente é um componente reaproveitável.
- **Compartilhe dados E renderização.** Ter as *opções* num só lugar (`chat-fields.js`)
  não basta se o *desenho* do controle está duplicado. Os dois têm que ser únicos.
- **`<input list=datalist>` filtra e esconde.** Com um valor preenchido o navegador só
  mostra as sugestões que casam — parece que "só tem uma opção". Para "mostrar todas",
  use um `<select>` de verdade (é o `choice-select`).
- **Aliases de modelo são ambíguos.** `opus`/`sonnet`/… apontam para a *última* versão.
  Para fixar uma versão exata, ofereça digitar o id completo (`claude-opus-4-8`), que
  vira `claude --model <id>`.

## Contratos (resumo)

- **Serviço** (`services/<id>/service.js`): `{ id, title, description, basePath,
  routes:[{ method, path, summary, handler }] }`. `handler` devolve dados ou lança
  `ApiError`. Streaming via SSE (`openSse(res)`).
- **Painel** (`public/js/panels/<id>.js`): `{ id, icon, title, description,
  searchPlaceholder, mount(root, ctx) }` → `{ onSearch, refresh, destroy }`.
- **Componente** (`public/js/components/<x>.js`): `createX(opts)` → `{ node,
  ...métodos, destroy() }`. Só dados e callbacks entram.

## Onde as coisas ficam

```
core/        infra sem domínio (http, config, registry, caminhos)
services/    um serviço por pasta, autodescoberto (conversations, chat, sessions)
public/js/core/       api.js (fetch), ui.js (casca: toast/modal/drawer), router
public/js/components/  peças reutilizáveis (feed, bubble, composer, chat, activity…)
public/js/panels/      cola: compõe componentes com dados do api.js
public/css/  tokens.css (variáveis/temas) + app.css (por componente, prefixado)
readme/      documentação longa; comece por readme/README.md
```

## Antes de terminar qualquer tarefa

- **Antes de criar componente:** confirmou que nenhum em `public/js/components/` já
  resolve? Reaproveitar/estender vem antes de criar.
- `node --check` em cada `.js` alterado.
- Confirme que nenhum componente novo importa `api.js`.
- Confirme `destroy()` em quem tem timer/listener e que o painel o chama.
- Atualize o `readme/` correspondente.
- Se dá para testar de verdade (reiniciar `npm start`, abrir a página), teste antes de
  dizer que está pronto.
