/**
 * Hook para rodar o código de produção INTEIRO contra um Postgres real
 * (PGlite), inclusive o que usa o pool direto, como o webhook do CRM.
 *
 * Faz quatro coisas, e só elas:
 *
 * 1. Quem importa `src/lib/db.ts` recebe `scripts/db-de-teste.mjs`, cujo pool
 *    é o que o teste pendurou em `globalThis.__POOL_DE_TESTE__` antes do
 *    primeiro import. Nenhum banco de verdade é tocado.
 * 2. Os .ts de `src/` são transpilados pelo TypeScript em vez de só terem os
 *    tipos removidos. O `--experimental-strip-types` não sabe que
 *    `import { Interface } from './x'` é só de tipo e quebra no import; o
 *    transpilador descarta esse import, como o build faz.
 * 3. 'next/server' vira 'next/server.js', para as rotas carregarem fora do
 *    Next (o pacote não declara 'exports').
 * 4. 'next/headers' vira `scripts/next-headers-de-teste.mjs`: o cookie de
 *    sessão é o que o teste pendurou em `globalThis.__COOKIE_DE_TESTE__`, e
 *    sem ele não há sessão. Assim as rotas que leem o tenant da sessão rodam
 *    inteiras, com a autenticação e as permissões de produção.
 *
 * Registrar DEPOIS do ts-resolve-hook: o último registrado roda primeiro e
 * recebe o caminho já resolvido pelo anterior.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SRC = pathToFileURL(path.join(AQUI, '..', 'src') + path.sep).href;
const STUB = pathToFileURL(path.join(AQUI, 'db-de-teste.mjs')).href;
const STUB_HEADERS = pathToFileURL(path.join(AQUI, 'next-headers-de-teste.mjs')).href;

export async function resolve(specifier, context, next) {
  // O pacote next não declara 'exports': fora do bundler, o caminho é com .js.
  if (specifier === 'next/server') return next('next/server.js', context);
  if (specifier === 'next/headers') return { url: STUB_HEADERS, shortCircuit: true };
  const r = await next(specifier, context);
  if (r.url && /\/src\/lib\/db\.ts$/.test(r.url)) return { url: STUB, shortCircuit: true };
  return r;
}

export async function load(url, context, next) {
  if (url.startsWith(SRC) && /\.tsx?$/.test(url)) {
    const fonte = await readFile(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(fonte, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: fileURLToPath(url),
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
