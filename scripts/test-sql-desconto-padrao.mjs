/**
 * Desconto padrão por plataforma contra um Postgres real (PGlite).
 *
 * O DDL é lido de src/lib/db.ts, não copiado: se alguém mudar a tabela lá,
 * este teste roda contra a versão nova.
 *
 * O que precisa ser verdade:
 *   - "Pagar.me", "pagarme" e "PAGAR ME" são o MESMO padrão (uma linha);
 *   - uma agência não lê nem apaga o padrão de outra;
 *   - percentual impossível é recusado com mensagem, não com erro do banco;
 *   - o CHECK da tabela segura quem escrever por fora do módulo.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
register('./ts-resolve-hook.mjs', import.meta.url);
const { listarDescontosPadrao, salvarDescontoPadrao, removerDescontoPadrao, ErroDescontoPadrao } =
  await import('../src/lib/desconto-padrao.ts');

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const fonte = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const ddl = fonte.match(/CREATE TABLE IF NOT EXISTS plataformas_desconto_padrao \([\s\S]*?\n {4}\);/)?.[0];
eq(Boolean(ddl), true, 'o DDL da tabela está em db.ts');

const pg = new PGlite();
await pg.exec(ddl);
// initDB roda a cada boot: rodar de novo não pode quebrar.
await pg.exec(ddl);
const exec = { query: async (text, values) => { const r = await pg.query(text, values ?? []); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };
const linhas = async () => (await pg.query(`SELECT tenant_id, chave, plataforma, percentual::text AS p FROM plataformas_desconto_padrao ORDER BY tenant_id, chave`)).rows;
async function recusa(fn) {
  try { await fn(); return 'aceitou'; } catch (e) { return e instanceof ErroDescontoPadrao ? e.message : `erro cru: ${e.message}`; }
}

console.log('--- guardar e ler ---');
eq(await salvarDescontoPadrao(exec, 't1', 'hotmart', 9.9, 'Bruno'), { plataforma: 'Hotmart', percentual: 9.9 }, 'grava com o nome canônico');
eq(await listarDescontosPadrao(exec, 't1'), [{ plataforma: 'Hotmart', percentual: 9.9 }], 'lê como número, não como texto');

console.log('--- a mesma plataforma com outra grafia é o mesmo padrão ---');
await salvarDescontoPadrao(exec, 't1', 'Pagar.me', 3.99);
await salvarDescontoPadrao(exec, 't1', 'PAGAR ME', 4.49);
await salvarDescontoPadrao(exec, 't1', 'pagarme', 4.99);
eq((await linhas()).filter(l => l.chave === 'pagarme').length, 1, 'três grafias, uma linha');
eq((await listarDescontosPadrao(exec, 't1')).find(p => p.plataforma === 'Pagar.me')?.percentual, 4.99, 'vale o último salvo');

console.log('--- plataforma que o sistema não conhece ---');
eq(await salvarDescontoPadrao(exec, 't1', '  Minha   Maquininha ', 2.5), { plataforma: 'Minha Maquininha', percentual: 2.5 }, 'nome livre com espaço arrumado');

console.log('--- isolamento entre agências ---');
await salvarDescontoPadrao(exec, 't2', 'Hotmart', 12);
eq((await listarDescontosPadrao(exec, 't1')).find(p => p.plataforma === 'Hotmart')?.percentual, 9.9, 't1 continua com o dele');
eq(await listarDescontosPadrao(exec, 't2'), [{ plataforma: 'Hotmart', percentual: 12 }], 't2 só vê o dele');
eq(await removerDescontoPadrao(exec, 't2', 'Pagar.me'), false, 't2 não apaga o Pagar.me de t1');
eq((await listarDescontosPadrao(exec, 't1')).length, 3, 't1 intacto');

console.log('--- o impossível é recusado com mensagem ---');
eq(await recusa(() => salvarDescontoPadrao(exec, 't1', 'Stone', 0)), 'Informe o percentual do desconto.', 'zero');
eq(await recusa(() => salvarDescontoPadrao(exec, 't1', 'Stone', 100)), 'O percentual precisa ficar entre 0% e 100%.', '100%');
eq(await recusa(() => salvarDescontoPadrao(exec, 't1', 'Stone', -3)), 'O percentual precisa ficar entre 0% e 100%.', 'negativo');
eq(await recusa(() => salvarDescontoPadrao(exec, 't1', 'Stone', Number.NaN)), 'Informe o percentual do desconto.', 'NaN (corpo sem número)');
eq(await recusa(() => salvarDescontoPadrao(exec, 't1', 'Stone', 0.004)), 'Informe o percentual do desconto.', '0,004% arredonda para zero e é recusado antes do banco');
eq(await recusa(() => salvarDescontoPadrao(exec, 't1', '   ', 5)), 'Escolha a plataforma.', 'sem plataforma');
eq(await recusa(() => salvarDescontoPadrao(exec, 't1', '...', 5)), 'Escolha a plataforma.', 'só pontuação não é plataforma');
eq((await listarDescontosPadrao(exec, 't1')).some(p => p.plataforma === 'Stone'), false, 'nada foi gravado');
eq(await salvarDescontoPadrao(exec, 't1', 'Stone', 1.999), { plataforma: 'Stone', percentual: 2 }, 'três casas viram duas');

console.log('--- o banco também segura ---');
let barrou = false;
try { await pg.query(`INSERT INTO plataformas_desconto_padrao (tenant_id, chave, plataforma, percentual) VALUES ('t9','x','X',150)`); }
catch { barrou = true; }
eq(barrou, true, 'CHECK recusa 150% gravado por fora do módulo');

console.log('--- remover ---');
eq(await removerDescontoPadrao(exec, 't1', 'HOTMART'), true, 'remove pela chave');
eq((await listarDescontosPadrao(exec, 't1')).some(p => p.plataforma === 'Hotmart'), false, 'sumiu de t1');
eq((await listarDescontosPadrao(exec, 't2')).length, 1, 't2 não foi tocado');
eq(await removerDescontoPadrao(exec, 't1', 'Hotmart'), false, 'remover de novo devolve false');
eq(await removerDescontoPadrao(exec, 't1', ''), false, 'sem plataforma não apaga nada');

console.log(`\n${total - falhas}/${total} testes do desconto padrão passaram`);
if (falhas > 0) process.exit(1);
