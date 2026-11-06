/**
 * Contas bancárias (06/11/2026, E7) contra um Postgres real (PGlite),
 * chamando as ROTAS de produção:
 *  1. Cadastro com titular, banco da lista oficial e dígitos separados;
 *     documento/dígito/código inválidos recusados.
 *  2. Edição simultânea: GET traz `_versao`; PUT com versão velha = 409.
 *  3. Desativar: a lista continua devolvendo a conta (relatórios).
 *  4. Excluir: recusado (409, `com_movimento`) com título, transferência ou
 *     saldo mexido; aceito na conta nunca usada; operador não exclui.
 *  5. Transferência com nº do cheque (só números) e o cheque no extrato;
 *     coluna "Fechado" no extrato pelo Fechar Caixa.
 *
 * Uso: node --no-warnings scripts/test-sql-contas-bancarias-e7.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_origem_id TEXT NOT NULL DEFAULT '',
    conta_destino_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '',
    status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE clientes (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE fornecedores_crm (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '',
    categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE vendas_crm (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-contas-bancarias-e7';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);
const P = await import('../src/lib/permissoes-servidor.ts');
const CB = await import('../src/app/api/contas-bancarias/route.ts');
const CBI = await import('../src/app/api/contas-bancarias/[id]/route.ts');
const TR = await import('../src/app/api/transferencias/route.ts');
const { lerFiltro, lerMovimentos } = await import('../src/lib/movimentos-caixa.ts');

const T = 'ag-1';
const sessao = perfil => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
const ctx = id => ({ params: Promise.resolve({ id }) });
const dadosDe = async id => (await query(`SELECT data FROM contas_bancarias WHERE id = $1`, [id])).rows[0]?.data;
for (const [id, perfil] of [['u-ADMIN', 'ADMIN'], ['u-OPERADOR', 'OPERADOR']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, T, JSON.stringify({ id, nome: id, perfil, ativo: true })]);
}

console.log('--- 1. Cadastro ---');
como(sessao('ADMIN'));
let r = await json(await CB.POST(req('/api/contas-bancarias', 'POST', {
  id: 'inter', nome: 'Inter PJ', tipo: 'CORRENTE', banco: '', banco_codigo: '77', agencia: '0001', agencia_digito: '9', conta: '12345', conta_digito: 'x',
  titular: ' Entur  Viagens ', titular_documento: '12.345.678/0001-90', saldo_inicial: 100,
})));
let d = await dadosDe('inter');
eq([r.status, d.banco, d.banco_codigo, d.banco_ispb, d.agencia_digito, d.conta_digito, d.titular, d.titular_documento, d.saldo_atual],
  [200, 'Banco Inter S.A.', '077', '00416968', '9', 'X', 'Entur Viagens', '12345678000190', 100], 'titular, banco da lista e dígitos gravados');
eq((await json(await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'x1', nome: 'X', banco_codigo: '998' })))).status, 400, 'código fora da lista recusado');
eq((await json(await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'x2', nome: 'X', titular_documento: '123' })))).status, 400, 'documento do titular inválido recusado');
await json(await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'antiga', nome: 'Antiga', banco: 'Banco em texto livre', saldo_inicial: 0 })));
eq((await dadosDe('antiga')).banco, 'Banco em texto livre', 'banco em texto livre continua aceito');

console.log('--- 2. Edição simultânea ---');
r = await json(await CB.GET(req('/api/contas-bancarias')));
const lida = r.corpo.find(c => c.id === 'inter');
eq(typeof lida._versao, 'string', 'a lista traz a versão');
r = await json(await CBI.PUT(req('/api/contas-bancarias/inter', 'PUT', { ...lida, nome: 'Inter PJ principal' }), ctx('inter')));
eq([r.status, (await dadosDe('inter')).nome, '_versao' in (await dadosDe('inter'))], [200, 'Inter PJ principal', false], 'PUT com a versão lida grava');
r = await json(await CBI.PUT(req('/api/contas-bancarias/inter', 'PUT', { ...lida, nome: 'Tela velha' }), ctx('inter')));
eq([r.status, r.corpo.conflito, (await dadosDe('inter')).nome], [409, true, 'Inter PJ principal'], 'versão velha: 409, nada gravado');
r = await json(await CBI.PUT(req('/api/contas-bancarias/inter', 'PUT', { ...(await dadosDe('inter')), conta_digito: '123' }), ctx('inter')));
eq(r.status, 400, 'PUT com dígito inválido recusado');

console.log('--- 3. Desativar ---');
r = await json(await CBI.GET(req('/api/contas-bancarias/antiga'), ctx('antiga')));
r = await json(await CBI.PUT(req('/api/contas-bancarias/antiga', 'PUT', { ...r.corpo, ativo: false }), ctx('antiga')));
eq([r.status, (await dadosDe('antiga')).ativo], [200, false], 'conta desativada');
r = await json(await CB.GET(req('/api/contas-bancarias')));
eq(r.corpo.some(c => c.id === 'antiga' && c.ativo === false), true, 'a lista continua com a desativada (relatórios)');

console.log('--- 4. Excluir ---');
await json(await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'nova', nome: 'Nunca usada', saldo_inicial: 0 })));
await json(await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'com-titulo', nome: 'Com título', saldo_inicial: 0 })));
await query(`INSERT INTO contas_pagar (id, tenant_id, data) VALUES ('p1', $1, '{"conta_previsao_id":"com-titulo","status":"PENDENTE"}')`, [T]);
como(sessao('OPERADOR'));
eq((await json(await CBI.DELETE(req('/api/contas-bancarias/nova', 'DELETE'), ctx('nova')))).status, 403, 'operador não exclui');
como(sessao('ADMIN'));
r = await json(await CBI.DELETE(req('/api/contas-bancarias/com-titulo', 'DELETE'), ctx('com-titulo')));
eq([r.status, r.corpo.com_movimento, r.corpo.onde, Boolean(await dadosDe('com-titulo'))], [409, true, ['1 conta a pagar'], true], 'com título (previsto nela): recusado');
await query(`INSERT INTO transferencias (id, tenant_id, data) VALUES ('tx', $1, '{"conta_origem_id":"inter","conta_destino_id":"antiga","status":"PENDENTE"}')`, [T]);
r = await json(await CBI.DELETE(req('/api/contas-bancarias/antiga', 'DELETE'), ctx('antiga')));
eq([r.status, r.corpo.onde, /Desative a conta/.test(r.corpo.error)], [409, ['1 transferência'], true], 'com transferência: recusado, sugerindo desativar');
await query(`UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_atual}', '5') WHERE id = 'nova'`);
r = await json(await CBI.DELETE(req('/api/contas-bancarias/nova', 'DELETE'), ctx('nova')));
eq([r.status, r.corpo.onde], [409, ['saldo diferente do saldo inicial']], 'saldo mexido por fora: recusado');
await query(`UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_atual}', '0') WHERE id = 'nova'`);
r = await json(await CBI.DELETE(req('/api/contas-bancarias/nova', 'DELETE'), ctx('nova')));
eq([r.status, Boolean(await dadosDe('nova'))], [200, false], 'conta nunca usada: excluída');

console.log('--- 5. Cheque na transferência e Fechado no extrato ---');
r = await json(await TR.POST(req('/api/transferencias', 'POST', { id: 'tc', conta_origem_id: 'inter', conta_destino_id: 'com-titulo', valor: 10, status: 'PENDENTE', cheque_numero: '12a' })));
eq(r.status, 400, 'cheque com letra recusado');
r = await json(await TR.POST(req('/api/transferencias', 'POST', { id: 'tc', conta_origem_id: 'inter', conta_destino_id: 'com-titulo', valor: 10, status: 'PENDENTE', cheque_numero: ' 000123 ' })));
eq([r.status, (await query(`SELECT data->>'cheque_numero' AS c FROM transferencias WHERE id = 'tc'`)).rows[0].c], [200, '000123'], 'nº do cheque gravado');
// Efetivada (como o PUT faria) para aparecer no extrato.
await query(`UPDATE transferencias SET data = data || '{"status":"EFETIVADA","data":"2026-10-10","conta_origem_nome":"Inter","conta_destino_nome":"Com título"}'::jsonb WHERE id = 'tc'`);
await query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ('rc', $1, 'RECEBIDO', '{"status":"RECEBIDO","valor_final":50,"valor_recebido":50,"conta_bancaria_id":"inter","data_recebimento":"2026-11-02"}')`, [T]);
await query(`INSERT INTO periodos_fechados (tenant_id, conta_bancaria_id, fechado_ate) VALUES ($1, 'inter', '2026-10-31')`, [T]);
const ext = await lerMovimentos(pool, T, lerFiltro(new URLSearchParams('de=2026-10-01&ate=2026-11-30&contas=inter'), '2026-11-06'));
const porChave = new Map(ext.linhas.map(l => [l.chave, l]));
eq([porChave.get('tr:tc:s')?.cartao_cheque, porChave.get('tr:tc:s')?.fechado, porChave.get('cr:rc')?.fechado], ['000123', true, false],
  'cheque no extrato; movimento até o fechamento marcado como Fechado');

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
