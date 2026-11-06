/**
 * Títulos — fechamento de paridade (06/11/2026, E7) contra um Postgres real
 * (PGlite), chamando as ROTAS de produção com sessões de teste.
 *
 * Prova:
 *  1. EXCLUSÃO LÓGICA: o DELETE tira a conta da tabela (relatórios e o GET de
 *     sempre não a veem), guarda em Excluídas, devolve o que foi pago à conta
 *     bancária (com o razão batendo), estorna as baixas no histórico, e o
 *     segundo DELETE não estorna de novo. Período fechado continua barrando.
 *  2. RESTAURAR: volta igual (mesmo id), em aberto, SEM mexer no caixa; avisa
 *     que o pagamento estornado não volta sozinho; pede o perfil que exclui;
 *     404 quando não está nas excluídas; lote "Excluir" também é lógico.
 *  3. EDIÇÃO SIMULTÂNEA: o GET traz `_versao`; PUT com a versão lida grava;
 *     com versão velha responde 409 `conflito`; sem versão grava como sempre;
 *     `_versao` nunca vai para o registro.
 *  4. TRAVA DA VENDA: pessoa, valor e vencimento da conta nascida de venda só
 *     mudam pela venda (409 com `venda_id`); observação e categoria mudam;
 *     PUT parcial não apaga os campos travados; lote não reagenda.
 *  5. EMISSÃO e CAMPOS PERSONALIZADOS conferidos no POST e no PUT.
 *
 * Uso: node --no-warnings scripts/test-sql-titulos-e7.mjs
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
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    grupo_id TEXT NOT NULL DEFAULT '');
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    grupo_id TEXT NOT NULL DEFAULT '');
  CREATE UNIQUE INDEX idx_contas_receber_venda_parcela ON contas_receber (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
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
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-titulos-e7';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { CONTAS_EXCLUIDAS_SCHEMA_SQL } = await import('../src/lib/contas-excluidas-schema.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);
await pg.exec(CONTAS_EXCLUIDAS_SCHEMA_SQL);

await import('../src/lib/aprovacoes-executores.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor, conferirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { hojeISO, addDias, round2 } = await import('../src/lib/money.ts');
const { conferirTravaDaVenda, mensagemDaTrava } = await import('../src/lib/trava-da-venda.ts');
const { semABaixa, avisoDaRestauracao } = await import('../src/lib/contas-excluidas.ts');
const { versaoLida, versaoMudou, semMarcasDeControle } = await import('../src/lib/versao-do-registro.ts');
const RL = await import('../src/app/api/contas-pagar-receber/route.ts');
const RLote = await import('../src/app/api/contas-pagar-receber/lote/route.ts');
const RB = await import('../src/app/api/baixas/route.ts');
const CP = await import('../src/app/api/contas-pagar/route.ts');
const CR = await import('../src/app/api/contas-receber/route.ts');
const CPI = await import('../src/app/api/contas-pagar/[id]/route.ts');
const CRI = await import('../src/app/api/contas-receber/[id]/route.ts');
const CPR = await import('../src/app/api/contas-pagar/[id]/restaurar/route.ts');
const CRR = await import('../src/app/api/contas-receber/[id]/restaurar/route.ts');

const T = 'ag-1';
const T2 = 'ag-2';
const sessao = (perfil, userId = `u-${perfil}`, tenant = T) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo, chave) => new Request(`http://localhost${url}`, {
  method: metodo,
  headers: { 'content-type': 'application/json', ...(chave ? { 'idempotency-key': chave } : {}) },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const titulo = async (tab, id) => (await um(`SELECT data FROM ${tab} WHERE id = $1`, [id]))?.data;
const saldoDaConta = async id => Number((await titulo('contas_bancarias', id)).saldo_atual);
const ctx = id => ({ params: Promise.resolve({ id }) });
const HOJE = hojeISO();
const D = n => addDias(HOJE, n);
const lista = async (params = {}) => json(await RL.GET(req(`/api/contas-pagar-receber?${new URLSearchParams({ por_pagina: '500', ...params })}`)));
const lote = corpo => RLote.POST(req('/api/contas-pagar-receber/lote', 'POST', corpo)).then(json);
const razaoBate = async () => {
  const conf = await emTransacao(exec => conferirRazaoNoExecutor(exec, T, false));
  return conf.linhas.filter(l => l.diferenca !== 0).map(l => l.conta_bancaria_id);
};

for (const [id, perfil] of [['u-ADMIN', 'ADMIN'], ['u-OPERADOR', 'OPERADOR']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, T, JSON.stringify({ id, nome: `Nome ${id}`, perfil, ativo: true })]);
}
for (const [b, t, nome] of [['b1', T, 'Inter'], ['b2', T, 'Itaú'], ['z1', T2, 'Outra']]) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, $3)`, [b, t, JSON.stringify({ id: b, nome, saldo_inicial: 10000, saldo_atual: 10000 })]);
}
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, tipo, data) VALUES ('cat-x', $1, '2.1', 'DESPESA', '{"id":"cat-x","nome":"Aluguel","tipo":"DESPESA","ativo":true}')`, [T]);
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));

const cp = (id, data, t = T) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1,$2,$3,$4)`,
  [id, t, data.status ?? 'PENDENTE', JSON.stringify({ id, fornecedor_nome: 'Operadora X', descricao: `Conta ${id}`, status: 'PENDENTE', moeda: 'BRL', ...data })]);
const cr = (id, data, t = T) => query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1,$2,$3,$4)`,
  [id, t, data.status ?? 'PENDENTE', JSON.stringify({ id, cliente_nome: 'Ana', descricao: `Conta ${id}`, status: 'PENDENTE', ...data })]);

console.log('--- 0. Regras puras ---');
eq(conferirTravaDaVenda('contas_receber', { valor_final: 100 }, { valor_final: 200 }).mudou, [], 'conta sem venda: nada travado');
eq(conferirTravaDaVenda('contas_receber', { origem_venda_id: 'v1', valor_final: 100, cliente_nome: 'Ana', data_vencimento: '2026-12-01' },
  { valor_final: '100.00', cliente_nome: ' Ana ', data_vencimento: '2026-12-01T00:00', observacoes: 'x' }).mudou, [], 'mesmo valor escrito diferente não trava');
eq(conferirTravaDaVenda('contas_pagar', { origem_venda_id: 'v1', valor_final: 100, fornecedor_nome: 'A', data_vencimento: '2026-12-01' },
  { valor_final: 90, fornecedor_nome: 'B', data_vencimento: '2026-12-02' }).mudou, ['pessoa', 'valor', 'vencimento'], 'pessoa, valor e vencimento travados');
eq(conferirTravaDaVenda('contas_receber', { origem_venda_id: 'v1', valor_final: 100, cliente_nome: 'Ana' }, { observacoes: 'só isto' }).item,
  { observacoes: 'só isto', cliente_nome: 'Ana', valor_final: 100, origem_venda_id: 'v1' }, 'PUT parcial preenche os travados com o atual');
eq(mensagemDaTrava(['pessoa', 'valor']).startsWith('Esta conta nasceu de uma venda: pessoa e valor só mudam pela venda.'), true, 'frase da trava lista o que mudou');
eq(semABaixa('contas_pagar', { status: 'PAGO', valor_pago: 80, data_pagamento: '2026-11-01', valor_final: 80 }),
  { status: 'PENDENTE', valor_pago: 0, data_pagamento: '', valor_final: 80 }, 'guardada em aberto, sem a baixa');
eq(semABaixa('contas_pagar', { status: 'CANCELADO', valor_final: 80 }).status, 'CANCELADO', 'cancelada fica cancelada');
eq(avisoDaRestauracao('contas_receber', null), null, 'sem dinheiro, sem aviso na restauração');
eq([versaoLida({ _versao: '123' }), versaoLida({ _versao: 'abc' }), versaoLida({}), versaoMudou(null, '9'), versaoMudou('1', '2')],
  ['123', null, null, false, true], 'versão lida e conferida');
eq(semMarcasDeControle({ a: 1, _versao: '9' }), { a: 1 }, '_versao sai do registro');

console.log('--- 1. Exclusão lógica ---');
como(sessao('ADMIN'));
await cp('e-aberta', { valor_final: 100, data_vencimento: D(3) });
await cr('e-paga', { valor_final: 300, data_vencimento: D(-1) });
// Recebida pela liquidação de verdade (POST /api/baixas): baixa no histórico, caixa e razão.
let r = await json(await RB.POST(req('/api/baixas', 'POST', { modo: 'previa', itens: [
  { titulo_tabela: 'contas_receber', titulo_id: 'e-paga', data: HOJE, conta_bancaria_id: 'b1', forma: 'PIX', valor: 300 }] })));
const itemBaixa = { titulo_tabela: 'contas_receber', titulo_id: 'e-paga', data: HOJE, conta_bancaria_id: 'b1', forma: 'PIX', valor: 300,
  esperado: { status_depois: r.corpo.itens[0].plano.status_depois, valor_baixado_depois: r.corpo.itens[0].plano.valor_baixado_depois } };
r = await json(await RB.POST(req('/api/baixas', 'POST', { modo: 'gravar', itens: [itemBaixa] }, 'baixa-e-paga')));
eq([r.status, (await titulo('contas_receber', 'e-paga')).status, await saldoDaConta('b1')], [200, 'RECEBIDO', 10300], 'recebida pela liquidação');

r = await json(await CPI.DELETE(req('/api/contas-pagar/e-aberta', 'DELETE'), ctx('e-aberta')));
eq([r.status, r.corpo.aviso ?? null, await titulo('contas_pagar', 'e-aberta')], [200, null, undefined], 'conta em aberto sai da tabela, sem aviso');
const guardada = await um(`SELECT data, excluido_por, excluido_por_nome FROM contas_excluidas WHERE tenant_id = $1 AND id = 'e-aberta'`, [T]);
eq([guardada.data.valor_final, guardada.excluido_por, guardada.excluido_por_nome], [100, 'u-ADMIN', 'Pessoa u-ADMIN'], 'guardada em Excluídas, com quem excluiu');
r = await json(await CP.GET(req('/api/contas-pagar')));
eq(r.corpo.some(c => c.id === 'e-aberta'), false, 'o GET de sempre (relatórios) não vê a excluída');

r = await json(await CRI.DELETE(req('/api/contas-receber/e-paga', 'DELETE'), ctx('e-paga')));
eq([r.status, (r.corpo.aviso ?? '').replace(/\s/g, ' ')], [200, 'Os R$ 300,00 recebidos saíram da conta bancária que recebeu.'], 'excluir a recebida avisa o estorno');
eq(await saldoDaConta('b1'), 10000, 'o recebido saiu da conta que recebeu (como sempre)');
eq(await razaoBate(), [], 'o razão bate com o saldo depois da exclusão');
const est = await um(`SELECT COUNT(*)::int AS n, SUM(caixa_centavos)::int AS c FROM baixas WHERE tenant_id = $1 AND titulo_id = 'e-paga' AND tipo = 'estorno'`, [T]);
eq([est.n, est.c], [1, -30000], 'a baixa ganhou o estorno no histórico');
const gPaga = await um(`SELECT data, baixa_estornada FROM contas_excluidas WHERE tenant_id = $1 AND id = 'e-paga'`, [T]);
eq([gPaga.data.status, Number(gPaga.data.valor_recebido), gPaga.baixa_estornada.valor, gPaga.baixa_estornada.conta_bancaria_id],
  ['PENDENTE', 0, 300, 'b1'], 'guardada em aberto, com o quanto foi estornado');
r = await json(await CRI.DELETE(req('/api/contas-receber/e-paga', 'DELETE'), ctx('e-paga')));
eq([r.status, await saldoDaConta('b1')], [200, 10000], 'segundo DELETE não estorna de novo');

r = await lista({ situacao: 'excluido' });
eq([r.status, (r.corpo.linhas ?? []).map(l => l.id).sort()], [200, ['e-aberta', 'e-paga']], 'a lista mostra as duas na situação Excluído');
r = await lista({});
eq((r.corpo.linhas ?? []).some(l => l.id === 'e-aberta' || l.id === 'e-paga'), false, '"Todas" não mostra excluídas');

// Período fechado: a conta paga em data fechada não sai.
await cp('e-fechada', { status: 'PAGO', valor_final: 50, valor_pago: 50, data_pagamento: D(-10), data_vencimento: D(-10), conta_bancaria_id: 'b2' });
await query(`INSERT INTO periodos_fechados (tenant_id, conta_bancaria_id, fechado_ate) VALUES ($1, '', $2)`, [T, D(-5)]);
r = await json(await CPI.DELETE(req('/api/contas-pagar/e-fechada', 'DELETE'), ctx('e-fechada')));
eq([r.status, Boolean(await titulo('contas_pagar', 'e-fechada')), await saldoDaConta('b2')], [423, true, 10000], 'período fechado barra a exclusão (nada muda)');
await query(`DELETE FROM periodos_fechados WHERE tenant_id = $1`, [T]);

console.log('--- 2. Restaurar ---');
como(sessao('OPERADOR'));
r = await json(await CRR.POST(req('/api/contas-receber/e-paga/restaurar', 'POST', {}), ctx('e-paga')));
eq(r.status, 403, 'operador não restaura (mesmo perfil que exclui)');
como(sessao('ADMIN'));
r = await json(await CRR.POST(req('/api/contas-receber/e-paga/restaurar', 'POST', {}), ctx('e-paga')));
eq([r.status, /O recebimento de R\$ 300,00 foi estornado na exclusão/.test((r.corpo.aviso ?? '').replace(/\s/g, ' '))], [200, true], 'restaurada, com o aviso do estorno');
const volta = await titulo('contas_receber', 'e-paga');
eq([volta.status, Number(volta.valor_recebido), volta.valor_final, volta.cliente_nome], ['PENDENTE', 0, 300, 'Ana'], 'voltou igual, em aberto');
eq([await saldoDaConta('b1'), await razaoBate()], [10000, []], 'restaurar não mexe no caixa nem no razão');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM contas_excluidas WHERE id = 'e-paga'`)).n), 0, 'saiu de Excluídas');
r = await json(await CRR.POST(req('/api/contas-receber/e-paga/restaurar', 'POST', {}), ctx('e-paga')));
eq(r.status, 404, 'restaurar de novo: não está nas excluídas');
r = await json(await CPR.POST(req('/api/contas-pagar/e-aberta/restaurar', 'POST', {}), ctx('e-aberta')));
eq([r.status, r.corpo.aviso ?? null, (await titulo('contas_pagar', 'e-aberta')).valor_final], [200, null, 100], 'restaura a conta em aberto sem aviso');
const created = await um(`SELECT created_at::text AS c FROM contas_pagar WHERE id = 'e-aberta'`);
eq(Boolean(created.c), true, 'linha restaurada inteira (com created_at)');

// Liquidar de novo funciona depois de restaurar.
r = await json(await RB.POST(req('/api/baixas', 'POST', { modo: 'previa', itens: [{ ...itemBaixa, esperado: undefined }] })));
eq([r.status, r.corpo.itens?.[0]?.plano?.status_depois], [200, 'RECEBIDO'], 'a restaurada pode ser liquidada de novo');

// Lote "Excluir" também é lógico.
await cp('e-lote', { valor_final: 70, data_vencimento: D(2) });
r = await lote({ modo: 'previa', acao: 'excluir', itens: [{ tabela: 'contas_pagar', id: 'e-lote' }] });
r = await lote({ modo: 'gravar', acao: 'excluir', itens: [{ tabela: 'contas_pagar', id: 'e-lote' }], assinatura: r.corpo.assinatura });
const gl = await um(`SELECT excluido_por FROM contas_excluidas WHERE id = 'e-lote'`);
eq([r.status, Boolean(await titulo('contas_pagar', 'e-lote')), gl?.excluido_por], [200, false, 'u-ADMIN'], 'lote exclui logicamente, com quem excluiu');

// Venda já gerou outra conta para a mesma parcela: restaurar não duplica.
await cr('v-p1', { valor_final: 500, data_vencimento: D(10), origem_venda_id: 'venda-9', origem_item_id: 'i1', parcela_numero: 1, auto_gerado: true });
await json(await CRI.DELETE(req('/api/contas-receber/v-p1', 'DELETE'), ctx('v-p1')));
await cr('v-p1-nova', { valor_final: 500, data_vencimento: D(10), origem_venda_id: 'venda-9', origem_item_id: 'i1', parcela_numero: 1, auto_gerado: true });
r = await json(await CRR.POST(req('/api/contas-receber/v-p1/restaurar', 'POST', {}), ctx('v-p1')));
eq([r.status, Boolean(await titulo('contas_receber', 'v-p1')), Number((await um(`SELECT COUNT(*)::int AS n FROM contas_excluidas WHERE id = 'v-p1'`)).n)],
  [409, false, 1], 'a venda já refez a parcela: nada restaurado, continua em Excluídas');

console.log('--- 3. Edição simultânea ---');
await cp('s1', { valor_final: 120, data_vencimento: D(4), observacoes: '' });
r = await json(await CP.GET(req('/api/contas-pagar')));
const lida = r.corpo.find(c => c.id === 's1');
eq(typeof lida._versao, 'string', 'o GET traz a versão');
r = await json(await CPI.GET(req('/api/contas-pagar/s1'), ctx('s1')));
eq(r.corpo._versao, lida._versao, 'o GET de uma conta traz a mesma versão');
r = await json(await CPI.PUT(req('/api/contas-pagar/s1', 'PUT', { ...lida, observacoes: 'primeira', _status_lido: 'PENDENTE' }), ctx('s1')));
eq([r.status, r.corpo._versao, (await titulo('contas_pagar', 's1')).observacoes, '_versao' in (await titulo('contas_pagar', 's1'))],
  [200, undefined, 'primeira', false], 'PUT com a versão lida grava (e a versão não vai para o registro)');
r = await json(await CPI.PUT(req('/api/contas-pagar/s1', 'PUT', { ...lida, observacoes: 'segunda (tela velha)' }), ctx('s1')));
eq([r.status, r.corpo.conflito, (await titulo('contas_pagar', 's1')).observacoes], [409, true, 'primeira'], 'versão velha: 409, nada gravado');
r = await json(await CPI.PUT(req('/api/contas-pagar/s1', 'PUT', { ...(await titulo('contas_pagar', 's1')), observacoes: 'sem versão' }), ctx('s1')));
eq([r.status, (await titulo('contas_pagar', 's1')).observacoes], [200, 'sem versão'], 'PUT sem versão grava como sempre');
r = await json(await CP.POST(req('/api/contas-pagar', 'POST', { id: 'novo-com-versao', fornecedor_nome: 'Z', valor_final: 5, status: 'PENDENTE', _versao: '1' })));
eq([r.status, '_versao' in (await titulo('contas_pagar', 'novo-com-versao'))], [200, false], 'POST também não grava a versão');

console.log('--- 4. Trava da venda ---');
await cr('tv', { valor_final: 900, cliente_id: 'cli-1', cliente_nome: 'Carla', data_vencimento: D(20), origem_venda_id: 'venda-7', categoria_id: '' });
const tv = (await json(await CRI.GET(req('/api/contas-receber/tv'), ctx('tv')))).corpo;
r = await json(await CRI.PUT(req('/api/contas-receber/tv', 'PUT', { ...tv, valor_final: 800 }), ctx('tv')));
eq([r.status, r.corpo.venda_id, /valor só mudam pela venda/.test(r.corpo.error)], [409, 'venda-7', true], 'valor da conta da venda: 409 com o link da venda');
r = await json(await CRI.PUT(req('/api/contas-receber/tv', 'PUT', { ...tv, cliente_nome: 'Outra', data_vencimento: D(25) }), ctx('tv')));
eq([r.status, /pessoa e vencimento/.test(r.corpo.error)], [409, true], 'pessoa e vencimento também');
r = await json(await CRI.PUT(req('/api/contas-receber/tv', 'PUT', { ...tv, observacoes: 'cliente pediu boleto', categoria_id: 'cat-x' }), ctx('tv')));
eq([r.status, (await titulo('contas_receber', 'tv')).observacoes, (await titulo('contas_receber', 'tv')).categoria_id], [200, 'cliente pediu boleto', 'cat-x'],
  'observação e categoria continuam editáveis');
const semValor = { ...(await titulo('contas_receber', 'tv')) };
delete semValor.valor_final; delete semValor.cliente_nome;
r = await json(await CRI.PUT(req('/api/contas-receber/tv', 'PUT', { ...semValor, observacoes: 'parcial' }), ctx('tv')));
eq([r.status, (await titulo('contas_receber', 'tv')).valor_final, (await titulo('contas_receber', 'tv')).cliente_nome], [200, 900, 'Carla'], 'PUT parcial não apaga pessoa nem valor');
r = await lote({ modo: 'previa', acao: 'reagendar', itens: [{ tabela: 'contas_receber', id: 'tv' }], dias: 3 });
eq([r.corpo.itens[0].ok, r.corpo.itens[0].motivo], [false, 'Nasceu de uma venda: o vencimento muda pela venda.'], 'lote não reagenda conta da venda');

console.log('--- 5. Emissão e campos personalizados ---');
r = await json(await CP.POST(req('/api/contas-pagar', 'POST', { id: 'em1', fornecedor_nome: 'Z', valor_final: 5, status: 'PENDENTE', data_emissao: D(5), data_vencimento: D(1) })));
eq([r.status, /emissão/i.test(r.corpo.error ?? '')], [400, true], 'POST com emissão depois do vencimento: recusado');
await cp('em2', { valor_final: 5, data_emissao: D(-3), data_vencimento: D(1) });
const em2 = await titulo('contas_pagar', 'em2');
r = await json(await CPI.PUT(req('/api/contas-pagar/em2', 'PUT', { ...em2, data_emissao: D(9) }), ctx('em2')));
eq(r.status, 400, 'PUT que põe a emissão depois do vencimento: recusado');
await cp('em-antiga', { valor_final: 5, data_emissao: D(9), data_vencimento: D(1) });
r = await json(await CPI.PUT(req('/api/contas-pagar/em-antiga', 'PUT', { ...(await titulo('contas_pagar', 'em-antiga')), observacoes: 'ok' }), ctx('em-antiga')));
eq(r.status, 200, 'conta antiga com datas fora de ordem continua editável no resto');
r = await json(await CP.POST(req('/api/contas-pagar', 'POST', { id: 'cp1', fornecedor_nome: 'Z', valor_final: 5, status: 'PENDENTE',
  campos_personalizados: { pedido: '  PO-12  ', aprovado: true, vazio: '', qtd: 3 } })));
const ordenado = o => Object.fromEntries(Object.entries(o ?? {}).sort());
eq([r.status, ordenado((await titulo('contas_pagar', 'cp1')).campos_personalizados)], [200, { aprovado: true, pedido: 'PO-12', qtd: 3 }], 'campos personalizados limpos ao gravar');
r = await json(await CP.POST(req('/api/contas-pagar', 'POST', { id: 'cp2', fornecedor_nome: 'Z', valor_final: 5, status: 'PENDENTE', campos_personalizados: { 'Id Ruim!': 'x' } })));
eq(r.status, 400, 'campo com identificador inválido: recusado');
r = await json(await CPI.PUT(req('/api/contas-pagar/cp1', 'PUT', { ...(await titulo('contas_pagar', 'cp1')), campos_personalizados: { pedido: { obj: 1 } } }), ctx('cp1')));
eq(r.status, 400, 'PUT com valor que não é texto/número/sim-não: recusado');

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
