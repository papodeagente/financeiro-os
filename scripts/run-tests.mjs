// Registra o resolver e roda um arquivo de teste.
// Uso: node --experimental-strip-types scripts/run-tests.mjs scripts/test-financeiro.ts
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

register('./ts-resolve-hook.mjs', import.meta.url);
const alvo = process.argv[2];
if (!alvo) { console.error('uso: run-tests.mjs <arquivo>'); process.exit(2); }
await import(pathToFileURL(path.resolve(alvo)).href);
