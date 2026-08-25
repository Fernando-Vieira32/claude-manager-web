# 13 · Testes

[← sumário](README.md)

Testes automatizados **sem dependência nenhuma**: o Node 18+ já traz o runner
(`node:test`) e as asserções (`node:assert`). Nada de `npm install`, nada de
`node_modules` — a regra "sem dependências, sem build" continua de pé.

## Rodar

```bash
npm test              # todos, com saída legível (reporter "spec")
npm run test:watch    # reroda ao salvar

node --test "test/*.test.js"                      # equivalente ao npm test
node --test --test-reporter=spec test/settings.test.js   # um arquivo só
```

Cada arquivo roda em um **processo próprio** (é assim que o `node --test` funciona),
o que é essencial aqui — veja o sandbox abaixo.

## O que está coberto

| Arquivo | Cobre |
| --- | --- |
| `test/trash-purge.test.js` | expurgo por idade: validação de `value`/`unit`, `dryRun` não apagando, corte em dias/meses/anos, lixeira vazia, arquivo que não é `.jsonl` |
| `test/trash-lifecycle.test.js` | deletar → lixeira → restaurar: conteúdo preservado, padrão do nome, `deletedAt` vindo do nome (não do `mtime`), travessia de diretório recusada |
| `test/settings.test.js` | os **dois escopos** (global e por conversa) contra os mesmos casos: mesclagem PATCH, `''`/`null` removendo chave, chave/valor inválidos, teto de 16 KB, arquivo ilegível, escopos não se misturando |
| `test/settings-concurrency.test.js` | regressão do bug de gravação concorrente (ver [07](07-seguranca.md)) |
| `test/claude-models.test.js` | resolução modelo → janela de contexto: sufixo `[1m]`/`-fast` removido, alias resolvendo para o mais novo da família, `<synthetic>` ignorado, ausência de catálogo devolvendo `null` em vez de um número inventado |
| `test/claude-blocks.test.js` | o `core/claude-blocks.js`, que os **dois** serviços usam: teto de tamanho, blocos → texto, imagem sem base64, e a regra do resumo do chip (caminho pelo fim, comando pelo começo) |
| `test/chat-stream.test.js` | tradução do stream-json do CLI (`services/chat/stream.js`): linha entra, eventos do contrato saem — ferramenta com `id`/`input`, `toolResult` casado, teto de tamanho, linha quebrada, tipo desconhecido, custo/turnos, limite de uso, **e o `parentId` do subagente** (chamada de dentro do agente aponta para quem a criou, agente-dentro-de-agente mantém a corrente, prosa de subagente não vira mensagem da conversa) |
| `test/conversations-messages.test.js` | leitura do histórico: `tools` estruturadas, `tool_result` costurado pelo id, mensagem só-de-ferramenta não descartada, resultado órfão, várias ferramentas numa mensagem |
| `test/message-suffix.test.js` | a frase fixa do fim da mensagem (`public/js/core/message-suffix.js`): separador de parágrafo, desligado não mexe, frase vazia não mexe, não empilha quando a mensagem já termina com ela, mensagem vazia vira só a frase |
| `test/sessions-conversation-id.test.js` | como uma sessão é identificada: id **declarado** no comando (`--resume`/`-r`/`--session-id`) versus palpite, `--continue`/`--resume` sem valor não declarando nada, uuid solto nos argumentos não valendo, e `-p`/`--print` (headless) sem confundir com `--permission-mode` |

Os dois últimos cobrem a mesma regra pelos dois lados — ao vivo (stream) e relido
(disco) — porque foi justamente a **divergência** entre esses dois caminhos que criou o
bug do chip que sumia. Hoje os dois passam pelo `core/claude-blocks.js`.

Fora de escopo: `toast`, componentes e painéis. Testar DOM exigiria trazer jsdom ou
Playwright como dependência — o custo não paga, e quebraria a premissa do projeto.
O front continua sendo verificado à mão, no navegador.

### Quando o front tem lógica de verdade: arnês descartável

"Verificar à mão" funciona para desenho, não para **regra**. A fila de envio do
[`chat`](11-componentes.md#chatjs) (mandar durante uma resposta enfileira, a etiqueta sai
na vez dela, fechar a janela descarta o resto) é lógica pura embrulhada em DOM — clicar
no navegador não prova que o terceiro item da fila não vaza.

Para esses casos vale um **arnês descartável**, fora de `test/`: um `document` de mentira
de ~40 linhas (`createElement` devolvendo um objeto com `className`, `append`,
`querySelector`, `classList`) e um `send` que só resolve quando você deixa. Com isso dá
para afirmar "a segunda mensagem só sai depois que a primeira termina" — e mutar o código
para ver o arnês acusar. Foi assim que a fila foi conferida (17 checagens; as mutações
"o composer volta a bloquear", "a fila é ignorada", "a etiqueta não sai" e "o `destroy`
não limpa a fila" acusaram todas).

O mesmo vale para o **aninhamento dos subagentes**: o arnês empurra eventos com
`parentId` no `stream-sink` e confere onde cada chip foi parar (dentro do pai, do
avô, ou solto quando o pai é desconhecido) — 14 checagens. As mutações "ignora o
`parentId`" (6 falhas), "filho não entra no mapa, então o neto perde o pai" (3) e "não
revela a seção de passos" (1) acusaram todas.

A **frase fixa** teve os dois tratamentos: a regra é pura e mora em
`public/js/core/message-suffix.js`, então virou teste de verdade na suíte (mutações
"sem separador" 4 falhas, "ignora o desligado" 2, "empilha a frase repetida" 1); o
resto — o controle e o caminho janela → chat → envio — é DOM, e foi conferido por
arnês (19 checagens, incluindo "a bolha mostra exatamente o que foi enviado"). A
mutação "transforma só no envio, não na bolha" acusou 2 falhas. Uma terceira mutação
("ligar sem frase fica ligado") **não** acusou, e o motivo é legítimo: a guarda existe
em dois lugares (a chave nasce `disabled` e o `enabled()` confere de novo), então tirar
uma não muda comportamento.

Ele **não** entra na suíte de propósito: um DOM falso mantido à mão viraria dependência
disfarçada e mentiria em silêncio no dia que divergisse do navegador. É ferramenta de
conferência do momento — escreve, prova, joga fora, e o que sobra é o comportamento
documentado aqui.

## O sandbox (por que os testes não encostam nos seus dados)

O `core/config.js` resolve os caminhos **uma vez, no import**. Então o teste troca o
env *antes* de importar o módulo sob teste — e é por isso que os testes usam
`await import()` dentro de `before()`, nunca `import` estático no topo:

```js
before(async () => {
  box = await createSandbox();                              // troca o env
  repo = await import('../services/conversations/repo.js'); // só então importa
});
```

`createSandbox()` (em `test/helpers/sandbox.js`) cria um `mkdtemp` e aponta para lá:

| Variável | Redireciona |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | `projects/` e `.trash-conversas/` — a lixeira e as conversas |
| `DATA_DIR` | `data/settings.json` e `data/conversas/` — as preferências |

Com isso, os testes apagam conversas e expurgam lixeira **de verdade**, sem risco:
nada disso é o seu `~/.claude` nem o `data/` do projeto. As duas variáveis também
servem em produção, se você quiser rodar com outro diretório.

O helper traz as "factories" — `givenTrashed()`, `givenConversation()`, `ago()`,
`stampFor()` — para os testes não repetirem setup.

## Vindo do RSpec

| RSpec | `node:test` |
| --- | --- |
| `describe` / `context` | `describe` (aninha igual) |
| `it do … end` | `it('...', () => {})` |
| `before` / `after` | `before`, `beforeEach`, `after`, `afterEach` |
| `expect(x).to eq(y)` | `assert.equal(x, y)` |
| `expect(h).to eq(hash)` | `assert.deepEqual(h, hash)` |
| `expect { }.to raise_error(/msg/)` | `assert.rejects(fn, /msg/)` — ou `assert.throws` se for síncrono |
| `let(:x)` | não existe: `const` no escopo do `describe` + `beforeEach` |
| FactoryBot | função helper comum (`givenTrashed`, `givenConversation`) |
| `bundle exec rspec` | `npm test` |

Duas diferenças que incomodam: **não há `let` com avaliação tardia**, e o `assert`
nativo tem menos matchers que o `expect` — às vezes sai uma linha a mais.

## Teste que não falha não vale nada

Ao escrever um caso, **quebre o código de propósito e confirme que ele acusa**. Foi
assim que se descobriu que o teste de "meses são calendário" estava fraco: trocar
`setMonth(m - n)` por `setDate(d - n*30)` passava batido, porque o caso usado (item de
1 mês e meio) cai do mesmo lado do corte nas duas contas.

O caso que **realmente** separa as duas é 12 meses: calendário dá ~365 dias, o atalho
errado dá 360 — então um item de 362 dias cai de lados opostos. É o teste
`12 meses não são 360 dias`, e ele existe só por causa dessa checagem.

```bash
# receita: mute, rode, confirme a falha, restaure
perl -0pi -e 's/setMonth\(d.getMonth\(\) - n\)/setDate(d.getDate() - n * 30)/' services/conversations/repo.js
npm test                                      # tem que FALHAR
git checkout -- services/conversations/repo.js
```

**Cuidado com fixture "arrumadinho".** O mesmo erro apareceu de novo no teste de
"alias resolve para o modelo mais novo": o catálogo de exemplo estava em ordem
decrescente de data, então remover a ordenação do código **não fazia o teste falhar**
— o `filter` já devolvia o mais novo primeiro, por acidente. A correção foi pôr o
mais **antigo** primeiro no fixture. Quando um teste depende de ordenação,
agrupamento ou desempate, monte o dado de entrada na ordem *errada* de propósito.

## Ao acrescentar teste

- nome do arquivo termina em `.test.js` e vive em `test/` (o `npm test` usa o glob
  `test/*.test.js`, então `test/helpers/` não é varrido);
- se o teste toca disco, use o sandbox — nunca escreva em `~/.claude` nem no `data/`;
- descreva o **comportamento**, não a implementação: `it('apaga o antigo e preserva o
  recente')` sobrevive a um refactor; `it('chama fs.rm')` não.
