/**
 * Reset da conta (src/lib/reset-da-conta.ts) contra um Postgres real
 * (PGlite). Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (a) toda tabela das categorias existe no db.ts e tem tenant_id: um nome
 *       errado faria o reset inteiro voltar com erro, e uma tabela sem
 *       tenant_id apagaria a de todas as contas;
 *   (b) a agência não vê nem consegue zerar cadastros, CRM e plataformas;
 *   (c) a conta do ecossistema zera tudo: dados, cadastros, a integração com
 *       o CRM (fila de saída junto) e as plataformas, com as credenciais;
 *   (d) mesmo zerando tudo, ficam usuários, dados da empresa, dados fiscais,
 *       assinatura e auditoria;
 *   (e) as outras contas não perdem nada, nem as linhas órfãs (tenant_id '');
 *       e sem conta identificada nada é apagado.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-reset-da-conta.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const exec = { query };
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { CATEGORIES, categoriasDaConta, apagarCategorias, contarCategorias } = await import('../src/lib/reset-da-conta.ts');
const { perfilDaConta } = await import('../src/lib/perfil-da-conta.ts');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (a) as tabelas do reset são as do db.ts, todas com tenant_id ---');
const fonte = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
// As tabelas que ganham tenant_id no laço da migração multi-tenant.
const laco = fonte.slice(fonte.indexOf('const TENANT_TABLES = ['), fonte.indexOf('];', fonte.indexOf('const TENANT_TABLES = [')));
const doLaco = new Set([...laco.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
if (!doLaco.has('clientes')) { console.log('FAIL  não consegui ler TENANT_TABLES de src/lib/db.ts'); process.exit(1); }
const comTenant = t => {
  const i = fonte.search(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\s*\\(`));
  if (i < 0) return 'não existe no db.ts';
  const bloco = fonte.slice(i, fonte.indexOf(');', i));
  return bloco.includes('tenant_id') || doLaco.has(t) ? 'ok' : 'sem tenant_id';
};
const todas = Object.values(CATEGORIES).flat();
eq(todas.filter(t => comTenant(t) !== 'ok').map(t => `${t}: ${comTenant(t)}`), [], `as ${todas.length} tabelas existem e têm tenant_id`);
eq(todas.length, new Set(todas).size, 'nenhuma tabela aparece em duas categorias');

// O banco do teste: toda tabela do reset, mais as que nunca podem sair.
const FICAM = ['usuarios', 'agencia', 'config_fiscal', 'assinaturas', 'audit_log', 'config_apis'];
await pg.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);`);
for (const t of [...todas, ...FICAM]) {
  await pg.exec(`CREATE TABLE ${t} (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY (id, tenant_id));`);
}
const ENTUR = 't-entur', AGENCIA = 't-agencia', OUTRA = 't-outra';
await query(`INSERT INTO tenants (id, numero, data) VALUES ($1, 1, '{"perfil":"ecossistema"}'), ($2, 2, '{}'), ($3, 3, '{}')`, [ENTUR, AGENCIA, OUTRA]);
// Duas linhas por tabela em cada conta, e uma órfã.
for (const t of [...todas, ...FICAM]) {
  for (const conta of [ENTUR, AGENCIA, OUTRA]) {
    await query(`INSERT INTO ${t} (id, tenant_id) VALUES ('a', $1), ('b', $1)`, [conta]);
  }
  await query(`INSERT INTO ${t} (id, tenant_id) VALUES ('orfa', '')`);
}
const linhas = async (t, conta) => Number((await query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [conta])).rows[0].n);
const somaDe = async (tabelas, conta) => { let s = 0; for (const t of tabelas) s += await linhas(t, conta); return s; };

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) a agência não zera cadastros, CRM nem plataformas ---');
const perfilAgencia = await perfilDaConta(AGENCIA, exec);
eq(perfilAgencia, 'agencia', 'a conta 2 é agência');
eq(categoriasDaConta(perfilAgencia), ['financeiro', 'produtos', 'grupos', 'mapas_mentais', 'funis', 'fluxogramas'], 'a agência vê só as seis categorias de sempre');
eq(Object.keys(await contarCategorias(exec, AGENCIA, perfilAgencia)).includes('cadastros_e_crm'), false, 'a contagem da agência não mostra cadastros e CRM');
let erro = null;
try { await apagarCategorias(exec, AGENCIA, perfilAgencia, ['financeiro', 'cadastros_e_crm']); } catch (e) { erro = e.message; }
eq(erro, 'A categoria cadastros_e_crm não existe nesta conta', 'pedir cadastros e CRM numa agência lança');
eq([await linhas('contas_receber', AGENCIA), await linhas('clientes', AGENCIA)], [2, 2], 'e lança antes de apagar qualquer coisa, nem o financeiro');
erro = null;
try { await apagarCategorias(exec, AGENCIA, perfilAgencia, ['plataformas']); } catch (e) { erro = e.message; }
eq(erro, 'A categoria plataformas não existe nesta conta', 'pedir plataformas numa agência lança');
const ag = await apagarCategorias(exec, AGENCIA, perfilAgencia, categoriasDaConta(perfilAgencia));
eq([await linhas('contas_receber', AGENCIA), await linhas('clientes', AGENCIA), await linhas('crm_config', AGENCIA), await linhas('plataformas_config', AGENCIA)], [0, 2, 2, 2],
  'zerar tudo na agência apaga o financeiro e deixa clientes, CRM e plataformas');
eq(ag.summary.clientes, undefined, 'o resumo da agência não fala de clientes');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) a conta do ecossistema zera tudo ---');
const perfilEntur = await perfilDaConta(ENTUR, exec);
eq(perfilEntur, 'ecossistema', 'a conta 1 é o ecossistema');
const cats = categoriasDaConta(perfilEntur);
eq(cats.slice(-2), ['cadastros_e_crm', 'plataformas'], 'o ecossistema vê as duas categorias a mais');
const antes = await contarCategorias(exec, ENTUR, perfilEntur);
eq([antes.cadastros_e_crm, antes.plataformas], [CATEGORIES.cadastros_e_crm.length * 2, CATEGORIES.plataformas.length * 2], 'a prévia conta as linhas da conta, sem as órfãs');
const r = await apagarCategorias(exec, ENTUR, perfilEntur, cats);
eq(r.total, todas.length * 2, `apagou ${todas.length * 2} linhas, duas por tabela`);
eq(await somaDe(todas, ENTUR), 0, 'não sobra nada da conta 1 em nenhuma tabela do reset');
eq([r.summary.crm_config, r.summary.crm_eventos_saida, r.summary.plataformas_config, r.summary.membros], [2, 2, 2, 2],
  'saem a integração com o CRM, a fila de saída, as credenciais das plataformas e a equipe antiga');
eq(Object.values(await contarCategorias(exec, ENTUR, perfilEntur)).every(n => n === 0), true, 'a prévia depois do reset mostra tudo zerado');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) o que nunca sai ---');
eq(await Promise.all(FICAM.map(t => linhas(t, ENTUR))), FICAM.map(() => 2), `ficam ${FICAM.join(', ')}`);

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) as outras contas e as órfãs ---');
eq(await somaDe(todas, OUTRA), todas.length * 2, 'a conta 3 não perdeu nenhuma linha');
eq(await somaDe(todas, ''), todas.length, 'as linhas órfãs (tenant_id vazio) continuam lá');
erro = null;
try { await apagarCategorias(exec, '', 'ecossistema', ['financeiro']); } catch (e) { erro = e.message; }
eq([erro, await linhas('contas_receber', '')], ['Conta não identificada', 1], 'sem conta identificada, nada é apagado');

console.log(`\n${total - falhas}/${total} testes do reset da conta passaram`);
if (falhas > 0) process.exit(1);
