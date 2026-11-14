/**
 * Segurança da E7 (fechamento, frente A) contra um Postgres real (PGlite),
 * rodando o código DE PRODUÇÃO, inclusive as rotas (sessão de teste).
 *
 * Prova:
 *  1. FORNECEDOR — ler continua aberto a quem está logado (sem dados
 *     bancários fora do financeiro); criar continua aberto, mas sem o direito
 *     as regras de faturamento nascem no padrão; editar exige "Lançar e editar
 *     no financeiro" e mudar as regras exige "Montar fatura de fornecedor".
 *     Quem tem os direitos grava igual a antes.
 *  2. TRANSFERÊNCIA — exige "Transferir entre contas" e as DUAS contas
 *     liberadas para movimentar; administrador nunca é barrado; quem tem o
 *     direito transfere igual a antes (saldo das duas contas).
 *  3. SÓ VER — conta marcada "só ver" (perfil ou pessoa): extrato e saldo
 *     sim; liquidar, transferir e lançar nela, não. Sem marcação, nada muda.
 *  4. DOIS FATORES PARA QUEM PAGA — sem o código: até o prazo passa com
 *     aviso; depois do prazo, 403 `precisa_segundo_fator` (pagar, transferir,
 *     aprovar); receber não pede; administrador e quem provou o código
 *     passam; SEGUNDO_FATOR_PAGADOR=0 desliga. Ativar em Meu perfil troca a
 *     sessão por uma com `sf: true`.
 *  5. ACESSO SENSÍVEL — abrir a folha, a comissão de outra pessoa e as
 *     comissões da equipe grava quem viu (sem o dado), uma vez a cada 30 min;
 *     a exportação diz quando levou o ganho da agência.
 *
 * Uso: node --no-warnings scripts/test-sql-seguranca-e7.mjs
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
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, status TEXT DEFAULT 'ativo', data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_origem_id TEXT DEFAULT '', conta_destino_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0,
    proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, usuario_id TEXT NOT NULL DEFAULT '', acao TEXT NOT NULL,
    modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '', entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-seguranca-e7';
delete process.env.SEGUNDO_FATOR_PAGADOR;
delete process.env.SEGUNDO_FATOR_PAGADOR_PRAZO;

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL); // idempotente: roda a cada boot
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);

await import('../src/lib/aprovacoes-executores.ts');
const A = await import('../src/lib/acoes-financeiras.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const F2 = await import('../src/lib/segundo-fator.ts');
const SFP = await import('../src/lib/segundo-fator-pagador.ts');
const AS = await import('../src/lib/acesso-sensivel.ts');
const FP = await import('../src/lib/fornecedor-permissao.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const RF = await import('../src/app/api/fornecedores-crm/route.ts');
const IF = await import('../src/app/api/fornecedores-crm/[id]/route.ts');
const RT = await import('../src/app/api/transferencias/route.ts');
const IT = await import('../src/app/api/transferencias/[id]/route.ts');
const RB = await import('../src/app/api/baixas/route.ts');
const RCP = await import('../src/app/api/contas-pagar/route.ts');
const ICP = await import('../src/app/api/contas-pagar/[id]/route.ts');
const RPA = await import('../src/app/api/perfis-de-acesso/route.ts');
const RMC = await import('../src/app/api/movimentos-caixa/route.ts');
const R2F = await import('../src/app/api/auth/segundo-fator/route.ts');
const RAP = await import('../src/app/api/aprovacoes/route.ts');
const { responderExportacao } = await import('../src/lib/exportacao/servidor.ts');

const T = 'ag-1';
// Versão por agência (14/11/2026): o que este teste prova é da versão COMPLETA (modulos.ts).
await query(`INSERT INTO tenants (id, status, data) VALUES ($1, 'ativo', '{"fin_versao":"completa"}')`, [T]);
const sessao = (perfil, userId = `u-${perfil}`, extra = {}) => ({ userId, nome: `Pessoa ${userId}`, email: `${userId}@x.com`, perfil, permissoes: {}, tenantId: T, tenantSlug: T, ...extra });
const admin = sessao('ADMIN');
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes(T); };
let chaveN = 0;
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json', 'idempotency-key': `k${++chaveN}` },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const ctx = id => ({ params: Promise.resolve({ id }) });
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const saldo = async id => Number((await um(`SELECT data->>'saldo_atual' AS s FROM contas_bancarias WHERE id = $1`, [id])).s);
const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

for (const [id, perfil] of [['u-ADMIN', 'ADMIN'], ['u-OPERADOR', 'OPERADOR'], ['u-op2', 'OPERADOR'], ['u-op3', 'OPERADOR'], ['u-op4', 'OPERADOR'], ['u-VENDEDOR', 'VENDEDOR']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, T, JSON.stringify({ id, nome: `Nome ${id}`, email: `${id}@x.com`, perfil, ativo: true })]);
}
for (const b of ['b1', 'b2', 'b3']) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, $3)`, [b, T, JSON.stringify({ id: b, nome: `Conta ${b}`, saldo_inicial: 1000, saldo_atual: 1000 })]);
}
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));

// ---------------------------------------------------------------------------
console.log('--- 1. Fornecedor: ler, criar e editar ---');
const regrasDoForm = { prazo_pagamento_dias: 15, dia_corte: 20, dia_vencimento: 5, comissao_padrao: 12, moeda_padrao: 'BRL' };
como(admin);
let r = await json(await RF.POST(req('/api/fornecedores-crm', 'POST', {
  id: 'f1', nome_fantasia: 'Operadora Um', tipo: 'OPERADORA', regras_faturamento: regrasDoForm,
  dados_bancarios: [{ banco: '341', agencia: '0001', conta: '12345-6' }],
})));
eq([r.status, r.corpo.regras_faturamento.prazo_pagamento_dias], [200, 15], 'administrador cria com as regras do formulário');

como(sessao('OPERADOR'));
r = await json(await RF.GET());
eq([r.status, r.corpo[0].dados_bancarios.length], [200, 1], 'operador lê a lista com os dados bancários');
r = await json(await IF.PUT(req('/api/fornecedores-crm/f1', 'PUT', { ...r.corpo[0], nome_fantasia: 'Operadora Um Ltda', regras_faturamento: { ...regrasDoForm, prazo_pagamento_dias: 20 } }), ctx('f1')));
eq([r.status, (await um(`SELECT data FROM fornecedores_crm WHERE id = 'f1'`)).data.regras_faturamento.prazo_pagamento_dias], [200, 20], 'operador edita nome e regras como antes');

como(sessao('VENDEDOR'));
r = await json(await RF.GET());
eq([r.status, r.corpo.length, r.corpo[0].dados_bancarios], [200, 1, []], 'vendedor lê a lista (Nova venda) sem os dados bancários');
eq(r.corpo[0].regras_faturamento.prazo_pagamento_dias, 20, 'vendedor continua vendo as regras (a Nova venda usa a comissão padrão)');
r = await json(await IF.GET(req('/api/fornecedores-crm/f1'), ctx('f1')));
eq([r.status, r.corpo.dados_bancarios], [200, []], 'vendedor abre um fornecedor sem os dados bancários');
r = await json(await RF.POST(req('/api/fornecedores-crm', 'POST', {
  id: 'f2', nome_fantasia: 'Receptivo do vendedor', tipo: 'RECEPTIVO', regras_faturamento: { prazo_pagamento_dias: 0, comissao_padrao: 50 },
  dados_bancarios: [{ banco: '999' }],
})));
const f2 = (await um(`SELECT data FROM fornecedores_crm WHERE id = 'f2'`)).data;
const ordenado = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
eq([r.status, f2.nome_fantasia, ordenado(f2.regras_faturamento), f2.dados_bancarios], [200, 'Receptivo do vendedor', ordenado(FP.REGRAS_PADRAO_DO_CADASTRO), []],
  'vendedor cria fornecedor na Nova venda, mas regras nascem no padrão e sem dados bancários');
r = await json(await RF.POST(req('/api/fornecedores-crm', 'POST', { ...f2, regras_faturamento: { ...f2.regras_faturamento, prazo_pagamento_dias: 1 } })));
eq([r.status, (await um(`SELECT data FROM fornecedores_crm WHERE id = 'f2'`)).data.regras_faturamento.prazo_pagamento_dias], [403, 30],
  'vendedor não regrava (upsert) um fornecedor que já existe');
r = await json(await IF.PUT(req('/api/fornecedores-crm/f1', 'PUT', { nome_fantasia: 'Trocado pelo vendedor' }), ctx('f1')));
eq([r.status, (await um(`SELECT data FROM fornecedores_crm WHERE id = 'f1'`)).data.nome_fantasia], [403, 'Operadora Um Ltda'], 'vendedor não edita (PUT)');

globalThis.__SESSAO_DE_TESTE__ = null;
eq((await RF.GET()).status, 401, 'sem login: 401');
eq((await RF.POST(req('/api/fornecedores-crm', 'POST', { id: 'fx', nome_fantasia: 'X' }))).status, 401, 'sem login não cria');

como(admin);
r = await json(await RPA.POST(req('/api/perfis-de-acesso', 'POST', { grupo: {
  nome: 'Cadastro sem fatura', acesso_total: false, acoes: A.acoesDoTeto('OPERADOR').filter(a => a !== 'gerar_fatura_fornecedor'), contas: [], membros: ['u-op2'],
} })));
eq(r.status, 200, 'perfil sem "Montar fatura de fornecedor" para o operador 2');
como(sessao('OPERADOR', 'u-op2'));
const f1 = (await um(`SELECT data FROM fornecedores_crm WHERE id = 'f1'`)).data;
r = await json(await IF.PUT(req('/api/fornecedores-crm/f1', 'PUT', { ...f1, regras_faturamento: { ...f1.regras_faturamento, comissao_padrao: 99 } }), ctx('f1')));
eq([r.status, r.corpo.error], [403, FP.MENSAGEM_REGRAS_FORNECEDOR], 'sem o direito de fatura, não muda as regras');
r = await json(await IF.PUT(req('/api/fornecedores-crm/f1', 'PUT', { ...f1, telefone: '1133334444' }), ctx('f1')));
eq(r.status, 200, 'sem o direito de fatura, muda o resto do cadastro');
r = await json(await RF.POST(req('/api/fornecedores-crm', 'POST', { id: 'f3', nome_fantasia: 'Novo', regras_faturamento: { prazo_pagamento_dias: 1 }, dados_bancarios: [{ banco: '1' }] })));
const f3 = (await um(`SELECT data FROM fornecedores_crm WHERE id = 'f3'`)).data;
eq([r.status, f3.regras_faturamento.prazo_pagamento_dias, f3.dados_bancarios.length], [200, 30, 1], 'sem o direito de fatura, cria com regras no padrão (dados bancários ficam)');

// ---------------------------------------------------------------------------
console.log('--- 2. Transferência: direito "Transferir" e as duas contas ---');
como(sessao('OPERADOR'));
const nova = (id, origem, destino, valor = 100) => RT.POST(req('/api/transferencias', 'POST', {
  id, conta_origem_id: origem, conta_destino_id: destino, valor, status: 'PENDENTE', data: hoje, descricao: 'teste',
})).then(json);
r = await nova('t1', 'b1', 'b2');
eq(r.status, 200, 'operador sem perfil lança a transferência como antes');
r = await json(await IT.PUT(req('/api/transferencias/t1', 'PUT', { ...r.corpo, status: 'EFETIVADA' }), ctx('t1')));
eq([r.status, r.corpo.aviso_segundo_fator, await saldo('b1'), await saldo('b2')], [200, undefined, 900, 1100], 'efetiva: sai de b1 e entra em b2, igual a antes');

como(admin);
r = await json(await RPA.POST(req('/api/perfis-de-acesso', 'POST', { grupo: {
  nome: 'Sem transferir', acesso_total: false, acoes: A.acoesDoTeto('OPERADOR').filter(a => a !== 'transferir'), contas: [], membros: ['u-op3'],
} })));
eq(r.status, 200, 'perfil sem "Transferir entre contas" para o operador 3');
como(sessao('OPERADOR', 'u-op3'));
r = await nova('t2', 'b1', 'b2');
eq([r.status, r.corpo.error], [403, 'Seu acesso não inclui: transferir entre contas.'], 'sem o direito, não lança transferência');
await query(`INSERT INTO transferencias (id, tenant_id, conta_origem_id, conta_destino_id, status, data) VALUES ('t3', $1, 'b1', 'b2', 'PENDENTE', $2)`,
  [T, JSON.stringify({ id: 't3', conta_origem_id: 'b1', conta_destino_id: 'b2', valor: 50, status: 'PENDENTE', data: hoje })]);
r = await json(await IT.PUT(req('/api/transferencias/t3', 'PUT', { id: 't3', conta_origem_id: 'b1', conta_destino_id: 'b2', valor: 50, status: 'EFETIVADA' }), ctx('t3')));
eq([r.status, await saldo('b1')], [403, 900], 'sem o direito, não efetiva (saldo intacto)');
r = await json(await IT.DELETE(req('/api/transferencias/t1', 'DELETE'), ctx('t1')));
eq(r.status, 403, 'sem o direito, não exclui transferência');
eq((await RT.GET()).status, 200, 'sem o direito, ainda vê a lista de transferências');

como(admin);
await RPA.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op4', contas_liberadas: ['b1'], acoes_negadas: [] } }));
como(sessao('OPERADOR', 'u-op4'));
r = await nova('t4', 'b1', 'b2');
eq([r.status, r.corpo.error], [403, 'Esta conta bancária não está liberada para você.'], 'destino fora das contas liberadas: recusa');
r = await nova('t5', 'b3', 'b1');
eq(r.status, 403, 'origem fora das contas liberadas: recusa');

como({ ...admin, sf: false });
r = await nova('t6', 'b2', 'b3', 10);
const t6 = r.corpo;
r = await json(await IT.PUT(req('/api/transferencias/t6', 'PUT', { ...t6, status: 'EFETIVADA' }), ctx('t6')));
eq([r.status, await saldo('b2'), await saldo('b3')], [200, 1090, 1010], 'administrador nunca é barrado (nem pelo código)');

// ---------------------------------------------------------------------------
console.log('--- 3. Conta "só ver" ---');
const quem = { perfil: 'OPERADOR' };
eq(A.contasMovimentaveisPor(quem, null), { todas: true, exceto: [] }, 'sem restrição: movimenta todas');
eq(A.contasMovimentaveisPor(quem, { grupos: [{ id: 'g', nome: 'g', acesso_total: false, acoes: [], contas: ['b1', 'b2'] }], usuario: null }),
  { todas: false, contas: ['b1', 'b2'] }, 'perfil sem "só ver": movimenta o que vê (como antes)');
eq(A.contasMovimentaveisPor(quem, { grupos: [{ id: 'g', nome: 'g', acesso_total: false, acoes: [], contas: ['b1', 'b2'], contas_so_ver: ['b2'] }], usuario: null }),
  { todas: false, contas: ['b1'] }, 'perfil com b2 só ver: movimenta b1');
eq(A.contasMovimentaveisPor(quem, { grupos: [{ id: 'g', nome: 'g', acesso_total: false, acoes: [], contas: [], contas_so_ver: ['b2'] }], usuario: null }),
  { todas: true, exceto: ['b2'] }, 'perfil com todas as contas e b2 só ver: todas menos b2');
eq(A.contasMovimentaveisPor(quem, { grupos: [
  { id: 'g', nome: 'g', acesso_total: false, acoes: [], contas: [], contas_so_ver: ['b2'] },
  { id: 'h', nome: 'h', acesso_total: false, acoes: [], contas: ['b2'] },
], usuario: null }), { todas: true, exceto: [] }, 'dois perfis: o que um deixa movimentar vale (soma)');
eq(A.contasMovimentaveisPor(quem, { grupos: [{ id: 'g', nome: 'g', acesso_total: true, acoes: [], contas: [], contas_so_ver: ['b2'] }], usuario: null }),
  { todas: true, exceto: [] }, 'acesso completo ignora "só ver"');
eq(A.contasMovimentaveisPor(quem, { grupos: [], usuario: { contas_liberadas: [], acoes_negadas: [], contas_so_ver: ['b3'] } }),
  { todas: true, exceto: ['b3'] }, 'restrição da pessoa: b3 só ver');
eq(A.contasMovimentaveisPor({ perfil: 'ADMIN' }, { grupos: [], usuario: { contas_liberadas: [], acoes_negadas: [], contas_so_ver: ['b3'] } }),
  { todas: true, exceto: [] }, 'administrador nunca é limitado');

como(admin);
r = await json(await RPA.POST(req('/api/perfis-de-acesso', 'POST', { grupo: {
  nome: 'Errado', acesso_total: false, acoes: [], contas: ['b1'], contas_so_ver: ['b2'], membros: [],
} })));
eq(r.status, 400, '"só ver" fora das contas do perfil é recusado');
r = await json(await RPA.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op4', contas_liberadas: [], acoes_negadas: [], contas_so_ver: ['b2'] } })));
eq([r.status, r.corpo.restricao.contas_so_ver], [200, ['b2']], 'administrador marca b2 como "só ver" para o operador 4');
r = await json(await RPA.GET());
eq(r.corpo.restricoes.find(x => x.usuario_id === 'u-op4').contas_so_ver, ['b2'], 'a tela relê o "só ver"');
r = await json(await RPA.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op4', contas_liberadas: [], acoes_negadas: [] } })));
eq(r.corpo.restricao.contas_so_ver, ['b2'], 'gravar sem mandar o "só ver" mantém o de antes');

const op4 = sessao('OPERADOR', 'u-op4');
como(op4);
eq(await P.pode(op4, 'ver_conta_bancaria', { contaBancariaId: 'b2' }), true, 'vê saldo e extrato de b2');
eq(await P.pode(op4, 'movimentar_conta_bancaria', { contaBancariaId: 'b2' }), false, 'não movimenta b2');
eq(await P.pode(op4, 'liquidar_receber', { contaBancariaId: 'b2' }), false, 'não recebe em b2');
eq(await P.pode(op4, 'liquidar_receber', { contaBancariaId: 'b1' }), true, 'recebe em b1');
eq(await P.contasPermitidas(op4), null, 'continua vendo todas as contas');
eq(await P.contasMovimentaveis(op4), ['b1', 'b3'], 'movimenta b1 e b3');
r = await json(await RMC.GET(req('/api/movimentos-caixa?contas=b2')));
eq(r.status, 200, 'abre o extrato de b2');
const cr = (id, valor) => query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1, $2, 'PENDENTE', $3)`,
  [id, T, JSON.stringify({ id, cliente_nome: 'Cliente', descricao: id, data_vencimento: hoje, status: 'PENDENTE', valor_final: valor })]);
await cr('r1', 100);
const receber = (id, conta, valor = 100) => RB.POST(req('/api/baixas', 'POST', { modo: 'gravar', itens: [{ titulo_tabela: 'contas_receber', titulo_id: id, data: hoje, conta_bancaria_id: conta, valor }] })).then(json);
r = await receber('r1', 'b2');
eq([r.status, r.corpo.error], [403, 'Esta conta bancária está liberada só para ver o saldo e o extrato. Para pagar, receber, transferir ou lançar nela, peça a quem cuida dos acessos.'],
  'não liquida em b2 (frase do "só ver")');
r = await receber('r1', 'b1');
eq(r.status, 200, 'liquida em b1');
r = await nova('t7', 'b1', 'b2');
eq(r.status, 403, 'não transfere para b2');
const cp = { id: 'p1', fornecedor_nome: 'Operadora', descricao: 'p1', data_vencimento: hoje, status: 'PENDENTE', valor_final: 10 };
r = await json(await RCP.POST(req('/api/contas-pagar', 'POST', { ...cp, conta_bancaria_id: 'b2' })));
eq(r.status, 403, 'não lança conta a pagar em b2');
r = await json(await RCP.POST(req('/api/contas-pagar', 'POST', { ...cp, conta_bancaria_id: 'b1' })));
eq(r.status, 200, 'lança em b1');
const p1 = (await um(`SELECT data FROM contas_pagar WHERE id = 'p1'`)).data;
r = await json(await ICP.PUT(req('/api/contas-pagar/p1', 'PUT', { ...p1, conta_bancaria_id: 'b2' }), ctx('p1')));
eq(r.status, 403, 'não troca a conta do título para b2');
r = await json(await ICP.PUT(req('/api/contas-pagar/p1', 'PUT', { ...p1, descricao: 'p1 revisado' }), ctx('p1')));
eq(r.status, 200, 'edita o título sem mexer na conta');
como(sessao('OPERADOR'));
r = await json(await RCP.POST(req('/api/contas-pagar', 'POST', { ...cp, id: 'p2', conta_bancaria_id: 'b2' })));
eq(r.status, 200, 'quem não tem "só ver" lança em b2 como antes');

// ---------------------------------------------------------------------------
console.log('--- 4. Verificação em duas etapas para quem paga ---');
const regraAberta = { ligado: true, prazo: '2026-11-23' };
eq(SFP.situacaoDoPagador({ perfil: 'OPERADOR' }, regraAberta, '2026-11-22'), 'aviso', 'antes do prazo: avisa');
eq(SFP.situacaoDoPagador({ perfil: 'OPERADOR' }, regraAberta, '2026-11-23'), 'bloqueio', 'no prazo: recusa');
eq(SFP.situacaoDoPagador({ perfil: 'OPERADOR', sf: true }, regraAberta, '2026-12-01'), 'livre', 'com o código provado: livre');
eq(SFP.situacaoDoPagador({ perfil: 'ADMIN' }, regraAberta, '2026-12-01'), 'livre', 'administrador: livre (código no login)');
eq(SFP.situacaoDoPagador({ perfil: 'OPERADOR', isSuperAdmin: true }, regraAberta, '2026-12-01'), 'livre', 'superadmin: livre');
eq(SFP.situacaoDoPagador({ perfil: 'OPERADOR' }, { ligado: false, prazo: '2026-11-23' }, '2026-12-01'), 'livre', 'desligado: livre');
eq(SFP.regraDoPagador({}), { ligado: true, prazo: SFP.PRAZO_PADRAO_PAGADOR }, 'ligado por padrão, com o prazo padrão');
eq(SFP.regraDoPagador({ SEGUNDO_FATOR_PAGADOR: '0', SEGUNDO_FATOR_PAGADOR_PRAZO: '2027-01-10' }), { ligado: false, prazo: '2027-01-10' }, 'escape e prazo pelo ambiente');
eq(SFP.regraDoPagador({ SEGUNDO_FATOR_PAGADOR_PRAZO: 'amanhã' }).prazo, SFP.PRAZO_PADRAO_PAGADOR, 'prazo inválido: o padrão');
eq(F2.loginPedeSegundoFator({ perfil: 'OPERADOR' }), false, 'login do operador sem aplicativo cadastrado: só senha (não perde acesso)');
eq(F2.loginPedeSegundoFator({ perfil: 'OPERADOR', totp_segredo: F2.gerarSegredo() }), true, 'operador que cadastrou: login pede o código');
eq(F2.loginPedeSegundoFator({ perfil: 'ADMIN' }), true, 'administrador: sempre');

const semCodigo = sessao('OPERADOR', 'u-OPERADOR', { sf: false });
const pagarConta = async (id, valor = 10) => {
  await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1, $2, 'PENDENTE', $3)`,
    [id, T, JSON.stringify({ id, fornecedor_nome: 'Op', descricao: id, data_vencimento: hoje, status: 'PENDENTE', valor_final: valor })]);
  return RB.POST(req('/api/baixas', 'POST', { modo: 'gravar', itens: [{ titulo_tabela: 'contas_pagar', titulo_id: id, data: hoje, conta_bancaria_id: 'b1', valor }] })).then(json);
};
process.env.SEGUNDO_FATOR_PAGADOR_PRAZO = '2999-01-01';
como(semCodigo);
r = await pagarConta('p10');
eq([r.status, typeof r.corpo.aviso_segundo_fator], [200, 'string'], 'antes do prazo: paga e recebe o aviso');
process.env.SEGUNDO_FATOR_PAGADOR_PRAZO = '2000-01-01';
r = await pagarConta('p11');
eq([r.status, r.corpo.precisa_segundo_fator, r.corpo.onde_ativar], [403, true, '/perfil#segundo-fator'], 'depois do prazo: não paga e é levado a ativar');
eq((await um(`SELECT status FROM contas_pagar WHERE id = 'p11'`)).status, 'PENDENTE', 'nada foi gravado');
r = await json(await RB.POST(req('/api/baixas', 'POST', { modo: 'previa', itens: [{ titulo_tabela: 'contas_pagar', titulo_id: 'p11', data: hoje, conta_bancaria_id: 'b1', valor: 10 }] })));
eq([r.status, r.corpo.precisa_segundo_fator], [200, true], 'a prévia já avisa que vai pedir o código');
await cr('r2', 30);
r = await receber('r2', 'b1', 30);
eq([r.status, r.corpo.aviso_segundo_fator], [200, undefined], 'receber não pede o código');
r = await json(await ICP.PUT(req('/api/contas-pagar/p11', 'PUT', { ...(await um(`SELECT data FROM contas_pagar WHERE id = 'p11'`)).data, status: 'PAGO', valor_pago: 10, conta_bancaria_id: 'b1' }), ctx('p11')));
eq([r.status, r.corpo.precisa_segundo_fator], [403, true], 'pagar pela edição do título também pede o código');
r = await nova('t8', 'b1', 'b3', 5);
eq(r.status, 200, 'lançar transferência pendente não mexe no saldo: não pede o código');
r = await json(await IT.PUT(req('/api/transferencias/t8', 'PUT', { ...r.corpo, status: 'EFETIVADA' }), ctx('t8')));
eq([r.status, r.corpo.precisa_segundo_fator], [403, true], 'efetivar transferência pede o código');
r = await json(await RAP.POST(req('/api/aprovacoes', 'POST', { acao: 'decidir', id: 'qualquer', decisao: 'aprovar' })));
eq([r.status, r.corpo.precisa_segundo_fator], [403, true], 'aprovar pedido pede o código');
como(sessao('OPERADOR', 'u-OPERADOR', { sf: true }));
r = await pagarConta('p12');
eq([r.status, r.corpo.aviso_segundo_fator], [200, undefined], 'com o código provado, paga sem aviso');
process.env.SEGUNDO_FATOR_PAGADOR = '0';
como(semCodigo);
r = await pagarConta('p13');
eq(r.status, 200, 'SEGUNDO_FATOR_PAGADOR=0 desliga (escape)');
delete process.env.SEGUNDO_FATOR_PAGADOR;

console.log('--- 4b. Ativar em Meu perfil ---');
como(semCodigo);
r = await json(await R2F.GET());
eq([r.status, r.corpo.ativo, r.corpo.exigido_para_pagar, r.corpo.verificada_nesta_sessao], [200, false, true, false], 'situação: não ativo, exigido para pagar');
const ip = { 'x-real-ip': '10.0.0.9' };
const post2f = corpo => R2F.POST(new Request('http://localhost/api/auth/segundo-fator', { method: 'POST', headers: { 'content-type': 'application/json', ...ip }, body: JSON.stringify(corpo) })).then(json);
r = await post2f({});
eq([r.status, typeof r.corpo.segredo, r.corpo.precisa_cadastrar], [400, 'string', true], 'começa o cadastro: devolve a chave (nada gravado)');
const segredo = r.corpo.segredo;
eq(F2.segredoGravado((await um(`SELECT data FROM usuarios WHERE id = 'u-OPERADOR'`)).data), null, 'ainda não gravou');
r = await post2f({ segredo_novo: segredo, codigo: '000000' === F2.codigoDoPasso(segredo, Math.floor(Date.now() / 30000)) ? '111111' : '000000' });
eq([r.status, !!r.corpo.error], [400, true], 'código errado: recusa');
globalThis.__SESSAO_CRIADA__ = null;
r = await post2f({ segredo_novo: segredo, codigo: F2.codigoDoPasso(segredo, Math.floor(Date.now() / 30000)) });
eq([r.status, r.corpo.ok, globalThis.__SESSAO_CRIADA__?.sf, globalThis.__SESSAO_CRIADA__?.userId], [200, true, true, 'u-OPERADOR'], 'ativou: a sessão é trocada por uma com o código provado');
eq(F2.segredoGravado((await um(`SELECT data FROM usuarios WHERE id = 'u-OPERADOR'`)).data), segredo, 'o aplicativo ficou cadastrado');
const log = await um(`SELECT data FROM audit_log WHERE entidade = 'usuarios' AND entidade_id = 'u-OPERADOR' ORDER BY created_at DESC LIMIT 1`);
eq([log.data.acao, JSON.stringify(log.data).includes(segredo)], ['CONFIRMAR', false], 'registro de atividades sem a chave');
eq(F2.loginPedeSegundoFator((await um(`SELECT data FROM usuarios WHERE id = 'u-OPERADOR'`)).data), true, 'dali em diante, o login dele pede o código');
como({ ...globalThis.__SESSAO_CRIADA__ });
process.env.SEGUNDO_FATOR_PAGADOR_PRAZO = '2000-01-01';
r = await pagarConta('p14');
eq(r.status, 200, 'com a sessão nova, paga');
delete process.env.SEGUNDO_FATOR_PAGADOR_PRAZO;

// ---------------------------------------------------------------------------
console.log('--- 5. Registro de acesso a tela sensível ---');
const mapa = new Map();
eq([AS.deveRegistrarAcesso('k', 0, mapa), AS.deveRegistrarAcesso('k', 60_000, mapa), AS.deveRegistrarAcesso('k', AS.JANELA_DO_ACESSO_MS, mapa)],
  [true, false, true], 'uma vez a cada 30 minutos por pessoa e tela');
AS.esquecerAcessosSensiveis();
const antes = Number((await um(`SELECT count(*)::int AS n FROM audit_log WHERE acao = 'VISUALIZAR'`)).n);
const op = sessao('OPERADOR');
await AS.registrarAcessoSensivel(op, 'folha');
await AS.registrarAcessoSensivel(op, 'folha');
await AS.registrarAcessoSensivel(op, 'comissao_pessoa', { alvo: 'u-VENDEDOR', detalhe: 'Mês 2026-11.' });
const vistos = (await query(`SELECT entidade, entidade_id, usuario_id, data FROM audit_log WHERE acao = 'VISUALIZAR' ORDER BY created_at`)).rows.slice(antes);
eq(vistos.map(v => [v.entidade, v.entidade_id, v.usuario_id]), [['folha', '', 'u-OPERADOR'], ['comissao_painel', 'u-VENDEDOR', 'u-OPERADOR']],
  'folha e comissão de outra pessoa: quem viu, uma vez cada');
eq(vistos[1].data.descricao, 'Abriu o painel de comissão de outra pessoa. Mês 2026-11.', 'a frase diz o que foi aberto, sem valores');

const doc = { titulo: 'Vendas', colunas: [{ id: 'cliente', rotulo: 'Cliente', tipo: 'texto' }, { id: 'comissao', rotulo: 'Comissão', tipo: 'dinheiro', sensivel: true }], linhas: [{ cliente: 'A', comissao: 10 }], filtro: [] };
await responderExportacao(admin, doc, 'csv', { entidade: 'vendas', direitoConferido: true });
let exp = await um(`SELECT data FROM audit_log WHERE acao = 'EXPORTAR' ORDER BY created_at DESC LIMIT 1`);
eq(exp.data.descricao.includes('com as colunas do ganho da agência'), true, 'exportação com a comissão diz isso no registro');
await responderExportacao(sessao('OPERADOR', 'u-op3'), { ...doc, colunas: [doc.colunas[0]], linhas: [{ cliente: 'A' }] }, 'csv', { entidade: 'vendas', direitoConferido: true });
exp = await um(`SELECT data FROM audit_log WHERE acao = 'EXPORTAR' ORDER BY created_at DESC LIMIT 1`);
eq(exp.data.descricao.includes('ganho'), false, 'sem as colunas do ganho, a frase não fala delas');

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) process.exit(1);
