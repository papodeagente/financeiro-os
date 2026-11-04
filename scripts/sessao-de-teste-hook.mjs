/**
 * Hook para testes que chamam as ROTAS de verdade: quem importa
 * src/lib/auth.ts recebe scripts/sessao-de-teste.mjs, cuja sessão é a de
 * globalThis.__SESSAO_DE_TESTE__. Registrar junto com db-de-teste-hook.mjs.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(path.join(AQUI, 'sessao-de-teste.mjs')).href;

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url && /\/src\/lib\/auth\.ts$/.test(r.url)) return { url: STUB, shortCircuit: true };
  return r;
}
