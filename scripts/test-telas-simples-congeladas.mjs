/**
 * As telas da VERSÃO SIMPLES ficam congeladas (14/11/2026).
 *
 * As telas que existem nas duas versões (pagar, receber, DRE, fluxo de caixa,
 * contas bancárias, usuários...) têm o page.tsx escolhendo pela versão da
 * agência (modulos.ts): TelaCompleta.tsx ou TelaSimples.tsx. A TelaSimples e
 * as peças de apoio `*Simples` (BaixaDePagarSimples, colunasSimples...) são o
 * conteúdo de `origin/main` (commit a9fd7cf), byte a byte, com só duas
 * diferenças registradas em scripts/fixtures/telas-simples-a9fd7cf.json:
 *   - imports trocados para as peças `*Simples` vizinhas;
 *   - ajustes só de tipo, onde um tipo cresceu na versão completa.
 * O teste desfaz essas trocas e exige o mesmo sha256 do arquivo de a9fd7cf.
 * Com o histórico do git à mão, confere também direto no commit.
 *
 * Prova ainda que cada page.tsx compartilhada escolhe pela versão e que
 * nenhuma peça `*Simples` importa a peça da versão completa.
 *
 * Uso: node --no-warnings scripts/test-telas-simples-congeladas.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifesto = JSON.parse(readFileSync(path.join(RAIZ, 'scripts/fixtures/telas-simples-a9fd7cf.json'), 'utf8'));

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
/** Troca exatamente `de` por `para` dentro de um especificador de import entre aspas. */
const trocarImport = (fonte, de, para) => fonte.split(`'${de}'`).join(`'${para}'`).split(`"${de}"`).join(`"${para}"`);

let git = false;
try { execFileSync('git', ['cat-file', '-e', 'a9fd7cf^{commit}'], { cwd: RAIZ, stdio: 'ignore' }); git = true; } catch { /* sem histórico */ }

console.log(`--- ${manifesto.telas.length} arquivos da versão simples iguais a ${manifesto.origem} ---`);
for (const t of manifesto.telas) {
  const caminho = path.join(RAIZ, t.arquivo);
  if (!existsSync(caminho)) { eq(false, true, `${t.arquivo} existe`); continue; }
  let fonte = readFileSync(caminho, 'utf8');
  for (const [novo, antigo] of t.ajustes_de_tipo ?? []) fonte = fonte.split(novo).join(antigo);
  // Correção de segurança que a tela simples precisou receber (ex.: a senha vai em texto e o
  // hash é feito no servidor, FIN-15): desfeita aqui para conferir o resto contra a9fd7cf.
  for (const [novo, antigo] of t.ajustes_de_seguranca ?? []) fonte = fonte.split(novo).join(antigo);
  for (const [novo, antigo] of t.imports_trocados) fonte = trocarImport(fonte, novo, antigo);
  eq(sha(fonte), t.sha256, `${t.arquivo} = ${t.original} de ${manifesto.origem} (salvo imports e ajustes de tipo)`);
  if (git) {
    const original = execFileSync('git', ['show', `${manifesto.origem}:${t.original}`], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    eq(sha(original), t.sha256, `${t.original}: o retrato confere com o commit ${manifesto.origem}`);
  }
}

console.log('\n--- cada tela compartilhada escolhe pela versão da agência ---');
const telas = manifesto.telas.filter(t => t.arquivo.endsWith('/TelaSimples.tsx'));
for (const t of telas) {
  const pagina = readFileSync(path.join(RAIZ, path.dirname(t.arquivo), 'page.tsx'), 'utf8');
  const escolhe = /useModulos\(\)/.test(pagina) && /(telasCompletas|modulos\.tem\('[a-z_]+'\))\s*\?\s*<TelaCompleta[^>]*\/>\s*:\s*<TelaSimples/.test(pagina);
  eq(escolhe, true, `${path.dirname(t.arquivo)}/page.tsx abre a completa só com o módulo`);
  eq(existsSync(path.join(RAIZ, path.dirname(t.arquivo), 'TelaCompleta.tsx')), true, `${path.dirname(t.arquivo)}: a versão completa existe ao lado`);
}

console.log('\n--- a versão simples não usa peça da versão completa que mudou ---');
const comCopia = new Map(manifesto.telas.filter(t => !t.arquivo.endsWith('/TelaSimples.tsx')).map(t => [t.original.replace(/\.(tsx|ts)$/, ''), t.arquivo]));
for (const t of manifesto.telas) {
  const fonte = readFileSync(path.join(RAIZ, t.arquivo), 'utf8');
  const usados = [...fonte.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
    .map(s => (s.startsWith('@/') ? `src/${s.slice(2)}` : s.startsWith('.') ? path.normalize(path.join(path.dirname(t.arquivo), s)) : null))
    .filter(Boolean);
  const errados = usados.filter(u => comCopia.has(u));
  eq(errados, [], `${t.arquivo} usa as peças Simples`);
}

console.log(`\n${total - falhas}/${total} verificações das telas da versão simples passaram`);
if (falhas > 0) process.exit(1);
