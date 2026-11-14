/**
 * Categorias, centros de custo, rateio e relatórios por dimensão (05/11/2026)
 * contra um Postgres real (PGlite), rodando o código DE PRODUÇÃO, inclusive
 * as rotas, com a sessão trocada por uma de teste.
 *
 * Prova:
 *  1. MIGRAÇÃO — os textos livres de centro em contas e vendas viram
 *     cadastro, uma vez só (marco), sem apagar o texto e sem duplicar o que
 *     já existia com outra grafia.
 *  2. CENTROS e REGRAS — árvore sem ciclo, nome único, exclusão recusada com
 *     uso ou filhos, perfil sem permissão recusado.
 *  3. RATEIO NA CONTA — POST e PUT recusam rateio que não fecha 100% e
 *     refazem os centavos; conta sem rateio grava exatamente o que veio
 *     (porteiro).
 *  4. JUNTAR CATEGORIAS — só administrador; prévia conta; gravar move contas a
 *     pagar/receber (inclusive o código digitado), linhas do rateio, vendas
 *     e regras, exclui a origem, audita e não toca outra agência.
 *  5. RELATÓRIOS — filtros, regime de caixa proporcional, página e totais
 *     do recorte, planilha protegida contra fórmula e exportação auditada,
 *     isolamento por agência, conta sem rateio = valor da conta.
 *
 * Uso: node --no-warnings scripts/test-sql-categorias-centros.mjs
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
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '',
    vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT NOT NULL DEFAULT '',
    acao TEXT NOT NULL DEFAULT '', modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '',
    entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

const { CENTROS_CUSTO_SCHEMA_SQL } = await import('../src/lib/centros-custo-servidor.ts');
const centrosRota = await import('../src/app/api/centros-custo/route.ts');
const centroRota = await import('../src/app/api/centros-custo/[id]/route.ts');
const regrasRota = await import('../src/app/api/regras-rateio/route.ts');
const regraRota = await import('../src/app/api/regras-rateio/[id]/route.ts');
const juntarRota = await import('../src/app/api/plano-contas/juntar/route.ts');
const relatorioRota = await import('../src/app/api/relatorios/lancamentos/route.ts');
const pagarRota = await import('../src/app/api/contas-pagar/route.ts');
const pagarItemRota = await import('../src/app/api/contas-pagar/[id]/route.ts');
const receberRota = await import('../src/app/api/contas-receber/route.ts');

const chaves = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const um = async (sql, v) => (await query(sql, v)).rows[0];
const sessao = (perfil, tenantId = 't1') => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: '', perfil, permissoes: {}, tenantId, tenantSlug: tenantId });
const como = (perfil, tenantId) => { globalThis.__SESSAO_DE_TESTE__ = sessao(perfil, tenantId); };
const json = (corpo) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
const req = (url, init) => new Request(`http://localhost${url}`, init);
const p = (id) => ({ params: Promise.resolve({ id }) });
async function chamar(resposta) { const r = await resposta; return { status: r.status, corpo: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; }

const inserir = (tabela, id, t, data, extra = {}) => {
  const cols = ['id', 'tenant_id', 'data', ...Object.keys(extra)];
  const vals = [id, t, JSON.stringify({ id, ...data }), ...Object.values(extra)];
  return query(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
};

// ---------------------------------------------------------------------------
console.log('--- 1. Migração dos textos livres de centro ---');
// Versão por agência (14/11/2026): o rateio conferido no PUT é da versão COMPLETA (modulos.ts).
await query(`CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb)`);
await query(`INSERT INTO tenants (id, data) VALUES ('t1', '{"fin_versao":"completa"}'), ('t2', '{"fin_versao":"completa"}') ON CONFLICT (id) DO NOTHING`);
await inserir('centros_custo', 'antigo', 't1', { nome: 'Loja SP', ativo: true }, { nome: 'Loja SP' });
await inserir('contas_pagar', 'cpA', 't1', { valor_final: 100, centro_custo: 'loja sp ', status: 'PENDENTE', fornecedor_nome: 'A', data_vencimento: '2026-11-10' });
await inserir('contas_pagar', 'cpB', 't1', { valor_final: 50, centro_custo: 'Marketing', status: 'PENDENTE', fornecedor_nome: 'B', data_vencimento: '2026-11-11' });
await inserir('contas_receber', 'crA', 't1', { valor_final: 70, centro_custo: 'MARKETING', status: 'PENDENTE', cliente_nome: 'C', data_vencimento: '2026-11-12' });
await inserir('vendas_crm', 'v1', 't1', { numero: 'V-001', centro_custo: '', produtos: [{ centro_custo: 'Eventos' }, { centro_custo: '' }] });
await inserir('contas_pagar', 'cpT2', 't2', { valor_final: 999, centro_custo: 'Marketing', status: 'PENDENTE', fornecedor_nome: 'Outra', data_vencimento: '2026-11-10' });
await pg.exec(CENTROS_CUSTO_SCHEMA_SQL);
await pg.exec(CENTROS_CUSTO_SCHEMA_SQL); // roda a cada boot
const centrosT1 = (await query(`SELECT nome FROM centros_custo WHERE tenant_id='t1' ORDER BY nome`)).rows.map(r => r.nome);
eq(centrosT1, ['Eventos', 'Loja SP', 'Marketing'], 'textos viraram centros; "loja sp" achou o cadastro que já existia');
eq((await query(`SELECT nome FROM centros_custo WHERE tenant_id='t2'`)).rows.map(r => r.nome), ['Marketing'], 'cada agência ganha o seu centro');
const cpA = (await um(`SELECT data FROM contas_pagar WHERE id='cpA'`)).data;
eq([cpA.centro_custo, cpA.centro_custo_id], ['loja sp ', 'antigo'], 'texto antigo fica; conta ganha o id do cadastro');
const mkt = (await um(`SELECT id FROM centros_custo WHERE tenant_id='t1' AND nome='Marketing'`)).id;
eq((await um(`SELECT data->>'centro_custo_id' AS c FROM contas_receber WHERE id='crA'`)).c, mkt, 'conta a receber ligada (maiúsculas não importam)');
eq((await um(`SELECT data->>'centro_custo_id' AS c FROM contas_pagar WHERE id='cpT2'`)).c !== mkt, true, 'conta da outra agência ligada ao centro DELA');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM marcos_de_migracao WHERE chave='centros_custo_dos_textos'`)).n), 1, 'marco gravado');
await query(`DELETE FROM centros_custo WHERE id = $1`, [mkt]);
await pg.exec(CENTROS_CUSTO_SCHEMA_SQL);
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM centros_custo WHERE tenant_id='t1' AND nome='Marketing'`)).n), 0, 'com o marco, a migração não roda de novo');

// ---------------------------------------------------------------------------
console.log('--- 2. Centros e regras ---');
como('ADMIN');
let r = await chamar(centrosRota.POST(req('/api/centros-custo', json({ id: 'adm', nome: 'Administrativo', codigo: '1', orcamento_mensal: 5000 }))));
eq([r.status, r.corpo.nome, r.corpo.orcamento_mensal], [200, 'Administrativo', 5000], 'cria centro com código e orçamento');
r = await chamar(centrosRota.POST(req('/api/centros-custo', json({ id: 'rj', nome: 'Loja RJ', centro_pai_id: 'adm', responsavel: 'Bia' }))));
eq([r.status, r.corpo.centro_pai_id], [200, 'adm'], 'cria centro filho');
r = await chamar(centroRota.PUT(req('/api/centros-custo/antigo', { method: 'PUT', body: JSON.stringify({ nome: 'Loja SP', centro_pai_id: 'adm' }) }), p('antigo')));
eq(r.status, 200, 'centro antigo entra na árvore');
r = await chamar(centroRota.PUT(req('/api/centros-custo/adm', { method: 'PUT', body: JSON.stringify({ nome: 'Administrativo', centro_pai_id: 'rj' }) }), p('adm')));
eq([r.status, r.corpo.error], [400, 'Um centro não pode ficar dentro dele mesmo.'], 'ciclo recusado');
r = await chamar(centrosRota.POST(req('/api/centros-custo', json({ id: 'dup', nome: 'loja rj' }))));
eq(r.status, 409, 'nome repetido recusado');
r = await chamar(centrosRota.POST(req('/api/centros-custo', json({ id: 'cpA', nome: 'x' }))));
eq(r.status, 200, 'id livre na tabela de centros pode ser usado');
await query(`DELETE FROM centros_custo WHERE id='cpA'`);
r = await chamar(centrosRota.GET());
eq(r.corpo.map(c => c.nome), ['Administrativo', 'Eventos', 'Loja RJ', 'Loja SP'], 'lista só da agência');
como('ADMIN', 't2');
r = await chamar(centroRota.PUT(req('/api/centros-custo/adm', { method: 'PUT', body: JSON.stringify({ nome: 'Roubado' }) }), p('adm')));
eq(r.status, 404, 'outra agência não altera o centro');
como('VENDEDOR');
r = await chamar(centrosRota.POST(req('/api/centros-custo', json({ id: 'v', nome: 'Vend' }))));
eq(r.status, 403, 'vendedor não grava centro');
como('OPERADOR');
r = await chamar(centroRota.DELETE(req('/api/centros-custo/rj', { method: 'DELETE' }), p('rj')));
eq(r.status, 403, 'operador não exclui');
como('ADMIN');
r = await chamar(centroRota.DELETE(req('/api/centros-custo/adm', { method: 'DELETE' }), p('adm')));
eq([r.status, r.corpo.error], [409, 'Este centro tem centros abaixo dele. Mova ou exclua os de baixo antes.'], 'centro com filhos não sai');
r = await chamar(centroRota.DELETE(req('/api/centros-custo/antigo', { method: 'DELETE' }), p('antigo')));
eq(r.status, 409, 'centro com lançamento não sai (inativar)');

r = await chamar(regrasRota.POST(req('/api/regras-rateio', json({ id: 'rg1', nome: 'Aluguel', linhas: [{ centro_custo_id: 'antigo', percentual: 50 }, { centro_custo_id: 'rj', percentual: 40 }] }))));
eq([r.status, r.corpo.error], [400, 'O rateio soma 90%. Faltam 10% para fechar 100%.'], 'regra que não fecha 100% é recusada');
r = await chamar(regrasRota.POST(req('/api/regras-rateio', json({ id: 'rg1', nome: 'Aluguel', linhas: [{ centro_custo_id: 'antigo', categoria_id: 'alug', percentual: 50 }, { centro_custo_id: 'rj', percentual: 50 }] }))));
eq([r.status, r.corpo.linhas.length], [200, 2], 'regra "Aluguel 50% SP / 50% RJ" salva');
r = await chamar(regrasRota.POST(req('/api/regras-rateio', json({ id: 'rg2', nome: 'Fora', linhas: [{ centro_custo_id: 'cc-de-outra', percentual: 100 }] }))));
eq(r.status, 400, 'regra com centro de outra agência recusada');
r = await chamar(centroRota.DELETE(req('/api/centros-custo/rj', { method: 'DELETE' }), p('rj')));
eq(r.status, 409, 'centro usado por regra não sai');
como('ADMIN', 't2');
eq((await chamar(regrasRota.GET())).corpo.length, 0, 'regras isoladas por agência');
r = await chamar(regraRota.DELETE(req('/api/regras-rateio/rg1', { method: 'DELETE' }), p('rg1')));
eq(r.status, 404, 'outra agência não exclui a regra');

// ---------------------------------------------------------------------------
console.log('--- 3. Rateio na conta (POST e PUT) ---');
como('ADMIN');
const contaBase = { status: 'PENDENTE', fornecedor_id: '', fornecedor_nome: 'Imobiliária', descricao: 'Aluguel', categoria_id: 'alug',
  valor_original: 1000.01, valor_final: 1000.01, data_emissao: '2026-11-01', data_vencimento: '2026-11-10', anexos: [], observacoes: '' };
r = await chamar(pagarRota.POST(req('/api/contas-pagar', json({ id: 'cp1', ...contaBase, rateio: [{ centro_custo_id: 'antigo', percentual: 70 }] }))));
eq([r.status, r.corpo.error], [400, 'O rateio soma 70%. Faltam 30% para fechar 100%.'], 'POST recusa rateio que não fecha');
eq((await query(`SELECT 1 FROM contas_pagar WHERE id='cp1'`)).rows.length, 0, 'nada gravado');
r = await chamar(pagarRota.POST(req('/api/contas-pagar', json({ id: 'cp1', ...contaBase, tags: ['sede', ' Sede '],
  rateio: [{ centro_custo_id: 'antigo', percentual: 50, valor: 1 }, { centro_custo_id: 'rj', categoria_id: 'luz', percentual: 50, valor: 1 }] }))));
eq([r.status, r.corpo.rateio.map(l => l.valor), r.corpo.tags], [200, [500, 500.01], ['sede']], 'POST grava rateio com centavos refeitos e tags limpas');
const semRateio = { id: 'cp2', ...contaBase, valor_final: 200, valor_original: 200, categoria_id: 'rep', centro_custo: 'Texto solto', rateio: [] };
r = await chamar(pagarRota.POST(req('/api/contas-pagar', json(semRateio))));
eq(chaves((await um(`SELECT data FROM contas_pagar WHERE id='cp2'`)).data), chaves(semRateio), 'porteiro: conta sem rateio grava exatamente o que veio');
r = await chamar(pagarItemRota.PUT(req('/api/contas-pagar/cp1', { method: 'PUT', body: JSON.stringify({ ...r.corpo, id: 'cp1', ...contaBase, rateio: [{ centro_custo_id: 'antigo', percentual: 101 }] }) }), p('cp1')));
eq([r.status, r.corpo.error], [400, 'O percentual da linha 1 do rateio passa de 100%.'], 'PUT recusa rateio inválido');
const cp1 = (await um(`SELECT data FROM contas_pagar WHERE id='cp1'`)).data;
r = await chamar(pagarItemRota.PUT(req('/api/contas-pagar/cp1', { method: 'PUT', body: JSON.stringify({ ...cp1, valor_final: 600, valor_original: 600 }) }), p('cp1')));
eq([r.status, (await um(`SELECT data FROM contas_pagar WHERE id='cp1'`)).data.rateio.map(l => l.valor)], [200, [300, 300]], 'PUT refaz o valor das linhas sobre o novo valor');
r = await chamar(receberRota.POST(req('/api/contas-receber', json({ id: 'cr1', status: 'PENDENTE', cliente_nome: 'Ana', descricao: 'Fee', categoria_id: '1.3',
  valor_final: 500, valor_original: 500, data_vencimento: '2026-11-20', rateio: [{ centro_custo_id: 'rj', percentual: 100 }] }))));
eq([r.status, r.corpo.rateio[0].valor], [200, 500], 'conta a receber também aceita rateio');

// ---------------------------------------------------------------------------
console.log('--- 4. Juntar categorias ---');
const cat = (id, t, codigo, nome, tipo, extra = {}) => query(
  `INSERT INTO plano_contas (id, tenant_id, codigo, tipo, data) VALUES ($1,$2,$3,$4,$5)`,
  [id, t, codigo, tipo, JSON.stringify({ id, codigo, nome, tipo, categoria_pai_id: null, ativo: true, ...extra })]);
await cat('g22', 't1', '2.2', 'Despesas Operacionais', 'DESPESA');
await cat('alug', 't1', '2.2.01', 'Aluguel', 'DESPESA');
await cat('luz', 't1', '2.2.02', 'Energia', 'DESPESA');
await cat('rep', 't1', '2.9', 'Repasse a fornecedor', 'DESPESA', { repasse: true });
await cat('rec', 't1', '1.3', 'Fee de Serviço', 'RECEITA');
await cat('fee2', 't1', '1.4', 'Fee antigo', 'RECEITA');
await inserir('contas_pagar', 'cpLuz', 't1', { ...contaBase, valor_final: 80, categoria_id: 'alug', rateio: [] });
await inserir('contas_receber', 'crCod', 't1', { status: 'PENDENTE', cliente_nome: 'Zé', categoria_id: '1.4', valor_final: 30, data_vencimento: '2026-11-21', rateio: [] });
await inserir('vendas_crm', 'v2', 't1', { numero: 'V-002', categoria_id: 'alug' });
await inserir('contas_pagar', 'cpOutra', 't2', { ...contaBase, categoria_id: 'alug', rateio: [] });

como('OPERADOR');
r = await chamar(juntarRota.POST(req('/api/plano-contas/juntar', json({ origem_id: 'alug', destino_id: 'luz', modo: 'previa' }))));
eq(r.status, 403, 'só administrador junta categorias');
como('ADMIN');
r = await chamar(juntarRota.POST(req('/api/plano-contas/juntar', json({ origem_id: 'alug', destino_id: 'alug' }))));
eq([r.status, r.corpo.error], [409, 'Escolha outra categoria: uma categoria não pode ser juntada com ela mesma.'], 'mesma categoria recusada');
r = await chamar(juntarRota.POST(req('/api/plano-contas/juntar', json({ origem_id: 'alug', destino_id: 'rec' }))));
eq(r.status, 409, 'tipos diferentes recusados');
r = await chamar(juntarRota.POST(req('/api/plano-contas/juntar', json({ origem_id: 'alug', destino_id: 'luz', modo: 'previa' }))));
eq([r.status, r.corpo.contagens.map(c => [c.tabela, c.registros]), r.corpo.regras, r.corpo.total],
  [200, [['contas_pagar', 2], ['contas_receber', 0], ['vendas_crm', 1]], 1, 4], 'prévia diz quantos registros mudam (e pula a tabela que não existe)');
eq((await um(`SELECT COUNT(*)::int AS n FROM plano_contas WHERE id='alug'`)).n, 1, 'prévia não grava');
r = await chamar(juntarRota.POST(req('/api/plano-contas/juntar', json({ origem_id: 'alug', destino_id: 'luz', modo: 'gravar' }))));
eq([r.status, r.corpo.ok], [200, true], 'juntou');
const depois = (await um(`SELECT data FROM contas_pagar WHERE id='cp1'`)).data;
eq([depois.categoria_id, depois.rateio.map(l => l.categoria_id ?? '(da conta)')], ['luz', ['(da conta)', 'luz']], 'conta e linhas do rateio foram para Energia');
eq((await um(`SELECT data->>'categoria_id' AS c FROM contas_pagar WHERE id='cpLuz'`)).c, 'luz', 'outra conta movida');
eq((await um(`SELECT data->>'categoria_id' AS c FROM vendas_crm WHERE id='v2'`)).c, 'luz', 'venda movida');
eq((await um(`SELECT data FROM regras_rateio WHERE id='rg1'`)).data.linhas[0].categoria_id, 'luz', 'regra salva movida');
eq((await um(`SELECT COUNT(*)::int AS n FROM plano_contas WHERE id='alug'`)).n, 0, 'a categoria de origem foi excluída');
eq((await um(`SELECT data->>'categoria_id' AS c FROM contas_pagar WHERE id='cpOutra'`)).c, 'alug', 'outra agência não foi tocada');
const auditoria = await um(`SELECT acao, modulo, entidade_id, usuario_id, data FROM audit_log WHERE entidade='plano_contas'`);
eq([auditoria.acao, auditoria.entidade_id, auditoria.usuario_id, auditoria.data.operacao, auditoria.data.destino_id], ['EXCLUIR', 'alug', 'u-ADMIN', 'JUNTAR_CATEGORIAS', 'luz'], 'junção auditada com quem fez e para onde foi');
r = await chamar(juntarRota.POST(req('/api/plano-contas/juntar', json({ origem_id: 'fee2', destino_id: 'rec', modo: 'gravar' }))));
eq([r.status, (await um(`SELECT data->>'categoria_id' AS c FROM contas_receber WHERE id='crCod'`)).c], [200, 'rec'], 'conta a receber com o código digitado também é movida');
r = await chamar(juntarRota.POST(req('/api/plano-contas/juntar', json({ origem_id: 'g22', destino_id: 'rep', modo: 'previa' }))));
eq(r.status, 409, 'grupo com subcategorias não é juntado');

// ---------------------------------------------------------------------------
console.log('--- 5. Relatórios ---');
await inserir('contas_bancarias', 'b1', 't1', { nome: 'Inter' }, { nome: 'Inter' });
await query(`UPDATE contas_pagar SET data = data || '{"status":"PARCIAL","valor_pago":150,"data_pagamento":"2026-11-04","conta_bancaria_id":"b1"}'::jsonb WHERE id='cp1'`);
await query(`UPDATE contas_pagar SET data = data || '{"status":"PAGO","valor_pago":200,"data_pagamento":"2026-11-05","descricao":"=HYPERLINK(\\"http://x\\")"}'::jsonb WHERE id='cp2'`);
await inserir('contas_pagar', 'cpVelha', 't1', { ...contaBase, valor_final: 10, data_vencimento: '2026-09-01', rateio: [] });
const relatorio = async (q) => chamar(relatorioRota.GET(req(`/api/relatorios/lancamentos?${new URLSearchParams(q)}`)));

r = await relatorio({ visao: 'categoria', de: '2026-11-01', ate: '2026-11-30' });
eq(r.corpo.linhas.map(l => [l.conta_id, l.categoria_nome, l.valor]).sort(),
  [['cpA', '', 100], ['cpB', '', 50], ['cpLuz', 'Energia', 80], ['cp1', 'Energia', 600], ['cr1', 'Fee de Serviço', 500], ['crA', '', 70], ['crCod', 'Fee de Serviço', 30]].sort(),
  'por categoria (competência): repasse fora, período respeitado, outra agência fora');
eq(r.corpo.totais.valor, 1430, 'total do recorte');
r = await relatorio({ visao: 'categoria', de: '2026-11-01', ate: '2026-11-30', incluir_repasse: '1', data_de: 'MOVIMENTACAO' });
eq([r.corpo.regime, r.corpo.linhas.map(l => [l.conta_id, l.valor]).sort()], ['caixa', [['cp1', 150], ['cp2', 200]]], 'movimentação: regime de caixa proporcional ao pago');
r = await relatorio({ visao: 'centro', de: '2026-11-01', ate: '2026-11-30', data_de: 'MOVIMENTACAO' });
eq(r.corpo.linhas.map(l => [l.centro_custo_nome, l.percentual, l.valor, l.conta_bancaria]), [['Loja SP', 50, 75, 'Inter'], ['Loja RJ', 50, 75, 'Inter']], 'por centro: % e valor do centro sobre o pago, conta bancária pelo nome');
r = await relatorio({ visao: 'centro', centro_custo_id: 'adm', de: '2026-11-01', ate: '2026-11-30' });
eq(r.corpo.linhas.map(l => l.conta_id).sort(), ['cp1', 'cp1', 'cpA', 'cr1'], 'centro de cima traz os de baixo (inclusive o texto migrado)');
r = await relatorio({ visao: 'rateio', de: '2026-11-01', ate: '2026-11-30' });
eq(r.corpo.linhas.map(l => [l.conta_id, l.centro_custo_nome, l.percentual, l.valor]), [['cp1', 'Loja SP', 50, 300], ['cp1', 'Loja RJ', 50, 300], ['cr1', 'Loja RJ', 100, 500]], 'por rateio: uma linha por parte, só contas rateadas');
r = await relatorio({ visao: 'categoria', de: '2026-11-01', ate: '2026-11-30', por_pagina: '2', pagina: '2', ordenar: 'valor', direcao: 'desc' });
eq([r.corpo.linhas.map(l => l.valor), r.corpo.paginas, r.corpo.totais.quantidade], [[100, 80], 4, 7], 'página do servidor com os totais do recorte inteiro');
r = await relatorio({ visao: 'categoria', de: '2026-11-01', ate: '2026-11-30', agrupar: 'tipo' });
eq(r.corpo.grupos.map(g => [g.rotulo, g.valor]), [['Despesa', 830], ['Receita', 600]], 'agrupar por tipo');
r = await relatorio({ de: '2026-12-01', ate: '2026-11-01' });
eq(r.status, 400, 'filtro inválido é 400');
como('OPERADOR');
r = await relatorio({ visao: 'categoria', formato: 'csv' });
eq(r.status, 403, 'operador não exporta');
como('ADMIN');
r = await relatorio({ visao: 'categoria', de: '2026-11-01', ate: '2026-11-30', incluir_repasse: '1', formato: 'csv' });
eq([r.status, r.corpo.includes(`"'=HYPERLINK(""http://x"")"`), r.corpo.includes('Imobiliária')], [200, true, true], 'planilha completa com fórmula neutralizada');
eq((await um(`SELECT acao, entidade FROM audit_log WHERE acao='EXPORTAR'`)), { acao: 'EXPORTAR', entidade: 'relatorio-por-categoria' }, 'exportação auditada');
como('ADMIN', 't2');
r = await relatorio({ visao: 'categoria', de: '2026-11-01', ate: '2026-11-30' });
eq(r.corpo.linhas.map(l => [l.conta_id, l.valor]).sort(), [['cpOutra', 1000.01], ['cpT2', 999]], 'outra agência só vê o que é dela; conta sem rateio = valor da conta');
como('VENDEDOR');
eq((await relatorio({})).status, 403, 'vendedor não vê o relatório');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
