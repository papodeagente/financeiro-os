/**
 * UMA conta a pagar por comissão, contra um Postgres real (PGlite), pelas
 * ROTAS de produção: PUT /api/comissoes/[id] (com o gancho que programa a
 * conta), GET e PUT /api/contas-pagar/[id] (o único caminho que move caixa) e
 * GET/POST /api/comissoes/duplicadas, com sessão JWT de verdade (o
 * next/headers é trocado pelo cookie do teste; ver db-de-teste-hook.mjs).
 * Os gestos da tela (aprovar, pagar, cancelar) são os de
 * src/lib/comissao-conta-unica.ts, os mesmos que a página chama.
 *
 * O que se prova:
 *   (a) aprovar e pagar criam e baixam UMA conta; pagar de novo não debita
 *       de novo; a conta antiga `pagar-<id>` viva é adotada e a gêmea
 *       `cp-comissao-<id>` em aberto é cancelada pelo gancho; conta baixada
 *       nunca é tocada; cancelar a comissão cancela a antiga pendente; sem
 *       conta nenhuma (gancho falhou), o pagamento cria a conta única;
 *   (b) GET/POST de duplicadas contam e cancelam exatamente as gêmeas, sem
 *       tocar baixadas nem mover caixa, são idempotentes, isolados por
 *       agência, e o POST exige permissão de editar o financeiro.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-comissao-unica.mjs
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
  CREATE TABLE agencia (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);

let falharSQL = null;
const query = async (text, values) => {
  if (falharSQL && falharSQL.test(text)) throw new Error('banco caiu no meio do gancho');
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
process.env.JWT_SECRET = 'segredo-so-do-teste';
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { createSession } = await import('../src/lib/auth.ts');
const unica = await import('../src/lib/comissao-conta-unica.ts');
const rotaComissoes = await import('../src/app/api/comissoes/route.ts');
const rotaComissao = await import('../src/app/api/comissoes/[id]/route.ts');
const rotaContas = await import('../src/app/api/contas-pagar/route.ts');
const rotaConta = await import('../src/app/api/contas-pagar/[id]/route.ts');
const rotaDuplicadas = await import('../src/app/api/comissoes/duplicadas/route.ts');

const T1 = 'agencia-a';
const HOJE = '2026-10-08';
const sessao = async (tenantId, perfil = 'ADMIN') => {
  globalThis.__COOKIE_DE_TESTE__ = await createSession({
    userId: `u-${tenantId}-${perfil}`, nome: 'Quem', email: 'q@x.com', perfil, permissoes: {}, tenantId, tenantSlug: tenantId,
  });
};
const semSessao = () => { globalThis.__COOKIE_DE_TESTE__ = undefined; };

const pedido = (metodo, url, corpo) => new Request(`https://fin.test${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const comId = id => ({ params: Promise.resolve({ id }) });
async function ok(res) {
  const corpo = await res.json();
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(corpo)}`);
  return corpo;
}

/** As portas da tela, ligadas às rotas de produção. */
const avisos = [];
const portas = {
  gravarComissao: async c => {
    const r = await ok(await rotaComissao.PUT(pedido('PUT', `/api/comissoes/${c.id}`, c), comId(c.id)));
    if (r.aviso) avisos.push(r.aviso);
  },
  lerConta: async id => {
    const res = await rotaConta.GET(pedido('GET', `/api/contas-pagar/${id}`), comId(id));
    if (res.status === 404) return null;
    return ok(res);
  },
  criarConta: async conta => { await ok(await rotaContas.POST(pedido('POST', '/api/contas-pagar', conta))); },
  atualizarConta: async conta => { await ok(await rotaConta.PUT(pedido('PUT', `/api/contas-pagar/${conta.id}`, conta), comId(conta.id))); },
};
const criarComissao = async c => ok(await rotaComissoes.POST(pedido('POST', '/api/comissoes', c)));

const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const conta = (id, tenant = T1) => um(`SELECT id, status, data FROM contas_pagar WHERE id = $1 AND tenant_id = $2`, [id, tenant]);
const contasDa = (comissaoId, tenant = T1) => todos(
  `SELECT id, status, data->>'status' AS st FROM contas_pagar WHERE tenant_id = $1 AND id IN ($2, $3) ORDER BY id`,
  [tenant, `cp-comissao-${comissaoId}`, `pagar-${comissaoId}`],
);
const vivas = async (comissaoId, tenant = T1) => (await contasDa(comissaoId, tenant)).filter(c => c.st !== 'CANCELADO');
const saldo = async (tenant = T1) => Number((await um(`SELECT (data->>'saldo_atual')::numeric s FROM contas_bancarias WHERE tenant_id = $1`, [tenant])).s);

const comissao = (o = {}) => ({
  id: 'com-1', venda_id: 'v-1', venda_numero: 'VND-0001', vendedor_id: 'u-ana', vendedor_nome: 'Ana',
  plano_comissao_id: 'p1', plano_nome: 'Escala', data_venda: '2026-09-03', valor_base: 3500,
  percentual_aplicado: 12, valor_comissao: 420, status: 'CALCULADA', data_aprovacao: null, data_pagamento: null,
  observacoes: '', ...o,
});
/** A conta que a tela antiga criava ao aprovar. */
const contaLegada = (comissaoId, valor, status = 'PENDENTE', tenant = T1, extra = {}) => query(
  `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data) VALUES ($1, $2, '', $3, $4::jsonb)`,
  [`pagar-${comissaoId}`, tenant, status, JSON.stringify({
    id: `pagar-${comissaoId}`, origem: 'OUTROS', descricao: `Comissão Ana — venda ${comissaoId}`, fornecedor_nome: 'Ana',
    valor_final: valor, valor_original: valor, status, data_vencimento: '2026-10-18', auto_gerado: true,
    valor_pago: status === 'PAGO' ? valor : null, conta_bancaria_id: null, ...extra,
  })],
);
/** A conta que o gancho já tinha criado ao lado. */
const contaDoGancho = (comissaoId, valor, status = 'PENDENTE', tenant = T1, extra = {}) => query(
  `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data) VALUES ($1, $2, '', $3, $4::jsonb)`,
  [`cp-comissao-${comissaoId}`, tenant, status, JSON.stringify({
    id: `cp-comissao-${comissaoId}`, origem: 'OUTROS', descricao: 'Comissão · Ana', fornecedor_nome: 'Ana', valor_final: valor,
    status, data_vencimento: '2026-10-18', auto_gerado: true, origem_comissao_id: comissaoId,
    valor_pago: status === 'PAGO' || status === 'PARCIAL' ? (status === 'PARCIAL' ? valor / 2 : valor) : null,
    conta_bancaria_id: null, observacoes: '', ...extra,
  })],
);
const comissaoGravada = (c, tenant = T1) => query(
  `INSERT INTO comissoes (id, tenant_id, venda_id, vendedor_id, status, data) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
  [c.id, tenant, c.venda_id, c.vendedor_id, c.status, JSON.stringify(c)],
);

await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag-a', $1, '{"datas_pagamento_comissao":[1,18]}')`, [T1]);
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('26', $1, '2.6', '{"codigo":"2.6"}')`, [T1]);
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ('caixa-a', $1, 'Caixa Geral', '{"nome":"Caixa Geral","saldo_atual":10000}')`, [T1]);
await sessao(T1);

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) aprovar e pagar: uma conta só ---');
{
  const c = comissao();
  await criarComissao(c);
  eq((await vivas('com-1')).map(x => [x.id, x.st]), [['cp-comissao-com-1', 'PENDENTE']], 'a comissão calculada já tem a sua conta, programada pelo gancho');

  await unica.aprovarComissao(c, HOJE, portas);
  eq((await vivas('com-1')).map(x => [x.id, x.st]), [['cp-comissao-com-1', 'PENDENTE']], 'aprovar não cria uma segunda conta');
  eq(await conta('pagar-com-1'), undefined, 'a conta pagar-<id> da tela antiga não nasce mais');

  const antes = await saldo();
  const r = await unica.pagarComissao({ ...c, status: 'APROVADA' }, HOJE, portas, () => { throw new Error('não devia criar'); });
  eq([r.conta, r.qual, r.baixou], ['cp-comissao-com-1', 'nova', true], 'pagar baixa a conta do gancho');
  const cp = await conta('cp-comissao-com-1');
  eq([cp.status, cp.data.status, cp.data.valor_pago, cp.data.data_pagamento], ['PAGO', 'PAGO', 420, HOJE], 'a conta fica PAGA, com o valor e o dia');
  eq(await saldo(), antes - 420, 'o caixa sai UMA vez, pelo PUT de contas a pagar');
  eq((await contasDa('com-1')).length, 1, 'a comissão paga tem exatamente uma conta');
  eq((await um(`SELECT status FROM comissoes WHERE id = 'com-1'`)).status, 'PAGA', 'a comissão fica PAGA');

  const r2 = await unica.pagarComissao({ ...c, status: 'PAGA' }, HOJE, portas, () => { throw new Error('não devia criar'); });
  eq([r2.baixou, await saldo()], [false, antes - 420], 'pagar de novo (duplo clique) não debita de novo');
  await portas.gravarComissao({ ...c, status: 'PAGA', valor_comissao: 999 });
  eq([(await conta('cp-comissao-com-1')).data.valor_final, (await contasDa('com-1')).length], [420, 1], 'regravar a comissão paga não mexe na conta baixada');
}

console.log('\n--- (a) a conta antiga viva é adotada; a gêmea em aberto é cancelada ---');
{
  // O estado de hoje em produção: aprovada pela tela antiga, com as duas contas.
  const c = comissao({ id: 'com-2', valor_comissao: 300, status: 'APROVADA', data_aprovacao: '2026-10-01' });
  await comissaoGravada(c);
  await contaLegada('com-2', 300);
  await contaDoGancho('com-2', 300);
  const antes = await saldo();
  const r = await unica.pagarComissao(c, HOJE, portas, () => { throw new Error('não devia criar'); });
  eq([r.conta, r.qual], ['pagar-com-2', 'legada'], 'o pagamento baixa a conta antiga, que é a conta da comissão');
  const legada = await conta('pagar-com-2');
  const gemea = await conta('cp-comissao-com-2');
  eq([legada.status, legada.data.valor_pago], ['PAGO', 300], 'a antiga fica paga');
  eq([gemea.status, gemea.data.status], ['CANCELADO', 'CANCELADO'], 'a gêmea do gancho é cancelada pelo gancho');
  eq(/duplicava a conta pagar-com-2/.test(gemea.data.observacoes), true, 'com a observação de que duplicava a antiga');
  eq((await vivas('com-2')).map(x => x.id), ['pagar-com-2'], 'sobra uma conta viva');
  eq(await saldo(), antes - 300, 'o caixa sai uma vez só');
}
{
  // Só a antiga, pendente: gravar a comissão não cria a do gancho ao lado.
  const c = comissao({ id: 'com-6', valor_comissao: 150, status: 'APROVADA' });
  await comissaoGravada(c);
  await contaLegada('com-6', 150);
  await portas.gravarComissao({ ...c, observacoes: 'editada' });
  eq(await conta('cp-comissao-com-6'), undefined, 'com a antiga viva, o gancho não cria a cp-comissao-<id>');
}
{
  // Antiga cancelada: a do gancho volta a ser a conta.
  const c = comissao({ id: 'com-7', valor_comissao: 80, status: 'APROVADA' });
  await comissaoGravada(c);
  await contaLegada('com-7', 80, 'CANCELADO');
  await portas.gravarComissao(c);
  eq((await vivas('com-7')).map(x => [x.id, x.st]), [['cp-comissao-com-7', 'PENDENTE']], 'antiga cancelada não conta: o gancho cria a conta única');
}

console.log('\n--- (a) conta baixada nunca é tocada ---');
{
  const c = comissao({ id: 'com-3', valor_comissao: 200, status: 'PAGA' });
  await comissaoGravada(c);
  await contaLegada('com-3', 200, 'PAGO');
  await contaDoGancho('com-3', 200, 'PAGO');
  const antes = await contasDa('com-3');
  const dadosAntes = await todos(`SELECT id, data FROM contas_pagar WHERE id IN ('pagar-com-3','cp-comissao-com-3') ORDER BY id`);
  await portas.gravarComissao({ ...c, status: 'CANCELADA' });
  const dadosDepois = await todos(`SELECT id, data FROM contas_pagar WHERE id IN ('pagar-com-3','cp-comissao-com-3') ORDER BY id`);
  eq((await contasDa('com-3')).map(x => x.st), antes.map(x => x.st), 'duas contas pagas continuam pagas, mesmo com a comissão cancelada');
  eq(dadosDepois, dadosAntes, 'e o JSON delas não muda uma vírgula');
}
{
  const c = comissao({ id: 'com-4', valor_comissao: 100, status: 'APROVADA' });
  await comissaoGravada(c);
  await contaLegada('com-4', 100);
  await contaDoGancho('com-4', 100, 'PARCIAL');
  await portas.gravarComissao(c);
  eq((await conta('cp-comissao-com-4')).status, 'PARCIAL', 'a gêmea com baixa parcial não é cancelada');
}

console.log('\n--- (a) cancelar a comissão cancela a conta antiga pendente ---');
{
  const c = comissao({ id: 'com-5', valor_comissao: 90, status: 'APROVADA' });
  await comissaoGravada(c);
  await contaLegada('com-5', 90);
  const antes = await saldo();
  await unica.cancelarComissao(c, portas);
  eq((await conta('pagar-com-5')).status, 'CANCELADO', 'a antiga pendente é cancelada');
  eq([(await vivas('com-5')).length, await conta('cp-comissao-com-5')], [0, undefined], 'nenhuma conta viva, e nenhuma nova criada');
  eq(await saldo(), antes, 'cancelar não move caixa');
}

console.log('\n--- (a) sem conta nenhuma, o pagamento cria a conta única ---');
{
  const c = comissao({ id: 'com-8', valor_comissao: 55, status: 'APROVADA' });
  await comissaoGravada(c);
  // O gancho falha (o banco cai na leitura da agência): a comissão grava,
  // a conta não, e o motivo volta como aviso.
  falharSQL = /FROM agencia/;
  const antes = await saldo();
  const r = await unica.pagarComissao(c, HOJE, portas, () => ({
    id: unica.idDaContaDaComissao(c.id), origem: 'OUTROS', descricao: 'Comissão · Ana · venda VND-0001', valor_final: 55,
    valor_original: 55, status: 'PENDENTE', valor_pago: null, data_pagamento: null, conta_bancaria_id: null,
    data_vencimento: HOJE, auto_gerado: true, origem_comissao_id: c.id,
  }));
  falharSQL = null;
  eq(avisos.length > 0, true, 'o gancho falhou e voltou como aviso');
  eq([r.conta, r.qual, r.baixou], ['cp-comissao-com-8', 'criada', true], 'a conta é criada com o id da conta única e baixada');
  eq((await contasDa('com-8')).map(x => [x.id, x.st]), [['cp-comissao-com-8', 'PAGO']], 'uma conta, paga');
  eq(await saldo(), antes - 55, 'o caixa sai uma vez');
  await portas.gravarComissao({ ...c, status: 'PAGA' });
  eq((await contasDa('com-8')).map(x => [x.id, x.st]), [['cp-comissao-com-8', 'PAGO']], 'quando o gancho volta, a conta paga é preservada');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) duplicadas: a lista, antes de mudar qualquer coisa ---');
const DA = 'dup-a', DB = 'dup-b';
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ('caixa-da', $1, 'Caixa Geral', '{"nome":"Caixa Geral","saldo_atual":5000}')`, [DA]);
for (const [id, nome] of [['d-1', 'Bia'], ['d-2', 'Caio']]) {
  await comissaoGravada(comissao({ id, vendedor_nome: nome, status: 'APROVADA' }), DA);
}
await contaDoGancho('d-1', 100, 'PENDENTE', DA); await contaLegada('d-1', 100, 'PENDENTE', DA);   // em dobro
await contaDoGancho('d-2', 250.5, 'PENDENTE', DA); await contaLegada('d-2', 250.5, 'PAGO', DA);  // em dobro (a da tela foi paga)
await contaDoGancho('d-3', 70, 'PAGO', DA); await contaLegada('d-3', 70, 'PENDENTE', DA);        // a do gancho já paga: não
await contaDoGancho('d-4', 60, 'PENDENTE', DA); await contaLegada('d-4', 60, 'CANCELADO', DA);   // a da tela cancelada: não
await contaDoGancho('d-5', 50, 'CANCELADO', DA); await contaLegada('d-5', 50, 'PENDENTE', DA);   // já cancelada: não
await contaDoGancho('d-6', 40, 'PENDENTE', DA);                                                   // sem gêmea: não
await contaDoGancho('d-7', 30, 'PAGO', DA); await contaLegada('d-7', 30, 'PAGO', DA);            // paga duas vezes
await contaDoGancho('d-9', 20, 'PENDENTE', DA); await contaLegada('d-9', 20, 'PENDENTE', DB);    // gêmea em OUTRA agência: não
await contaDoGancho('d-8', 10, 'PENDENTE', DB); await contaLegada('d-8', 10, 'PENDENTE', DB);    // em dobro na outra agência
const fotografia = async ids => todos(`SELECT id, tenant_id, status, data FROM contas_pagar WHERE id = ANY($1::text[]) ORDER BY id, tenant_id`, [ids]);
const intocaveis = ['cp-comissao-d-3', 'pagar-d-3', 'cp-comissao-d-4', 'cp-comissao-d-5', 'cp-comissao-d-6', 'cp-comissao-d-7', 'pagar-d-7', 'pagar-d-1', 'pagar-d-2', 'cp-comissao-d-9', 'pagar-d-9', 'cp-comissao-d-8', 'pagar-d-8'];
const antesDeTudo = await fotografia(intocaveis);
const listar = async () => ok(await rotaDuplicadas.GET());
const cancelar = async () => rotaDuplicadas.POST();

{
  await sessao(DA);
  const g = await listar();
  eq([g.quantidade, g.valor_total], [2, 350.5], 'duas contas em dobro, R$ 350,50');
  eq(g.itens.map(i => [i.comissao_id, i.conta_duplicada_id, i.conta_mantida_id, i.valor, i.vendedor, i.status_da_mantida]), [
    ['d-1', 'cp-comissao-d-1', 'pagar-d-1', 100, 'Bia', 'PENDENTE'],
    ['d-2', 'cp-comissao-d-2', 'pagar-d-2', 250.5, 'Caio', 'PAGO'],
  ], 'cada uma com a conta que sai, a que fica, o valor, o vendedor e a situação da que fica');
  eq(g.pagas_em_dobro.map(i => i.comissao_id), ['d-7'], 'a comissão paga duas vezes aparece à parte, sem entrar na contagem');
  eq((await fotografia(['cp-comissao-d-1', 'cp-comissao-d-2'])).map(c => c.status), ['PENDENTE', 'PENDENTE'], 'listar não muda nada');

  await sessao(DB);
  eq((await listar()).itens.map(i => i.comissao_id), ['d-8'], 'a outra agência vê só a dela (e a gêmea entre agências não é par)');
}

console.log('\n--- (b) quem pode cancelar ---');
{
  await sessao(DA, 'VENDEDOR');
  eq((await rotaDuplicadas.GET()).status, 403, 'vendedor não lê as contas a pagar');
  eq((await cancelar()).status, 403, 'nem cancela');
  semSessao();
  eq((await cancelar()).status, 401, 'sem sessão, 401');
  await sessao(DA);
  eq((await fotografia(['cp-comissao-d-1', 'cp-comissao-d-2'])).map(c => c.status), ['PENDENTE', 'PENDENTE'], 'as recusas não mudaram nada');
}

console.log('\n--- (b) cancelar exatamente as gêmeas ---');
{
  await sessao(DA);
  const antes = await saldo(DA);
  const linhas = async () => (await um(`SELECT COUNT(*)::int n FROM contas_pagar`)).n;
  const linhasAntes = await linhas();
  const r = await ok(await cancelar());
  eq([r.canceladas, r.valor_total, r.ids], [2, 350.5, ['cp-comissao-d-1', 'cp-comissao-d-2']], 'cancela as duas, e só elas');
  const d1 = await conta('cp-comissao-d-1', DA);
  eq([d1.status, d1.data.status, d1.data.cancelada_por_duplicidade?.conta_mantida_id], ['CANCELADO', 'CANCELADO', 'pagar-d-1'], 'na coluna e no JSON, dizendo qual conta ficou');
  eq(/duplicava a conta pagar-d-1/.test(d1.data.observacoes), true, 'com a observação');
  eq(/—/.test(d1.data.observacoes), false, 'sem travessão');
  eq(await fotografia(intocaveis), antesDeTudo, 'as baixadas, as mantidas, as sem par e as da outra agência não mudam');
  eq(await saldo(DA), antes, 'nenhum dinheiro se move');
  eq(await linhas(), linhasAntes, 'nada é excluído');

  const de_novo = await ok(await cancelar());
  eq(de_novo.canceladas, 0, 'rodar de novo não acha mais nada');
  eq((await listar()).quantidade, 0, 'e a lista zera');
  await sessao(DB);
  eq((await listar()).quantidade, 1, 'a outra agência continua com a dela');
}

console.log(`\n${total - falhas}/${total} testes da conta única da comissão passaram`);
if (falhas > 0) process.exit(1);
