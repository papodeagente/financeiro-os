/**
 * Resolver para rodar os testes com `node --experimental-strip-types`.
 *
 * O código do app usa imports sem extensão ('./utils') e o alias '@/'
 * do tsconfig — o resolver nativo do Node não conhece nenhum dos dois.
 * Este hook só traduz caminhos; não altera nada do que é executado.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tentarExtensoes(base) {
  for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of ['.ts', '.tsx', '.js']) {
    const idx = path.join(base, 'index' + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  // alias '@/x' -> <root>/src/x
  if (specifier.startsWith('@/')) {
    const base = path.join(ROOT, 'src', specifier.slice(2));
    const achado = tentarExtensoes(base) || (existsSync(base) ? base : null);
    if (achado) return next(pathToFileURL(achado).href, context);
  }
  // relativo sem extensão
  if (specifier.startsWith('.') && !path.extname(specifier)) {
    const pai = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : ROOT;
    const achado = tentarExtensoes(path.resolve(pai, specifier));
    if (achado) return next(pathToFileURL(achado).href, context);
  }
  return next(specifier, context);
}
