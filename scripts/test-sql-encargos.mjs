/**
 * Encargos da liquidação no resultado (05/11/2026), contra um Postgres real
 * (PGlite), rodando o código DE PRODUÇÃO: categorias padrão criadas uma vez
 * só, escolha da agência respeitada, e a liquidação com juros chegando ao
 * DRE na linha própria.
 *
 * Uso: node --no-warnings scripts/test-sql-encargos.mjs
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
async function falha(p) { try { await p; return null; } catch (e) { return { status: e?.status ?? null, msg: e?.message ?? String(e) }; } }

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL, registrarBaixas, estornarBaixa } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const {
  garantirCategoriasDeEncargos, salvarCategoriasDosEncargos, categoriasDosEncargos, linhasDeEncargos,
} = await import('../src/lib/encargos-servidor.ts');
const { encargosPorTitulo, rotulosDasCategorias } = await import('../src/lib/encargos-categorias.ts');
const { montarDRE } = await import('../src/lib/resultado-dre.ts');
const { getPlanoContasPadrao } = await import('../src/lib/crm-types.ts');

const T = 't1', OUTRA = 't2';
const um = async (sql, v) => (await query(sql, v)).rows[0];
const plano = async t => (await query(`SELECT id, codigo, tipo, data FROM plano_contas WHERE tenant_id = $1 ORDER BY codigo`, [t])).rows;

// A agência T usa o plano padrão; 2.4.05 já está ocupado por uma categoria dela.
for (const c of getPlanoContasPadrao()) {
  const id = `${T}-${c.id}`;
  const dados = { ...c, id, categoria_pai_id: c.categoria_pai_id ? `${T}-${c.categoria_pai_id}` : null };
  await query(`INSERT INTO plano_contas (id, tenant_id, codigo, descricao, tipo, data) VALUES ($1,$2,$3,'',$4,$5)`, [id, T, c.codigo, c.tipo, JSON.stringify(dados)]);
}
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, descricao, tipo, data) VALUES ('ocupa',$1,'2.4.05','','DESPESA','{"id":"ocupa","codigo":"2.4.05","nome":"Juros de empréstimo","tipo":"DESPESA"}')`, [T]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag1', $1, '{"nome_fantasia":"Agência Um","politica_cobranca":{"juros_am_pct":1}}')`, [T]);
const antes = (await plano(T)).length;

console.log('--- Categorias padrão: na primeira vez, uma vez só ---');
const m1 = await emTransacao(exec => garantirCategoriasDeEncargos(exec, T));
const depois1 = await plano(T);
eq(depois1.length - antes, 4, 'cria as quatro categorias');
const criada = id => depois1.find(p => p.id === id);
eq([criada(m1.receita_financeira).codigo, criada(m1.receita_financeira).data.nome, criada(m1.receita_financeira).tipo],
  ['1.6', 'Receitas financeiras', 'RECEITA'], 'receita financeira em 1.6');
eq([criada(m1.despesa_financeira).codigo, criada(m1.descontos_concedidos).codigo, criada(m1.taxas).codigo], ['2.4.06', '2.4.07', '2.4.08'], '2.4.05 ocupado: pega o próximo livre, sem mexer na categoria da agência');
eq(criada(m1.descontos_concedidos).data.categoria_pai_id, `${T}-${getPlanoContasPadrao().find(c => c.codigo === '2.4').id}`, 'fica dentro de Despesas Financeiras (2.4)');
const ag = (await um(`SELECT data FROM agencia WHERE id = 'ag1'`)).data;
eq([ag.nome_fantasia, ag.politica_cobranca.juros_am_pct, Object.keys(ag.categorias_encargos).sort()],
  ['Agência Um', 1, ['descontos_concedidos', 'despesa_financeira', 'receita_financeira', 'taxas']], 'grava a escolha sem tocar o resto do cadastro');
const m2 = await emTransacao(exec => garantirCategoriasDeEncargos(exec, T));
eq([(await plano(T)).length, JSON.stringify(m2) === JSON.stringify(m1)], [depois1.length, true], 'rodar de novo não cria nada nem troca nada');
await Promise.all([1, 2, 3].map(() => emTransacao(exec => garantirCategoriasDeEncargos(exec, T))));
eq((await plano(T)).length, depois1.length, 'três ao mesmo tempo: ainda sem duplicar');
// Se a escolha se perder (ex.: cadastro refeito), reaproveita a marcada.
await query(`UPDATE agencia SET data = data - 'categorias_encargos' WHERE id = 'ag1'`);
const m3 = await emTransacao(exec => garantirCategoriasDeEncargos(exec, T));
eq([(await plano(T)).length, m3.taxas], [depois1.length, m1.taxas], 'sem a escolha gravada, reaproveita a categoria marcada');

console.log('--- A escolha da agência manda ---');
const taxaCartao = `${T}-${getPlanoContasPadrao().find(c => c.codigo === '2.3.03').id}`;
await emTransacao(exec => salvarCategoriasDosEncargos(exec, T, { taxas: taxaCartao }));
eq((await categoriasDosEncargos(pool, T)).taxas, taxaCartao, 'trocar a categoria das taxas');
await emTransacao(exec => garantirCategoriasDeEncargos(exec, T));
eq((await categoriasDosEncargos(pool, T)).taxas, taxaCartao, 'garantir não desfaz a escolha');
const receitaQualquer = `${T}-${getPlanoContasPadrao().find(c => c.codigo === '1.5').id}`;
eq(await falha(emTransacao(exec => salvarCategoriasDosEncargos(exec, T, { despesa_financeira: receitaQualquer }))),
  { status: 400, msg: '"Outras Receitas" é uma categoria de receita; escolha uma de despesa.' }, 'categoria do tipo errado recusada');
eq((await falha(emTransacao(exec => salvarCategoriasDosEncargos(exec, OUTRA, { taxas: taxaCartao })))).status, 409, 'categoria de outra agência recusada');

console.log('--- Agência sem cadastro nem plano ---');
const mOutra = await emTransacao(exec => garantirCategoriasDeEncargos(exec, OUTRA));
eq([(await plano(OUTRA)).length, Object.keys(mOutra).length, Boolean((await um(`SELECT 1 AS ok FROM agencia WHERE tenant_id = $1`, [OUTRA]))?.ok)],
  [4, 4, true], 'cria as quatro e o cadastro da agência');

console.log('--- Liquidação com juros chega ao DRE ---');
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Inter","saldo_inicial":0,"saldo_atual":0}')`, [T]);
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));
const crDados = { id: 'r1', origem: 'FEE', cliente_nome: 'Cliente', descricao: 'Fee', valor_final: 300, data_vencimento: '2026-10-10', status: 'PENDENTE' };
await query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ('r1',$1,'PENDENTE',$2)`, [T, JSON.stringify(crDados)]);
const ctx = { tenantId: T, usuarioId: 'u1', usuarioNome: 'Ana', origem: 'tela', politica: null };
await emTransacao(exec => registrarBaixas(exec, ctx, [{ titulo_tabela: 'contas_receber', titulo_id: 'r1', data: '2026-10-20', conta_bancaria_id: 'b1', valor: 312, juros: 9, multa: 3 }], { gravar: true }));
const linhas = await linhasDeEncargos(pool, T);
eq(linhas.map(l => [l.titulo_id, l.juros, l.multa, l.estornada]), [['r1', 9, 3, false]], 'a baixa com juros e multa aparece para o DRE');
const r1 = (await um(`SELECT data FROM contas_receber WHERE id = 'r1'`)).data;
const planoT = (await plano(T)).map(p => ({ ...p.data, id: p.id }));
const dre = enc => montarDRE({
  receber: [r1], pagar: [], vendasComLastro: [], planoContas: planoT, comissaoNaoCapturada: new Map(),
  mes: '2026-10', regime: 'competencia', encargos: enc, rotulosEncargos: rotulosDasCategorias(m1, planoT),
});
const com = dre(encargosPorTitulo(linhas));
eq([com.find(l => l.nome === 'Fee de serviço').valor, com.find(l => l.nome === 'Receitas financeiras')?.valor, com.find(l => l.nome === 'LUCRO LÍQUIDO').valor],
  [300, 12, 312], 'fee pelo valor combinado, juros e multa em Receitas financeiras, lucro igual ao recebido');
eq(dre(new Map()).find(l => l.nome === 'Fee de serviço').valor, 312, 'sem os encargos, o DRE de antes (fee com os juros dentro)');

const b = (await um(`SELECT id FROM baixas WHERE tenant_id = $1 AND titulo_id = 'r1'`, [T])).id;
await emTransacao(exec => estornarBaixa(exec, ctx, b, { motivo: 'lançado errado' }));
eq(encargosPorTitulo(await linhasDeEncargos(pool, T)).size, 0, 'baixa estornada sai do DRE');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
