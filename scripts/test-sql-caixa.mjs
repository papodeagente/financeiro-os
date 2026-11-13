/**
 * Testa o código REAL de src/lib/caixa-atomico.ts contra um Postgres de
 * verdade (PGlite, Postgres compilado em WASM — sem servidor externo).
 *
 * As funções recebem um ExecutorSQL injetável, então o que roda aqui é a
 * query que roda em produção — não uma cópia. Isso cobre: sintaxe do SQL,
 * jsonb_set + ROUND com numeric, guarda otimista por xmin, idempotência da
 * baixa em duplo clique, saldo legado (ausente/texto) e isolamento de tenant.
 *
 * Uso: node --no-warnings scripts/test-sql-caixa.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

register('./ts-resolve-hook.mjs', import.meta.url);
const modUrl = pathToFileURL(path.resolve(import.meta.dirname, '../src/lib/caixa-atomico.ts')).href;
const { aplicarMovimentoCaixaAtomico, atualizarContaComGuarda, estornarBaixaDaConta, valorBaixado,
        calcularMovimentos, valorNoCaixa, STATUS_BAIXADOS } =
  await import(modUrl);

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE contas_receber (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
    venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '', status TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

// Adapta o PGlite à interface ExecutorSQL esperada pelo código de produção.
const exec = {
  async query(text, values) {
    const r = await pg.query(text, values);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
};

const saldo = async id => {
  const r = await pg.query(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id = $1`, [id]);
  return Number(r.rows[0]?.s ?? null);
};
const novaConta = (id, tenant, data) =>
  pg.query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1,$2,$3)`, [id, tenant, JSON.stringify(data)]);

console.log('--- aplicarMovimentoCaixaAtomico (código real) ---');
await novaConta('c1', 't1', { nome: 'Inter', saldo_inicial: 1000, saldo_atual: 1000 });
eq(await aplicarMovimentoCaixaAtomico('t1', 'c1', 250.55, exec), true, 'crédito devolve true');
eq(await saldo('c1'), 1250.55, 'crédito soma ao saldo');
await aplicarMovimentoCaixaAtomico('t1', 'c1', -300.05, exec);
eq(await saldo('c1'), 950.5, 'débito subtrai do saldo');

for (let i = 0; i < 300; i++) await aplicarMovimentoCaixaAtomico('t1', 'c1', 0.01, exec);
eq(await saldo('c1'), 953.5, '300 x R$0,01 = +R$3,00 exato (numeric, sem erro de float)');

eq(await aplicarMovimentoCaixaAtomico('t1', 'c1', 0, exec), false, 'delta zero não gera escrita');
eq(await saldo('c1'), 953.5, 'saldo intacto após delta zero');

console.log('--- dados legados / defensivos ---');
await novaConta('c2', 't1', { nome: 'Sem saldo' });
await aplicarMovimentoCaixaAtomico('t1', 'c2', 100, exec);
eq(await saldo('c2'), 100, 'saldo_atual ausente vira 0 + delta (não quebra)');

await novaConta('c3', 't1', { nome: 'Texto', saldo_atual: 'abc' });
await aplicarMovimentoCaixaAtomico('t1', 'c3', 50, exec);
eq(await saldo('c3'), 50, 'saldo textual inválido não derruba a query');

await novaConta('c4', 't1', { nome: 'String num', saldo_atual: '250.75' });
await aplicarMovimentoCaixaAtomico('t1', 'c4', 10, exec);
eq(await saldo('c4'), 260.75, 'saldo gravado como string numérica é respeitado');

console.log('--- isolamento de tenant ---');
eq(await aplicarMovimentoCaixaAtomico('OUTRO', 'c1', 9999, exec), false, 'tenant errado não move saldo');
eq(await saldo('c1'), 953.5, 'saldo intacto após tentativa cross-tenant');

console.log('--- atualizarContaComGuarda: baixa idempotente ---');
await pg.query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1,$2,$3,$4)`,
  ['cr1', 't1', 'PENDENTE', JSON.stringify({ id: 'cr1', status: 'PENDENTE', valor_final: 1000 })]);

const lerVersao = async id => {
  const q = await pg.query(`SELECT xmin::text AS v, data FROM contas_receber WHERE id = $1`, [id]);
  return { versao: q.rows[0].v, data: q.rows[0].data };
};

const { versao: v1 } = await lerVersao('cr1');
const baixa = { id: 'cr1', status: 'RECEBIDO', valor_final: 1000, valor_recebido: 1000 };
const params = (versao, item, statusAlvo) => ({
  exec, tabela: 'contas_receber', colunasIndice: ['venda_id', 'cliente_id', 'status'],
  id: 'cr1', tenantId: 't1', item, versaoAnterior: versao, statusAlvo,
});

eq(await atualizarContaComGuarda(params(v1, baixa, 'RECEBIDO')), true, 'primeira baixa passa');
eq(await atualizarContaComGuarda(params(v1, baixa, 'RECEBIDO')), false,
   'duplo clique com versão velha NÃO passa (sem crédito duplicado)');

const { versao: v2 } = await lerVersao('cr1');
eq(await atualizarContaComGuarda(params(v2, baixa, 'RECEBIDO')), false,
   'segunda baixa no mesmo status é bloqueada mesmo com versão fresca');

const estorno = { id: 'cr1', status: 'PENDENTE', valor_final: 1000 };
eq(await atualizarContaComGuarda(params(v2, estorno, 'PENDENTE')), true,
   'estorno (transição para outro status) passa');

const dep = await pg.query(`SELECT status, data->>'status' AS ds FROM contas_receber WHERE id = 'cr1'`);
eq([dep.rows[0].status, dep.rows[0].ds], ['PENDENTE', 'PENDENTE'],
   'coluna indexada e JSONB ficam em sincronia');

console.log('--- estornarBaixaDaConta usa a conta que recebeu ---');
await novaConta('cx', 't1', { nome: 'Origem', saldo_atual: 500 });
await estornarBaixaDaConta('t1', 'contas_receber',
  { status: 'RECEBIDO', valor_recebido: 200, valor_final: 200, conta_bancaria_id: 'cx' }, exec);
eq(await saldo('cx'), 300, 'estorno de CR debita a conta que recebeu');
await estornarBaixaDaConta('t1', 'contas_pagar',
  { status: 'PAGO', valor_pago: 150, valor_final: 150, conta_bancaria_id: 'cx' }, exec);
eq(await saldo('cx'), 450, 'estorno de CP credita a conta que pagou');
await estornarBaixaDaConta('t1', 'contas_receber',
  { status: 'PENDENTE', valor_final: 999, conta_bancaria_id: 'cx' }, exec);
eq(await saldo('cx'), 450, 'conta não baixada não estorna nada');

console.log('--- valorBaixado: precedência dos campos ---');
eq(valorBaixado({ valor_recebido: 80, valor_final: 100 }, 'valor_recebido'), 80, 'usa o valor efetivamente baixado');
eq(valorBaixado({ valor_recebido: null, valor_final: 100 }, 'valor_recebido'), 100, 'cai no valor_final quando não há baixa parcial');
eq(valorBaixado({ valor_pago: 0, valor_final: 100 }, 'valor_pago'), 100, 'zero cai no valor_final (mesma precedência das rotas)');

console.log('--- STATUS_BAIXADOS protege as contas já movimentadas ---');
await pg.query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES
  ('a','t1','PENDENTE','{"status":"PENDENTE"}'), ('b','t1','RECEBIDO','{"status":"RECEBIDO"}'),
  ('c','t1','PARCIAL','{"status":"PARCIAL"}')`);
const del = await pg.query(
  `DELETE FROM contas_receber WHERE tenant_id = $1 AND NOT (COALESCE(data->>'status','') = ANY($2::text[])) RETURNING id`,
  ['t1', [...STATUS_BAIXADOS]]);
eq(del.rows.map(x => x.id).sort(), ['a', 'cr1'], 'regeneração apaga só as não baixadas');
const restantes = await pg.query(`SELECT id FROM contas_receber ORDER BY id`);
eq(restantes.rows.map(x => x.id), ['b', 'c'], 'RECEBIDO e PARCIAL sobrevivem à regeneração');


console.log('--- calcularMovimentos: baixa PARCIAL move o caixa (regressão 2026-09) ---');
const CR = (over) => ({ conta_bancaria_id: 'c1', valor_final: 1000, ...over });
const mov = (prev, novo, campo = 'valor_recebido', sinal = 1) => calcularMovimentos(prev, novo, campo, sinal);

eq(mov(CR({ status: 'PENDENTE' }), CR({ status: 'PARCIAL', valor_recebido: 300 })),
   [{ conta: 'c1', delta: 300 }], 'PENDENTE -> PARCIAL(300) credita 300');
eq(mov(CR({ status: 'PARCIAL', valor_recebido: 300 }), CR({ status: 'PARCIAL', valor_recebido: 500 })),
   [{ conta: 'c1', delta: 200 }], 'PARCIAL(300) -> PARCIAL(500) credita só a diferença');
eq(mov(CR({ status: 'PARCIAL', valor_recebido: 500 }), CR({ status: 'RECEBIDO', valor_recebido: 1000 })),
   [{ conta: 'c1', delta: 500 }], 'PARCIAL(500) -> RECEBIDO(1000) credita o restante');
eq(mov(CR({ status: 'PARCIAL', valor_recebido: 300 }), CR({ status: 'PENDENTE' })),
   [{ conta: 'c1', delta: -300 }], 'estorno de PARCIAL devolve o que entrou');
eq(mov(CR({ status: 'PENDENTE' }), CR({ status: 'RECEBIDO', valor_recebido: 1000 })),
   [{ conta: 'c1', delta: 1000 }], 'PENDENTE -> RECEBIDO credita o total');
eq(mov(CR({ status: 'RECEBIDO', valor_recebido: 1000 }), CR({ status: 'PENDENTE' })),
   [{ conta: 'c1', delta: -1000 }], 'estorno total');
eq(mov(CR({ status: 'PENDENTE' }), CR({ status: 'PENDENTE' })), [], 'edição sem baixa não move caixa');
eq(mov(CR({ status: 'RECEBIDO', valor_recebido: 1000 }), CR({ status: 'RECEBIDO', valor_recebido: 1000 })),
   [], 'salvar sem mudar valor não move caixa');

console.log('--- troca de conta bancária ---');
eq(mov(CR({ status: 'RECEBIDO', valor_recebido: 1000 }), CR({ status: 'RECEBIDO', valor_recebido: 1000, conta_bancaria_id: 'c2' })),
   [{ conta: 'c1', delta: -1000 }, { conta: 'c2', delta: 1000 }], 'troca de conta move o dinheiro entre elas');
eq(mov(CR({ status: 'PARCIAL', valor_recebido: 400 }), CR({ status: 'RECEBIDO', valor_recebido: 1000, conta_bancaria_id: 'c2' })),
   [{ conta: 'c1', delta: -400 }, { conta: 'c2', delta: 1000 }], 'quitação em outra conta tira o parcial da antiga');
eq(mov(CR({ status: 'RECEBIDO', valor_recebido: 1000 }), CR({ status: 'PENDENTE', conta_bancaria_id: 'c2' })),
   [{ conta: 'c1', delta: -1000 }], 'estorno sempre debita a conta que RECEBEU (não a do payload)');

console.log('--- contas a pagar: sinal invertido ---');
const CP = (over) => ({ conta_bancaria_id: 'c1', valor_final: 800, ...over });
eq(mov(CP({ status: 'PENDENTE' }), CP({ status: 'PARCIAL', valor_pago: 200 }), 'valor_pago', -1),
   [{ conta: 'c1', delta: -200 }], 'pagamento parcial debita 200');
eq(mov(CP({ status: 'PARCIAL', valor_pago: 200 }), CP({ status: 'PAGO', valor_pago: 800 }), 'valor_pago', -1),
   [{ conta: 'c1', delta: -600 }], 'quitação debita o restante');
eq(mov(CP({ status: 'PAGO', valor_pago: 800 }), CP({ status: 'PENDENTE' }), 'valor_pago', -1),
   [{ conta: 'c1', delta: 800 }], 'estorno de pagamento credita de volta');

console.log('--- valorNoCaixa: conta pendente não vale dinheiro ---');
eq(valorNoCaixa({ status: 'PENDENTE', valor_final: 1000 }, 'valor_recebido'), 0, 'PENDENTE = 0 no caixa');
eq(valorNoCaixa({ status: 'PARCIAL', valor_recebido: 300, valor_final: 1000 }, 'valor_recebido'), 300, 'PARCIAL vale o acumulado');
eq(valorNoCaixa({ status: 'RECEBIDO', valor_recebido: null, valor_final: 1000 }, 'valor_recebido'), 1000, 'RECEBIDO sem valor cai no total');

console.log('--- estorno em conta PARCIAL (DELETE) ---');
await novaConta('cp1', 't1', { nome: 'Parcial', saldo_atual: 1000 });
await estornarBaixaDaConta('t1', 'contas_receber',
  { status: 'PARCIAL', valor_recebido: 250, valor_final: 1000, conta_bancaria_id: 'cp1' }, exec);
eq(await saldo('cp1'), 750, 'excluir CR PARCIAL debita só o que foi recebido');
await estornarBaixaDaConta('t1', 'contas_pagar',
  { status: 'PARCIAL', valor_pago: 150, valor_final: 800, conta_bancaria_id: 'cp1' }, exec);
eq(await saldo('cp1'), 900, 'excluir CP PARCIAL credita só o que foi pago');

console.log(`\n${total - falhas}/${total} testes SQL passaram`);
await pg.close();
if (falhas) process.exit(1);
