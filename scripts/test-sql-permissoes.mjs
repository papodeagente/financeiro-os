/**
 * Perfis de acesso, permissão por conta, limites e pedidos de aprovação
 * (05/11/2026) contra um Postgres real (PGlite), rodando o código DE
 * PRODUÇÃO, inclusive as rotas (sessão de teste).
 *
 * Prova:
 *  1. PORTEIRO — com as tabelas novas vazias, `pode` dá exatamente o que as
 *     funções de hoje davam, para todo papel e toda ação, e as rotas devolvem
 *     as mesmas listas.
 *  2. RESTRIÇÃO — por grupo e por usuário, abaixo do teto do papel; contas
 *     não liberadas somem das listas e não se editam.
 *  3. APROVAÇÃO — pedido aprovado executa com revalidação (valor mudou =
 *     expira), quem pede não aprova, recusa exige motivo, executor que falha
 *     não leva o efeito junto, dois níveis.
 *
 * Uso: node --no-warnings scripts/test-sql-permissoes.mjs
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
async function erro(p) { try { await p; return null; } catch (e) { return e?.message ?? String(e); } }

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_origem_id TEXT DEFAULT '', conta_destino_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '',
    status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
process.env.JWT_SECRET = 'segredo-de-teste-permissoes';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const A = await import('../src/lib/acoes-financeiras.ts');
const H = await import('../src/lib/permissoes.ts');
const AP = await import('../src/lib/aprovacoes-servidor.ts');
const B = await import('../src/lib/bloqueios-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');

const T = 'ag-1';
const sessao = (perfil, userId = `u-${perfil}`, extra = {}) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T, ...extra });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; };
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const ctx = obj => ({ params: Promise.resolve(obj) });
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];

console.log('--- 0. Banco antigo, antes do esquema: pode() segue o papel sem quebrar ---');
eq(await P.pode(sessao('OPERADOR'), 'liquidar_pagar'), true, 'sem as tabelas, operador liquida como hoje');
eq(await P.contasPermitidas(sessao('OPERADOR')), null, 'sem as tabelas, todas as contas');

await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL); // idempotente: roda a cada boot
eq(!!(await um(`SELECT 1 AS x FROM information_schema.columns WHERE table_name = 'contas_pagar' AND column_name = 'aprovacao_status'`)), true, 'contas_pagar ganhou aprovacao_status (separado de status)');

// Cadastros
for (const [id, perfil] of [['u-ADMIN', 'ADMIN'], ['u-OPERADOR', 'OPERADOR'], ['u-op2', 'OPERADOR'], ['u-op3', 'OPERADOR'], ['u-VENDEDOR', 'VENDEDOR']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, T, JSON.stringify({ id, nome: `Nome ${id}`, perfil, ativo: true })]);
}
for (const b of ['b1', 'b2', 'b3']) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, $3)`, [b, T, JSON.stringify({ id: b, nome: `Conta ${b}`, saldo_atual: 0 })]);
}
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('bx', 'ag-2', '{"id":"bx","nome":"Outra agência"}')`);
const pagar = (id, data) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1, $2, $3, $4)`,
  [id, T, data.status ?? 'PENDENTE', JSON.stringify({ id, ...data })]);
await pagar('cp1', { status: 'PAGO', conta_bancaria_id: 'b1', valor_final: 100 });
await pagar('cp2', { status: 'PAGO', conta_bancaria_id: 'b2', valor_final: 200 });
await pagar('cp3', { status: 'PENDENTE', conta_bancaria_id: 'b2', valor_final: 300 });
await query(`INSERT INTO extrato_bancario (id, tenant_id, conta_bancaria_id, data) VALUES ('e1', $1, 'b1', '{"id":"e1","conta_bancaria_id":"b1"}'), ('e2', $1, 'b2', '{"id":"e2","conta_bancaria_id":"b2"}')`, [T]);
await query(`INSERT INTO transferencias (id, tenant_id, data) VALUES ('t1', $1, '{"id":"t1","conta_origem_id":"b1","conta_destino_id":"b2"}'), ('t2', $1, '{"id":"t2","conta_origem_id":"b1","conta_destino_id":"b1"}')`, [T]);

const RCB = await import('../src/app/api/contas-bancarias/route.ts');
const ICB = await import('../src/app/api/contas-bancarias/[id]/route.ts');
const RCP = await import('../src/app/api/contas-pagar/route.ts');
const REX = await import('../src/app/api/extrato-bancario/route.ts');
const RTR = await import('../src/app/api/transferencias/route.ts');
const RAP = await import('../src/app/api/aprovacoes/route.ts');
const RGU = await import('../src/app/api/perfis-de-acesso/route.ts');
const RBL = await import('../src/app/api/limites-e-aprovacao/route.ts');
const ids = async r => (await r.json()).map(x => x.id).sort();

console.log('--- 1. Porteiro: tabelas vazias = exatamente o comportamento de hoje ---');
const PERFIS = ['ADMIN', 'owner', 'OPERADOR', 'GERENTE', 'FINANCEIRO', 'VISUALIZADOR', 'VENDEDOR', 'COLABORADOR', '', 'INVENTADO'];
const HELPERS = { ver_financeiro: H.podeVerFinanceiro, editar_financeiro: H.podeEditarFinanceiro, excluir: H.podeExcluir, exportar: H.podeExportar, gerenciar_usuarios: H.podeGerenciarUsuarios };
for (const perfil of PERFIS) for (const isSuperAdmin of [false, true]) {
  const s = sessao(perfil, `u-porteiro-${perfil}`, { isSuperAdmin });
  let iguais = 0, iguaisHelper = 0, comHelper = 0;
  for (const a of A.ACOES_FINANCEIRAS) {
    const r = await P.pode(s, a.id);
    if (r === (isSuperAdmin || A.tetoDoPapel(perfil, a.id))) iguais++;
    if (HELPERS[a.id]) { comHelper++; if (r === HELPERS[a.id](s)) iguaisHelper++; }
    if (r !== await P.pode(s, a.id, { contaBancariaId: 'b2' })) iguais = -999;
  }
  const rotulo = `${perfil || '(vazio)'}${isSuperAdmin ? '+superadmin' : ''}`;
  eq(iguais, A.ACOES_FINANCEIRAS.length, `${rotulo}: pode() = teto do papel em todas as ${A.ACOES_FINANCEIRAS.length} ações (com e sem conta)`);
  eq(iguaisHelper, comHelper, `${rotulo}: pode() = podeVerFinanceiro/podeEditarFinanceiro/podeExcluir/podeExportar/podeGerenciarUsuarios`);
  eq(await P.contasPermitidas(s), null, `${rotulo}: todas as contas`);
}
como(sessao('OPERADOR'));
eq(await ids(await RCB.GET()), ['b1', 'b2', 'b3'], 'operador sem grupo: todas as contas bancárias (como hoje)');
eq(await ids(await RCP.GET()), ['cp1', 'cp2', 'cp3'], 'operador sem grupo: todas as contas a pagar');
eq(await ids(await REX.GET()), ['e1', 'e2'], 'operador sem grupo: extrato inteiro');
eq(await ids(await RTR.GET()), ['t1', 't2'], 'operador sem grupo: todas as transferências');
como(sessao('VENDEDOR'));
eq((await RCB.GET()).status, 403, 'vendedor continua sem financeiro');

console.log('--- 2. Perfil de acesso restringe abaixo do teto ---');
const admin = sessao('ADMIN');
como(admin);
let r = await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { grupo: {
  nome: 'Caixa', acesso_total: false, membros: ['u-OPERADOR', 'u-ADMIN'], contas: ['b1'],
  acoes: ['ver_financeiro', 'editar_financeiro', 'liquidar_receber', 'excluir', 'ver_conta_bancaria', 'inventada'],
} })));
eq(r.status, 200, 'administrador grava o grupo pela rota');
const grupoCaixa = r.corpo.grupo;
eq(grupoCaixa.acoes.includes('inventada'), false, 'ação desconhecida não entra');
r = await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { grupo: { nome: 'caixa', membros: [] } })));
eq(r.status, 409, 'nome repetido (sem diferença de maiúscula) é recusado');
r = await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { grupo: { nome: 'Ladrão', contas: ['bx'] } })));
eq(r.status, 400, 'conta de outra agência não entra no grupo');
const op = sessao('OPERADOR');
eq(await P.pode(op, 'liquidar_receber'), true, 'operador do grupo liquida a receber');
eq(await P.pode(op, 'liquidar_pagar'), false, 'mas não a pagar');
eq(await P.pode(op, 'liquidar_receber', { contaBancariaId: 'b2' }), false, 'nem recebe numa conta não liberada');
eq(await P.pode(op, 'excluir'), false, 'grupo marcando "excluir" não passa do teto do operador');
eq(await P.contasPermitidas(op), ['b1'], 'contas do operador: só b1');
eq(await P.pode(admin, 'liquidar_pagar'), true, 'administrador no mesmo grupo nunca se bloqueia');
eq(await P.contasPermitidas(admin), null, 'administrador vê todas as contas');
como(op);
eq(await ids(await RCB.GET()), ['b1'], 'GET /api/contas-bancarias: só a conta liberada');
eq((await ICB.GET(req('/api/contas-bancarias/b2'), ctx({ id: 'b2' }))).status, 404, 'abrir conta não liberada: 404');
eq((await ICB.PUT(req('/api/contas-bancarias/b2', 'PUT', { id: 'b2', nome: 'Mexida' }), ctx({ id: 'b2' }))).status, 403, 'editar conta não liberada: 403');
eq((await RCB.POST(req('/api/contas-bancarias', 'POST', { id: 'b2', nome: 'Mexida' }))).status, 403, 'regravar conta não liberada pelo POST: 403');
eq((await um(`SELECT data->>'nome' AS n FROM contas_bancarias WHERE id = 'b2'`)).n, 'Conta b2', 'conta b2 intacta');
eq(await ids(await RCP.GET()), ['cp1', 'cp3'], 'contas a pagar: some o que foi pago numa conta não liberada; em aberto fica');
eq(await ids(await REX.GET()), ['e1'], 'extrato: só da conta liberada');
eq(await ids(await RTR.GET()), ['t2'], 'transferência que toca conta não liberada some');
como(admin);
eq(await ids(await RCB.GET()), ['b1', 'b2', 'b3'], 'administrador continua vendo todas');
eq((await RCP.GET()).status, 200, 'e lendo contas a pagar');

console.log('--- 2b. Grupo sem acesso ao financeiro ---');
r = await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { grupo: { id: grupoCaixa.id, nome: 'Caixa', membros: ['u-OPERADOR'], contas: ['b1'], acoes: ['ver_proprias_comissoes'] } })));
eq(r.status, 200, 'grupo regravado sem financeiro');
como(sessao('OPERADOR'));
eq((await RCP.GET()).status, 403, 'operador do grupo perde a leitura do financeiro (GET contas a pagar)');
eq((await RAP.GET(req('/api/aprovacoes'))).status, 403, 'e a caixa de aprovações');
como(admin);
r = await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { grupo: { id: grupoCaixa.id, nome: 'Caixa', acesso_total: true, membros: ['u-OPERADOR'], contas: ['b1'] } })));
eq(r.corpo.grupo.contas, [], 'acesso completo não guarda contas restritas');
eq(await P.contasPermitidas(sessao('OPERADOR')), null, 'acesso completo: todas as contas');
eq(await P.pode(sessao('OPERADOR'), 'excluir'), false, 'acesso completo continua abaixo do teto');

console.log('--- 2c. Restrição por usuário ---');
r = await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op2', contas_liberadas: ['b3'], acoes_negadas: ['transferir'] } })));
eq(r.status, 200, 'restrição do usuário gravada');
const op2 = sessao('OPERADOR', 'u-op2');
eq(await P.contasPermitidas(op2), ['b3'], 'usuário restrito vê só b3');
eq(await P.pode(op2, 'transferir'), false, 'ação negada ao usuário');
eq(await P.pode(op2, 'liquidar_pagar'), true, 'o resto segue o papel');
r = await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-ADMIN', contas_liberadas: ['b3'] } })));
eq(r.status, 403, 'ninguém restringe o próprio acesso');
como(sessao('OPERADOR', 'u-op3'));
eq((await RGU.GET()).status, 403, 'operador não abre Perfis de acesso');
r = await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op2', contas_liberadas: [] } })));
eq(r.status, 403, 'nem grava restrição');
como(admin);
await json(await RGU.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op2', contas_liberadas: [], acoes_negadas: [] } })));
eq(await P.contasPermitidas(op2), null, 'restrição vazia é apagada: volta a ver tudo');
const RGI = await import('../src/app/api/perfis-de-acesso/[id]/route.ts');
eq((await RGI.DELETE(req('/x', 'DELETE'), ctx({ id: grupoCaixa.id }))).status, 200, 'excluir o grupo');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM grupo_usuario_membros WHERE tenant_id = $1`, [T])).n), 0, 'membros saem junto');
eq(await P.pode(sessao('OPERADOR'), 'liquidar_pagar'), true, 'sem grupo, operador volta ao de hoje');

console.log('--- 3. Bloqueios na agência ---');
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('agencia-ag-1', $1, '{"nome":"Agência Teste"}')`, [T]);
como(sessao('OPERADOR'));
eq((await RBL.PUT(req('/api/limites-e-aprovacao', 'PUT', { bloqueios: { desconto_max_reais: 1 }, alcadas: [] }))).status, 403, 'operador não configura limites');
como(admin);
r = await json(await RBL.PUT(req('/api/limites-e-aprovacao', 'PUT', {
  bloqueios: { desconto_max_reais: 50, retroagir_dias_max: 3, vencimento: 'so_adiantar' },
  alcadas: [{ nome: 'Acima de mil', valor_min_centavos: 100_000, aprovadores: [], niveis: 1 }],
})));
eq(r.status, 200, 'administrador grava bloqueios e alçada');
eq((await B.lerBloqueios(pool, T)).desconto_max_reais, 50, 'bloqueio lido de volta');
eq((await um(`SELECT data->>'nome' AS n FROM agencia WHERE tenant_id = $1`, [T])).n, 'Agência Teste', 'o resto dos dados da agência ficou');
const RAG = await import('../src/app/api/agencia/route.ts');
await RAG.POST(req('/api/agencia', 'POST', { nome: 'Agência Renomeada', bloqueios_financeiros: { desconto_max_reais: 999999 } }));
eq((await B.lerBloqueios(pool, T)).desconto_max_reais, 50, 'salvar os dados da agência não afrouxa o bloqueio');
eq((await um(`SELECT data->>'nome' AS n FROM agencia WHERE tenant_id = $1`, [T])).n, 'Agência Renomeada', 'e o nome mudou');

console.log('--- 4. Alçada e pedido de pagamento ---');
await pagar('cp-grande', { status: 'PENDENTE', valor_final: 1500, fornecedor_nome: 'Operadora X', descricao: 'Pacote' });
await pagar('cp-pequena', { status: 'PENDENTE', valor_final: 999.99 });
eq((await AP.exigeAprovacaoDoPagamento({ id: 'cp-pequena', valor_final: 999.99 }, { tenantId: T })).exige, false, 'abaixo da alçada: paga sem aprovação');
let sit = await AP.exigeAprovacaoDoPagamento({ id: 'cp-grande', valor_final: 1500 }, { tenantId: T });
eq([sit.exige, sit.liberado, sit.status], [true, false, ''], 'acima da alçada: exige e não está liberado');
como(sessao('OPERADOR'));
r = await json(await RAP.POST(req('/api/aprovacoes', 'POST', { acao: 'pedir_pagamento', conta_pagar_id: 'cp-grande', motivo: 'Vence amanhã' })));
eq(r.status, 201, 'operador pede aprovação');
const pedidoId = r.corpo.pedido.id;
eq((await um(`SELECT aprovacao_status AS s, status FROM contas_pagar WHERE id = 'cp-grande'`)), { s: 'PENDENTE', status: 'PENDENTE' }, 'conta fica com aprovação pendente; o status da conta não muda');
r = await json(await RAP.POST(req('/api/aprovacoes', 'POST', { acao: 'pedir_pagamento', conta_pagar_id: 'cp-grande' })));
eq([r.status, r.corpo.pedido.id], [200, pedidoId], 'pedir de novo devolve o mesmo pedido (sem duplicar)');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM notificacoes WHERE tipo = 'APROVACAO_PEDIDA' AND tenant_id = $1`, [T])).n), 1, 'um aviso no sino para quem aprova');
r = await json(await RAP.GET(req('/api/aprovacoes')));
eq([r.corpo.pedidos.length, r.corpo.pedidos[0].posso_decidir, r.corpo.para_mim], [1, false, 0], 'quem pediu vê o pedido mas não pode decidir');
r = await json(await RAP.POST(req('/api/aprovacoes', 'POST', { acao: 'decidir', id: pedidoId, decisao: 'aprovar' })));
eq(r.status, 403, 'quem pede não aprova o próprio');
como(sessao('OPERADOR', 'u-op3'));
r = await json(await RAP.GET(req('/api/aprovacoes')));
eq(r.corpo.para_mim, 1, 'outro operador vê 1 pedido para ele');
r = await json(await RAP.POST(req('/api/aprovacoes', 'POST', { acao: 'decidir', id: pedidoId, decisao: 'aprovar', motivo: 'ok' })));
eq([r.status, r.corpo.pedido.status], [200, 'EXECUTADO'], 'outro operador aprova e o pedido executa');
eq((await um(`SELECT aprovacao_status AS s FROM contas_pagar WHERE id = 'cp-grande'`)).s, 'APROVADO', 'conta marcada como aprovada');
sit = await AP.exigeAprovacaoDoPagamento({ id: 'cp-grande', valor_final: 1500 }, { tenantId: T });
eq([sit.exige, sit.liberado], [true, true], 'agora pode pagar');
sit = await AP.exigeAprovacaoDoPagamento({ id: 'cp-grande', valor_final: 1600 }, { tenantId: T });
eq(sit.liberado, false, 'valor diferente do aprovado: não libera');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM notificacoes WHERE tipo = 'APROVACAO_DECIDIDA' AND vendedor_id = 'u-OPERADOR'`)).n), 1, 'quem pediu recebe a resposta');
r = await json(await RAP.POST(req('/api/aprovacoes', 'POST', { acao: 'decidir', id: pedidoId, decisao: 'aprovar' })));
eq(r.status, 403, 'pedido decidido não se decide de novo');

console.log('--- 5. Revalidação: valor mudou depois do pedido ---');
await pagar('cp-muda', { status: 'PENDENTE', valor_final: 2000 });
const { pedido: pMuda } = await AP.pedirAprovacaoDoPagamento({ tenantId: T, contaPagarId: 'cp-muda', solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
await query(`UPDATE contas_pagar SET data = jsonb_set(data, '{valor_final}', '2500') WHERE id = 'cp-muda'`);
const dMuda = await AP.decidirPedido({ id: pMuda.id, decisao: 'aprovar', sessao: { ...admin } });
eq([dMuda.status, dMuda.erro_execucao.includes('valor')], ['EXPIRADO', true], 'aprovação não executa: a carga não vale mais');
eq((await um(`SELECT aprovacao_status AS s FROM contas_pagar WHERE id = 'cp-muda'`)).s, 'PENDENTE', 'a conta não foi marcada como aprovada');
eq((await AP.exigeAprovacaoDoPagamento({ id: 'cp-muda', valor_final: 2500 }, { tenantId: T })).status, '', 'pedido expirado não prende a conta: pede de novo');
const novo = await AP.pedirAprovacaoDoPagamento({ tenantId: T, contaPagarId: 'cp-muda', solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
eq([novo.jaExistia, novo.pedido.valor_centavos], [false, 250_000], 'novo pedido com o valor de agora');

console.log('--- 6. Recusa com motivo, executor que falha, dois níveis ---');
eq(!!(await erro(AP.decidirPedido({ id: novo.pedido.id, decisao: 'recusar', motivo: '', sessao: admin }))), true, 'recusar sem motivo é recusado');
const recusado = await AP.decidirPedido({ id: novo.pedido.id, decisao: 'recusar', motivo: 'Negociar desconto', sessao: admin });
eq([recusado.status, recusado.motivo_decisao], ['RECUSADO', 'Negociar desconto'], 'recusa registrada com motivo');
eq((await um(`SELECT aprovacao_status AS s FROM contas_pagar WHERE id = 'cp-muda'`)).s, 'RECUSADO', 'e a conta fica recusada');

await query(`CREATE TABLE efeitos (id TEXT PRIMARY KEY)`);
AP.registrarExecutorDeAprovacao('teste_falha', async ({ exec }) => {
  await exec.query(`INSERT INTO efeitos (id) VALUES ('meio-caminho')`);
  throw new Error('fornecedor fora do ar');
});
const { pedido: pf } = await AP.criarPedidoAprovacao({ tenantId: T, tipo: 'teste_falha', alvo_id: 'x1', descricao: 'Teste', payload: { a: 1 }, solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
const dFalha = await AP.decidirPedido({ id: pf.id, decisao: 'aprovar', sessao: admin });
eq([dFalha.status, dFalha.erro_execucao], ['APROVADO', 'fornecedor fora do ar'], 'executor que falha: aprovado, com o erro anotado');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM efeitos`)).n), 0, 'e o efeito pela metade foi desfeito');

let execucoes = 0;
AP.registrarExecutorDeAprovacao('teste_dois', async ({ exec, pedido }) => {
  execucoes++;
  await exec.query(`INSERT INTO efeitos (id) VALUES ($1)`, [pedido.id]);
  return { feito: true };
}, { revalidar: async ({ pedido }) => (pedido.payload.ok ? { ok: true } : { ok: false, motivo: 'carga ruim' }) });
const { pedido: p2 } = await AP.criarPedidoAprovacao({ tenantId: T, tipo: 'teste_dois', alvo_id: 'x2', descricao: 'Dois níveis', payload: { ok: true }, niveis: 2, solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
let d2 = await AP.decidirPedido({ id: p2.id, decisao: 'aprovar', sessao: admin });
eq([d2.status, execucoes], ['PENDENTE', 0], 'primeiro nível: ainda pendente, nada executado');
eq(!!(await erro(AP.decidirPedido({ id: p2.id, decisao: 'aprovar', sessao: admin }))), true, 'a mesma pessoa não conta duas vezes');
d2 = await AP.decidirPedido({ id: p2.id, decisao: 'aprovar', sessao: sessao('OPERADOR', 'u-op3') });
eq([d2.status, execucoes, d2.resultado], ['EXECUTADO', 1, { feito: true }], 'segundo nível: executa uma vez');
await query(`UPDATE pedidos_aprovacao SET payload = '{"ok":true,"valor":999}' WHERE id = 'nao-existe'`);
const { pedido: p3 } = await AP.criarPedidoAprovacao({ tenantId: T, tipo: 'teste_dois', alvo_id: 'x3', descricao: 'Mexido', payload: { ok: true }, solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
await query(`UPDATE pedidos_aprovacao SET payload = '{"ok":true,"valor":999}' WHERE id = $1`, [p3.id]);
const d3 = await AP.decidirPedido({ id: p3.id, decisao: 'aprovar', sessao: admin });
eq([d3.status, execucoes], ['EXPIRADO', 1], 'carga mexida por fora depois do pedido: não executa');
const { pedido: p4 } = await AP.criarPedidoAprovacao({ tenantId: T, tipo: 'teste_dois', alvo_id: 'x4', descricao: 'Ruim', payload: { ok: false }, solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
const d4 = await AP.decidirPedido({ id: p4.id, decisao: 'aprovar', sessao: admin });
eq([d4.status, d4.erro_execucao, execucoes], ['EXPIRADO', 'carga ruim', 1], 'revalidação do executor recusa: expira sem executar');
eq(!!(await erro(AP.decidirPedido({ id: p4.id, decisao: 'aprovar', sessao: { ...sessao('ADMIN', 'u-outro'), tenantId: 'ag-2' } }))), true, 'outra agência não acha o pedido');

console.log('--- 7. Aprovador por grupo; vendedor nunca decide ---');
await emTransacao(exec => P.salvarGrupo(exec, T, { id: 'g-aprov', nome: 'Aprovadores', membros: ['u-op3'], acoes: ['ver_financeiro', 'editar_financeiro', 'aprovar_pagamento'] }, 'u-ADMIN'));
const { pedido: p5 } = await AP.criarPedidoAprovacao({ tenantId: T, tipo: 'teste_dois', alvo_id: 'x5', descricao: 'Por grupo', payload: { ok: true }, aprovadores: ['grupo:g-aprov'], solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
eq(!!(await erro(AP.decidirPedido({ id: p5.id, decisao: 'aprovar', sessao: sessao('OPERADOR', 'u-op2') }))), true, 'quem não é do grupo aprovador não decide');
eq(!!(await erro(AP.decidirPedido({ id: p5.id, decisao: 'aprovar', sessao: sessao('VENDEDOR') }))), true, 'vendedor não decide');
eq((await AP.decidirPedido({ id: p5.id, decisao: 'aprovar', sessao: sessao('OPERADOR', 'u-op3') })).status, 'EXECUTADO', 'membro do grupo aprovador decide');

console.log('--- 8. Expiração ---');
const { pedido: p6 } = await AP.criarPedidoAprovacao({ tenantId: T, tipo: 'teste_dois', alvo_id: 'x6', descricao: 'Velho', payload: { ok: true }, solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
await query(`UPDATE pedidos_aprovacao SET expira_em = NOW() - INTERVAL '1 minute' WHERE id = $1`, [p6.id]);
eq(await AP.expirarVencidos(pool, T), 1, 'pedido vencido expira');
eq(!!(await erro(AP.decidirPedido({ id: p6.id, decisao: 'aprovar', sessao: admin }))), true, 'e não se decide mais');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
