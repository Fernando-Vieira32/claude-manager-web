# 04 · Criar um serviço (backend)

[← sumário](README.md)

Exemplo didático: um serviço `files` para listar e ler arquivos — o primeiro tijolo do
futuro editor.

> Já existe um primo mais simples no projeto: o serviço **`fs`**
> ([`/api/fs`](03-api.md#arquivos-fs)), que só **lista pastas** (para escolher onde uma
> conversa roda). Use-o como referência de um serviço real e pequeno; o `files` abaixo
> é a versão de ensino, que também **lê** arquivos.

## 1. Crie a pasta

```
services/files/
  service.js    manifesto (o que o core lê)
  repo.js       regra de negócio (o que faz o trabalho)
```

## 2. `repo.js` — a regra de negócio

Só funções puras de domínio. Nada de `req`/`res`; erros são `ApiError`.

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../core/config.js';
import { badRequest, notFound } from '../../core/http.js';

// Raiz permitida: nunca deixe o caminho escapar dela.
const ROOT = process.env.FILES_ROOT || config.home;

function safe(rel = '.') {
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    throw badRequest('caminho fora da raiz permitida');
  }
  return abs;
}

export async function listDir(rel = '.') {
  const abs = safe(rel);
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    throw notFound('pasta não encontrada');
  }
  const items = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const st = await fs.stat(path.join(abs, e.name)).catch(() => null);
    items.push({
      name: e.name,
      path: path.relative(ROOT, path.join(abs, e.name)),
      dir: e.isDirectory(),
      bytes: st?.size ?? 0,
      modifiedAt: st ? new Date(st.mtimeMs).toISOString() : null,
    });
  }
  items.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { root: ROOT, path: path.relative(ROOT, abs) || '.', items };
}

export async function readFile(rel) {
  if (!rel) throw badRequest('informe ?path=');
  const abs = safe(rel);
  const st = await fs.stat(abs).catch(() => null);
  if (!st?.isFile()) throw notFound('arquivo não encontrado');
  if (st.size > 2_000_000) throw badRequest('arquivo grande demais para ler aqui');
  return {
    path: path.relative(ROOT, abs),
    bytes: st.size,
    text: await fs.readFile(abs, 'utf8'),
  };
}
```

## 3. `service.js` — o manifesto

```js
import { listDir, readFile } from './repo.js';

export default {
  id: 'files',
  title: 'Arquivos',
  description: 'Navegar e ler arquivos do disco',
  basePath: '/api/files',
  routes: [
    { method: 'GET', path: '/', summary: 'lista uma pasta (?path=)',
      handler: ({ query }) => listDir(query.path) },
    { method: 'GET', path: '/read', summary: 'lê um arquivo (?path=)',
      handler: ({ query }) => readFile(query.path) },
  ],
};
```

## 4. Reinicie e confira

```bash
npm run dev     # --watch já reinicia ao salvar
curl -s localhost:7788/api/_services | grep -A3 '"id": "files"'
curl -s 'localhost:7788/api/files?path=www'
```

O registry acha a pasta sozinho; o painel **Serviços** passa a mostrar as rotas
novas. Nenhum arquivo do core foi tocado.

## Ordem das rotas importa

O router casa **na ordem de registro**. Rotas fixas vêm antes das que têm
parâmetro, senão `/:id` engole tudo:

```js
{ method: 'GET', path: '/trash' },   // primeiro
{ method: 'GET', path: '/:id' },     // depois
```

## Detalhes que evitam dor

- **Valide na borda**: id, nome de arquivo e caminho. Use `path.resolve` +
  comparação com a raiz (`startsWith(ROOT + path.sep)`), nunca concatenação de
  strings.
- **Nada destrutivo sem rede de proteção**: o serviço de conversas renomeia para a
  lixeira em vez de apagar. Siga o mesmo espírito.
- **Cacheie por `mtime`** quando ler muitos arquivos (veja
  `services/conversations/repo.js`).
- **Erros com significado**: `badRequest` (entrada ruim), `notFound` (não existe),
  `conflict` (existe mas não pode agora). O front mostra a mensagem crua no toast,
  então escreva mensagens que um humano entenda.
- **Comandos externos**: prefira `execFile` (como em `sessions/repo.js`) a `exec` —
  sem shell, sem interpolação, sem injeção.

Próximo passo: [criar o painel que consome esse serviço](05-painel-novo.md).
