/**
 * sincronizarContaDaComissao contra um Postgres real (PGlite, em WASM).
 *
 * O que só um banco de verdade pega: o ON CONFLICT com guarda de tenant, o
 * `$5::jsonb`, o `data->>'codigo'` e a leitura da agência. Teste puro não vê
 * SQL errado — e SQL errado aqui é 500 em toda gravação de comissão.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
register('./ts-resolve-hook.mjs', import.meta.url);
const { sincronizarContaDaComissao, idDaContaDaComissao } = await import('../src/lib/comissao-conta.ts');

const db = new PGlite();
await db.exec(`
  CREATE TABLE agencia (id TEXT PRIMARY KEY, tenant_id TEXT, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT, codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT, fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  INSERT INTO agencia (id, tenant_id, data) VALUES ('ag-1', 't1', '{"datas_pagamento_comissao":[1,18]}');
  INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('23', 't1', '2.6', '{"codigo":"2.6"}'), ('99', 't2', '2.6', '{"codigo":"2.6"}');
`);
const exec = { query: async (text, values) => { const r = await db.query(text, values ?? []); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };

let total = 0, falhas = 0;
const eq = (a, b, label) => { total++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`); };
const ler = async (id, tenant = 't1') => (await db.query(`SELECT status, data FROM contas_pagar WHERE id = $1 AND tenant_id = $2`, [id, tenant])).rows[0] ?? null;

const base = { id: 'com-1', venda_id: 'v-1', venda_numero: 'V-42', vendedor_id: 'vd', vendedor_nome: 'Ana', plano_comissao_id: 'p', plano_nome: 'Escala', data_venda: '2026-09-03', valor_base: 3500, percentual_aplicado: 12, valor_comissao: 420, status: 'CALCULADA', data_aprovacao: null, data_pagamento: null, observacoes: '' };
const id = idDaContaDaComissao('com-1');

{ // cria
  const r = await sincronizarContaDaComissao('t1', base, exec, '2026-09-10');
  eq(r.acao, 'criada', 'primeira gravação cria a conta');
  const c = await ler(id);
  eq([c.status, c.data.valor_final, c.data.categoria_id, c.data.data_vencimento], ['PENDENTE', 420, '23', '2026-09-18'], 'pendente, R$ 420, em 2.6 do tenant certo, vence dia 18');
  eq(c.data.origem_comissao_id, 'com-1', 'marcada com a comissão de origem');
}
{ // recalcular com valor novo atualiza a MESMA conta
  const r = await sincronizarContaDaComissao('t1', { ...base, valor_comissao: 525 }, exec, '2026-09-10');
  eq(r.acao, 'atualizada', 'recálculo atualiza');
  eq((await db.query(`SELECT COUNT(*)::int AS n FROM contas_pagar WHERE tenant_id = 't1'`)).rows[0].n, 1, 'continua UMA conta');
  eq((await ler(id)).data.valor_final, 525, 'com o valor novo');
}
{ // edição manual sobrevive ao recálculo
  await db.query(`UPDATE contas_pagar SET data = data || '{"conta_bancaria_id":"cb-9","centro_custo":"Vendas"}' WHERE id = $1`, [id]);
  await sincronizarContaDaComissao('t1', { ...base, valor_comissao: 600 }, exec, '2026-09-10');
  const c = await ler(id);
  eq([c.data.conta_bancaria_id, c.data.centro_custo, c.data.valor_final], ['cb-9', 'Vendas', 600], 'conta bancária e centro de custo editados à mão ficam');
}
{ // conta baixada é intocável
  await db.query(`UPDATE contas_pagar SET status = 'PAGO', data = data || '{"status":"PAGO","valor_pago":600}' WHERE id = $1`, [id]);
  const r = await sincronizarContaDaComissao('t1', { ...base, valor_comissao: 999 }, exec, '2026-09-10');
  eq(r.acao, 'preservada', 'conta PAGA não é regravada');
  eq((await ler(id)).data.valor_final, 600, 'o valor pago fica');
  await db.query(`UPDATE contas_pagar SET status = 'PENDENTE', data = data || '{"status":"PENDENTE","valor_pago":null}' WHERE id = $1`, [id]);
}
{ // cancelamento e valor zero cancelam, não apagam
  const r = await sincronizarContaDaComissao('t1', { ...base, status: 'CANCELADA' }, exec, '2026-09-10');
  eq(r.acao, 'cancelada', 'comissão cancelada cancela a conta');
  eq((await ler(id)).status, 'CANCELADO', 'coluna status acompanha');
  await sincronizarContaDaComissao('t1', base, exec, '2026-09-10');
  const r2 = await sincronizarContaDaComissao('t1', { ...base, valor_comissao: 0 }, exec, '2026-09-10');
  eq(r2.acao, 'cancelada', 'valor zero cancela a conta pendente');
  eq((await db.query(`SELECT COUNT(*)::int AS n FROM contas_pagar`)).rows[0].n, 1, 'nada foi apagado');
}
{ // isolamento: o mesmo id em OUTRO tenant não é sobrescrito
  await db.query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1, 't2', 'PENDENTE', '{"valor_final": 1}')`, ['cp-comissao-com-2']);
  const r = await sincronizarContaDaComissao('t1', { ...base, id: 'com-2' }, exec, '2026-09-10');
  eq(r.acao, 'criada', 'o tenant t1 acha que criou');
  eq((await ler('cp-comissao-com-2', 't2')).data.valor_final, 1, 'a conta do tenant t2 ficou intacta (no-op pela guarda)');
  eq(await ler('cp-comissao-com-2', 't1'), null, 'e nada vazou para t1');
}
{ // sem agenda: fim do mês, com aviso
  await db.query(`UPDATE agencia SET data = '{}'`);
  await sincronizarContaDaComissao('t1', { ...base, id: 'com-3' }, exec, '2026-09-10');
  const c = await ler('cp-comissao-com-3');
  eq(c.data.data_vencimento, '2026-09-30', 'sem agenda vence no fim do mês');
  eq(c.data.observacoes.includes('não configurada'), true, 'e avisa');
}
console.log(`\n${total - falhas}/${total} testes SQL da conta da comissão passaram`);
if (falhas > 0) process.exit(1);
