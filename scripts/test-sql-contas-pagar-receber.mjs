/**
 * Contas a Pagar/Receber numa lista só (05/11/2026) contra um Postgres real
 * (PGlite), chamando as ROTAS de produção com sessões de teste.
 *
 * Prova:
 *  1. FILTROS E TOTAIS BATEM com as telas atuais de Contas a pagar e Contas a
 *     receber (as mesmas contas no recorte e os mesmos números dos cartões e
 *     do "Total das contas listadas", pelas fórmulas das próprias telas).
 *  2. CONTAS LIBERADAS: a conta baixada numa conta bancária não liberada some,
 *     exatamente como no GET de hoje de /api/contas-pagar e /api/contas-receber.
 *  3. ISOLAMENTO por agência; PAGINAÇÃO (as páginas juntas são a lista);
 *     busca "Em" cada campo; categoria e centro também pelo rateio; datas de
 *     emissão, vencimento e liquidação; planilha com o direito "exportar".
 *  4. LIQUIDAR EM LOTE pelo POST /api/baixas: prévia com assinatura, gravação
 *     com Idempotency-Key (repetir não grava duas vezes).
 *  5. REAGENDAR respeita período fechado (prévia mostra, gravar responde 423),
 *     baixa já feita e limites de vencimento; RECATEGORIZAR respeita o tipo da
 *     categoria, o rateio e "alterar lançamento já baixado"; EXCLUIR exige o
 *     perfil que exclui, estorna o que foi baixado e para no período fechado.
 *
 * Uso: node --no-warnings scripts/test-sql-contas-pagar-receber.mjs
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
process.env.JWT_SECRET = 'segredo-de-teste-contas';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);

await import('../src/lib/aprovacoes-executores.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { hojeISO, addDias, somaPor, num, round2, estaVencido, dentroDoPeriodo } = await import('../src/lib/money.ts');
const { valorBRLDaConta, saldoDevedor } = await import('../src/app/financeiro-ag/pagar/valores.ts');
const RL = await import('../src/app/api/contas-pagar-receber/route.ts');
const RLote = await import('../src/app/api/contas-pagar-receber/lote/route.ts');
const RB = await import('../src/app/api/baixas/route.ts');
const CP = await import('../src/app/api/contas-pagar/route.ts');
const CR = await import('../src/app/api/contas-receber/route.ts');
const RPerfis = await import('../src/app/api/perfis-de-acesso/route.ts');
const RBL = await import('../src/app/api/limites-e-aprovacao/route.ts');

const T = 'ag-1';
const T2 = 'ag-2';
const sessao = (perfil, userId = `u-${perfil}`, tenant = T) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const admin = sessao('ADMIN');
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
let chaveN = 0;
const req = (url, metodo = 'GET', corpo, chave) => new Request(`http://localhost${url}`, {
  method: metodo,
  headers: { 'content-type': 'application/json', ...(chave ? { 'idempotency-key': chave } : {}) },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const titulo = async (tab, id) => (await um(`SELECT data FROM ${tab} WHERE id = $1`, [id])).data;
const saldoDaConta = async id => Number((await titulo('contas_bancarias', id)).saldo_atual);
const lista = async (params = {}) => json(await RL.GET(req(`/api/contas-pagar-receber?${new URLSearchParams({ por_pagina: '500', ...params })}`)));
const ids = linhas => linhas.map(l => l.id).sort();
const lote = (corpo) => RLote.POST(req('/api/contas-pagar-receber/lote', 'POST', corpo)).then(json);

const HOJE = hojeISO();
const MES = HOJE.slice(0, 7);
const D = n => addDias(HOJE, n);

// ---------------------------------------------------------------------------
// Cadastro
for (const [id, perfil] of [['u-ADMIN', 'ADMIN'], ['u-OPERADOR', 'OPERADOR'], ['u-op2', 'OPERADOR']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, T, JSON.stringify({ id, nome: `Nome ${id}`, perfil, ativo: true })]);
}
for (const [b, t, nome] of [['b1', T, 'Inter'], ['b2', T, 'Itaú'], ['z1', T2, 'Outra']]) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, $3)`, [b, t, JSON.stringify({ id: b, nome, saldo_inicial: 0, saldo_atual: 10000 })]);
}
for (const [id, nome, codigo, tipo, extra] of [
  ['cat-aluguel', 'Aluguel', '2.1', 'DESPESA', { natureza_custo: 'FIXO', is_custo_comercial: false }],
  ['cat-anuncios', 'Anúncios', '2.6', 'DESPESA', { natureza_custo: 'VARIAVEL', is_custo_comercial: true }],
  ['cat-pacotes', 'Pacotes', '1.1', 'RECEITA', {}],
]) {
  await query(`INSERT INTO plano_contas (id, tenant_id, codigo, tipo, data) VALUES ($1, $2, $3, $4, $5)`, [id, T, codigo, tipo, JSON.stringify({ id, nome, codigo, tipo, ativo: true, ...extra })]);
}
for (const [id, nome] of [['cc-sp', 'Loja SP'], ['cc-rj', 'Loja RJ']]) {
  await query(`INSERT INTO centros_custo (id, tenant_id, nome, data) VALUES ($1, $2, $3, $4)`, [id, T, nome, JSON.stringify({ id, nome, ativo: true })]);
}
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));

const cp = (id, data, t = T) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1,$2,$3,$4)`,
  [id, t, data.status ?? 'PENDENTE', JSON.stringify({ id, fornecedor_nome: 'Operadora X', descricao: `Conta ${id}`, status: 'PENDENTE', moeda: 'BRL', ...data })]);
const cr = (id, data, t = T) => query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1,$2,$3,$4)`,
  [id, t, data.status ?? 'PENDENTE', JSON.stringify({ id, cliente_nome: 'Ana', descricao: `Conta ${id}`, status: 'PENDENTE', ...data })]);

// A pagar: em aberto, atrasada, paga em parte, paga, cancelada, sem valor_final (só valor_brl), mês passado.
await cp('p-aberta', { valor_final: 100, data_vencimento: D(3), data_emissao: D(-10), categoria_id: 'cat-aluguel', centro_custo_id: 'cc-sp', centro_custo: 'Loja SP', conta_bancaria_id: 'b1' });
await cp('p-atrasada', { valor_final: 250.5, data_vencimento: D(-5), fornecedor_nome: 'Hotel Beira Mar', categoria_id: 'cat-aluguel', documento: 'NF-778' });
await cp('p-parcial', { status: 'PARCIAL', valor_final: 300, valor_pago: 120, data_pagamento: D(-1), data_vencimento: D(-2), conta_bancaria_id: 'b1',
  rateio: [{ centro_custo_id: 'cc-sp', percentual: 50, valor: 150 }, { centro_custo_id: 'cc-rj', percentual: 50, valor: 150 }] });
await cp('p-paga-b1', { status: 'PAGO', valor_final: 80, valor_pago: 80, data_pagamento: D(-3), data_vencimento: D(-3), conta_bancaria_id: 'b1', categoria_id: 'cat-anuncios' });
await cp('p-paga-b2', { status: 'PAGO', valor_final: 60, valor_pago: 60, data_pagamento: D(-4), data_vencimento: D(-4), conta_bancaria_id: 'b2' });
await cp('p-cancelada', { status: 'CANCELADO', valor_final: 999, data_vencimento: D(1) });
await cp('p-brl', { valor_final: 0, valor_brl: 530.25, moeda: 'USD', cambio: 5.05, valor_original: 105, data_vencimento: D(10), parcela_numero: 2, total_parcelas: 6 });
await cp('p-mes-passado', { valor_final: 40, data_vencimento: addDias(`${MES}-01`, -3) });
// A receber: em aberto, atrasada, recebida em parte, recebida, cancelada, com rateio por categoria.
await cr('r-aberta', { valor_final: 1000, data_vencimento: D(5), categoria_id: 'cat-pacotes', cliente_nome: 'Bruno Lima', conta_bancaria_id: 'b2' });
await cr('r-atrasada', { valor_final: 450, data_vencimento: D(-7), documento: 'PED-9' });
await cr('r-parcial', { status: 'PARCIAL', valor_final: 900, valor_recebido: 300, data_recebimento: D(-1), data_vencimento: D(-1), conta_bancaria_id: 'b2' });
await cr('r-recebida-b1', { status: 'RECEBIDO', valor_final: 700, valor_recebido: 700, data_recebimento: D(-2), data_vencimento: D(-2), conta_bancaria_id: 'b1' });
await cr('r-cancelada', { status: 'CANCELADO', valor_final: 50, data_vencimento: D(2) });
await cr('r-rateio', { valor_final: 200, data_vencimento: D(4), rateio: [{ centro_custo_id: 'cc-rj', categoria_id: 'cat-pacotes', percentual: 100, valor: 200 }] });
// Outra agência: nunca aparece.
await cp('x-p', { valor_final: 5000, data_vencimento: D(1) }, T2);
await cr('x-r', { valor_final: 5000, data_vencimento: D(1) }, T2);

// ---------------------------------------------------------------------------
// As fórmulas das telas de hoje, copiadas das próprias telas.
const todasPagar = (await query(`SELECT data FROM contas_pagar WHERE tenant_id = $1`, [T])).rows.map(r => r.data);
const todasReceber = (await query(`SELECT data FROM contas_receber WHERE tenant_id = $1`, [T])).rows.map(r => r.data);
// pagar/page.tsx
const ehVencidoEmAberto = i => (i.status === 'PENDENTE' || i.status === 'PARCIAL' || i.status === 'VENCIDO') && estaVencido(i.data_vencimento, HOJE);
const recortePagar = (de, ate) => todasPagar.filter(i => dentroDoPeriodo(i.data_vencimento, de || '0000-01-01', ate || '9999-12-31'));
// receber/page.tsx
const statusEfetivo = i => ((i.status === 'PENDENTE' || i.status === 'PARCIAL') && estaVencido(i.data_vencimento, HOJE) ? 'ATRASADO' : i.status);
const valorEmAberto = i => round2(num(i.valor_final) - num(i.valor_recebido));

console.log('--- 1. Filtros e totais batem com as telas atuais ---');
como(sessao('OPERADOR'));
const inicioMes = `${MES}-01`;
const fimMes = addDias(addDias(`${MES}-28`, 4).slice(0, 7) + '-01', -1);
let r = await lista({ tipo: 'pagar', de: inicioMes, ate: fimMes });
eq(r.status, 200, 'lista responde');
let base = recortePagar(inicioMes, fimMes);
eq(ids(r.corpo.linhas), base.map(i => i.id).sort(), 'a pagar, este mês por vencimento: as mesmas contas da tela de Contas a pagar');
eq(r.corpo.totais.pagar.aberto, somaPor(base.filter(i => i.status === 'PENDENTE' || i.status === 'PARCIAL'), saldoDevedor), 'cartão "Saldo a pagar" igual');
eq(r.corpo.totais.pagar.liquidado, somaPor(base.filter(i => i.status === 'PAGO'), i => (i.valor_pago ?? valorBRLDaConta(i))), 'cartão "Pago" igual');
eq(r.corpo.totais.pagar.atraso, somaPor(base.filter(ehVencidoEmAberto), saldoDevedor), 'cartão "Vencido" igual');
eq(r.corpo.totais.pagar.valor, somaPor(base.filter(i => i.status !== 'CANCELADO'), valorBRLDaConta), '"Total das contas listadas" igual (canceladas fora dos totais)');
eq(r.corpo.totais.canceladas, base.filter(i => i.status === 'CANCELADO').length, 'diz quantas canceladas ficaram fora dos totais');
r = await lista({ tipo: 'pagar', de: inicioMes, ate: fimMes, situacao: 'em_aberto' });
eq(r.corpo.totais.pagar.valor, somaPor(base.filter(i => i.status === 'PENDENTE' || i.status === 'PARCIAL'), valorBRLDaConta), 'Em aberto: total igual ao filtro "Com saldo a pagar"');
r = await lista({ tipo: 'pagar', situacao: 'em_atraso' });
eq(ids(r.corpo.linhas), todasPagar.filter(ehVencidoEmAberto).map(i => i.id).sort(), 'Em atraso: as mesmas do cartão "Vencido" em todo o período');
r = await lista({ tipo: 'pagar', situacao: 'liquidado' });
eq(ids(r.corpo.linhas), todasPagar.filter(i => i.status === 'PAGO').map(i => i.id).sort(), 'Pago: as mesmas do filtro "Pago"');
const brl = (await lista({ tipo: 'pagar' })).corpo.linhas.find(l => l.id === 'p-brl');
eq([brl.valor, brl.saldo, brl.parcela, brl.moeda], [530.25, 530.25, '2/6', 'USD'], 'conta em moeda estrangeira vale em reais, como na tela');

r = await lista({ tipo: 'receber' });
eq(ids(r.corpo.linhas), todasReceber.map(i => i.id).sort(), 'a receber, todo o período: as mesmas contas');
const t = r.corpo.totais.receber;
eq(round2(t.aberto - t.atraso), somaPor(todasReceber.filter(i => statusEfetivo(i) === 'PENDENTE' || statusEfetivo(i) === 'PARCIAL'), valorEmAberto), 'cartão "Pendente" da tela de receber igual (aberto − atraso)');
eq(t.atraso, somaPor(todasReceber.filter(i => statusEfetivo(i) === 'ATRASADO'), valorEmAberto), 'cartão "Atrasado" igual');
eq(t.baixado, somaPor(todasReceber.filter(i => i.status === 'RECEBIDO' || i.status === 'PARCIAL'),
  i => (i.status === 'RECEBIDO' ? (i.valor_recebido ?? i.valor_final) : num(i.valor_recebido))), 'cartão "Recebido" igual');
r = await lista({ tipo: 'receber', situacao: 'em_atraso' });
eq(ids(r.corpo.linhas), todasReceber.filter(i => statusEfetivo(i) === 'ATRASADO').map(i => i.id).sort(), 'Em atraso = filtro "Em atraso" da tela de receber');
r = await lista({ tipo: 'receber', situacao: 'cancelado' });
eq(ids(r.corpo.linhas), ['r-cancelada'], 'Cancelado');

r = await lista({});
const tot = r.corpo.totais;
eq([tot.pagar.quantidade + tot.receber.quantidade, r.corpo.total], [todasPagar.length + todasReceber.length, todasPagar.length + todasReceber.length], 'Ambos: pagar e receber juntos');
eq(tot.saldo, round2(tot.receber.valor - tot.pagar.valor), 'saldo do filtro = a receber − a pagar');
eq(tot.saldo_aberto, round2(tot.receber.aberto - tot.pagar.aberto), 'saldo em aberto = a receber − a pagar em aberto');
const parc = r.corpo.linhas.find(l => l.id === 'p-parcial');
eq([parc.situacao, parc.parcial, parc.saldo, parc.baixado, parc.dias_atraso], ['em_atraso', true, 180, 120, 2], 'paga em parte e atrasada: saldo, pago e dias de atraso');
eq(r.corpo.linhas.some(l => l.id.startsWith('x-')), false, 'outra agência nunca aparece');

console.log('--- 2. Filtros, busca "Em", datas, ordem e páginas ---');
eq(ids((await lista({ busca: 'beira', em: 'pessoa' })).corpo.linhas), ['p-atrasada'], 'busca em Pessoa');
eq(ids((await lista({ busca: 'beira', em: 'descricao' })).corpo.linhas), [], 'o mesmo texto em Descrição não acha');
eq(ids((await lista({ busca: 'NF-778', em: 'documento' })).corpo.linhas), ['p-atrasada'], 'busca em Documento');
eq(ids((await lista({ busca: 'anún', em: 'categoria' })).corpo.linhas), ['p-paga-b1'], 'busca em Categoria');
eq(ids((await lista({ busca: 'loja sp', em: 'centro' })).corpo.linhas), ['p-aberta'], 'busca em Centro de custo');
eq(ids((await lista({ busca: '100%_' })).corpo.linhas), [], 'curinga do SQL é texto, não curinga');
eq(ids((await lista({ categoria: 'cat-pacotes' })).corpo.linhas), ['r-aberta', 'r-rateio'], 'categoria também pelo rateio');
eq(ids((await lista({ centro: 'cc-rj' })).corpo.linhas), ['p-parcial', 'r-rateio'], 'centro também pelo rateio');
eq(ids((await lista({ conta: 'b2' })).corpo.linhas), ['p-paga-b2', 'r-aberta', 'r-parcial'], 'conta bancária');
eq(ids((await lista({ data: 'liquidacao', de: D(-2), ate: HOJE })).corpo.linhas), ['p-parcial', 'r-parcial', 'r-recebida-b1'], 'Data de: Liquidação');
eq(ids((await lista({ data: 'emissao', de: D(-10), ate: D(-10) })).corpo.linhas), ['p-aberta'], 'Data de: Emissão');
eq((await lista({ situacao: 'xpto' })).status, 400, 'filtro inválido: 400');
const ordenada = (await lista({ ordem: 'valor', direcao: 'desc' })).corpo.linhas.map(l => l.valor);
eq(ordenada, [...ordenada].sort((a, b) => b - a), 'ordem por valor, do maior');
const todas = (await lista({ ordem: 'pessoa' })).corpo.linhas.map(l => l.chave);
const pag = [];
for (let p = 1; p <= 5; p++) pag.push(...(await lista({ ordem: 'pessoa', por_pagina: '3', pagina: String(p) })).corpo.linhas.map(l => l.chave));
eq(pag, todas, 'as páginas juntas são a lista inteira, na mesma ordem');
const p2 = await lista({ por_pagina: '3', pagina: '2' });
eq([p2.corpo.pagina, p2.corpo.total_paginas, p2.corpo.totais.pagar.quantidade + p2.corpo.totais.receber.quantidade], [2, 5, 14], 'os totais são do filtro inteiro, não da página');

console.log('--- 3. Contas liberadas ---');
como(admin);
r = await json(await RPerfis.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op2', contas_liberadas: ['b2'], acoes_negadas: ['exportar', 'editar_liquidado'] } })));
eq(r.status, 200, 'admin libera só a conta b2 para o operador 2');
como(sessao('OPERADOR', 'u-op2'));
const crudPagar = (await json(await CP.GET(req('/api/contas-pagar')))).corpo.map(i => i.id).sort();
const crudReceber = (await json(await CR.GET(req('/api/contas-receber')))).corpo.map(i => i.id).sort();
r = await lista({});
eq(ids(r.corpo.linhas), [...crudPagar, ...crudReceber].sort(), 'a lista vê exatamente o que as telas de hoje veem');
eq(r.corpo.linhas.some(l => l.id === 'p-paga-b1' || l.id === 'r-recebida-b1' || l.id === 'p-parcial'), false, 'baixadas na conta b1 somem');
eq(r.corpo.linhas.some(l => l.id === 'p-aberta'), true, 'em aberto com previsão na b1 continua (só some o que já foi baixado)');
eq((await RL.GET(req('/api/contas-pagar-receber?format=chaves'))).status, 200, 'selecionar todas do filtro responde');
eq((await json(await RL.GET(req('/api/contas-pagar-receber?format=csv')))).status, 403, 'planilha sem o direito "exportar": 403');
como(sessao('VENDEDOR'));
eq((await lista({})).status, 403, 'vendedor não lê o financeiro');

console.log('--- 4. Planilha ---');
como(admin);
await cp('p-formula', { valor_final: 10.5, data_vencimento: D(20), descricao: '=HYPERLINK("x")' });
let resp = await RL.GET(req('/api/contas-pagar-receber?format=csv&busca=HYPERLINK'));
const bytes = new Uint8Array(await resp.arrayBuffer());
const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
eq([resp.status, [...bytes.slice(0, 3)], resp.headers.get('content-type')], [200, [0xEF, 0xBB, 0xBF], 'text/csv; charset=utf-8'], 'CSV com BOM, para o Excel');
eq(csv.includes(`"'=HYPERLINK(""x"")"`), true, 'fórmula neutralizada');
eq(csv.includes('"10,50"'), true, 'valor com vírgula decimal (número no Excel)');
await query(`DELETE FROM contas_pagar WHERE id = 'p-formula'`);

console.log('--- 5. Liquidar em lote pelo /api/baixas ---');
como(sessao('OPERADOR'));
await cr('l1', { valor_final: 150, data_vencimento: D(1) });
await cr('l2', { valor_final: 350, data_vencimento: D(2) });
const itensBaixa = [
  { titulo_tabela: 'contas_receber', titulo_id: 'l1', data: HOJE, conta_bancaria_id: 'b2', forma: 'PIX', valor: 150 },
  { titulo_tabela: 'contas_receber', titulo_id: 'l2', data: HOJE, conta_bancaria_id: 'b2', forma: 'PIX', valor: 350 },
];
const saldoB2 = await saldoDaConta('b2');
r = await json(await RB.POST(req('/api/baixas', 'POST', { modo: 'previa', itens: itensBaixa })));
eq([r.status, r.corpo.itens.map(i => i.plano.status_depois), r.corpo.porteiro.ok, typeof r.corpo.assinatura], [200, ['RECEBIDO', 'RECEBIDO'], true, 'string'], 'prévia do lote: as duas quitam');
eq((await titulo('contas_receber', 'l1')).status, 'PENDENTE', 'a prévia não grava');
// Como a tela faz (igual ao useLiquidacao): o que a prévia mostrou vai em `esperado`, conta por conta.
const itensGravar = itensBaixa.map((it, i) => ({ ...it, esperado: { status_depois: r.corpo.itens[i].plano.status_depois, valor_baixado_depois: r.corpo.itens[i].plano.valor_baixado_depois } }));
const gravarBaixas = () => RB.POST(req('/api/baixas', 'POST', { modo: 'gravar', itens: itensGravar }, 'lote-l1-l2')).then(json);
let g = await gravarBaixas();
eq([g.status, Boolean(g.corpo.lote_id)], [200, true], 'gravar o lote');
g = await gravarBaixas();
eq(g.status, 200, 'repetir com a mesma chave responde igual');
eq([await saldoDaConta('b2'), Number((await um(`SELECT COUNT(*)::int AS n FROM baixas WHERE tenant_id = $1 AND titulo_id IN ('l1','l2') AND tipo = 'baixa'`, [T])).n)],
  [round2(saldoB2 + 500), 2], 'o caixa entra uma vez só');
r = await lista({ busca: 'Conta l', em: 'descricao', situacao: 'liquidado' });
eq(ids(r.corpo.linhas), ['l1', 'l2'], 'a lista mostra as duas como recebidas');

console.log('--- 6. Reagendar ---');
await cp('g1', { valor_final: 10, data_vencimento: D(5), conta_bancaria_id: 'b1' });
await cp('g2', { valor_final: 20, data_vencimento: D(6) });
const itensG = [{ tabela: 'contas_pagar', id: 'g1' }, { tabela: 'contas_pagar', id: 'g2' }, { tabela: 'contas_pagar', id: 'p-parcial' }, { tabela: 'contas_pagar', id: 'x-p' }];
r = await lote({ modo: 'previa', acao: 'reagendar', dias: 7, itens: itensG });
eq([r.status, r.corpo.prontos, r.corpo.fora], [200, 2, 2], 'prévia: duas prontas, duas de fora');
eq(r.corpo.itens.map(i => [i.id, i.ok, i.tipo_motivo ?? null]), [['g1', true, null], ['g2', true, null], ['p-parcial', false, 'regra'], ['x-p', false, 'nao_encontrada']],
  'conta com pagamento e conta de outra agência ficam de fora');
eq((await lote({ modo: 'gravar', acao: 'reagendar', dias: 7, itens: itensG, assinatura: r.corpo.assinatura })).status, 409, 'gravar com conta que não está pronta: 409');
let prontas = itensG.slice(0, 2);
r = await lote({ modo: 'previa', acao: 'reagendar', dias: 7, itens: prontas });
await query(`UPDATE contas_pagar SET updated_at = NOW() + interval '1 second', data = jsonb_set(data, '{descricao}', '"mudou"') WHERE id = 'g2'`);
eq((await lote({ modo: 'gravar', acao: 'reagendar', dias: 7, itens: prontas, assinatura: r.corpo.assinatura })).status, 409, 'conta mudou depois da prévia: 409 e nada gravado');
eq((await titulo('contas_pagar', 'g1')).data_vencimento, D(5), 'g1 não mudou (tudo ou nada)');
r = await lote({ modo: 'previa', acao: 'reagendar', dias: 7, itens: prontas });
g = await lote({ modo: 'gravar', acao: 'reagendar', dias: 7, itens: prontas, assinatura: r.corpo.assinatura });
eq([g.status, g.corpo.gravado, (await titulo('contas_pagar', 'g1')).data_vencimento, (await titulo('contas_pagar', 'g2')).data_vencimento], [200, true, D(12), D(13)], 'gravou: sete dias depois, as duas');

// Período fechado (Fechar Caixa) até daqui a 20 dias, só na conta b1.
await query(`INSERT INTO periodos_fechados (tenant_id, conta_bancaria_id, fechado_ate) VALUES ($1, 'b1', $2)`, [T, D(20)]);
r = await lote({ modo: 'previa', acao: 'reagendar', nova_data: D(15), itens: prontas });
eq(r.corpo.itens.map(i => [i.id, i.ok, i.tipo_motivo ?? null]), [['g1', false, 'periodo'], ['g2', true, null]], 'data nova no caixa fechado da conta: fora, com o motivo');
eq(/fechado até/.test(r.corpo.itens[0].motivo), true, 'o motivo diz até quando está fechado');
g = await lote({ modo: 'gravar', acao: 'reagendar', nova_data: D(15), itens: prontas, assinatura: r.corpo.assinatura });
eq([g.status, (await titulo('contas_pagar', 'g2')).data_vencimento], [423, D(13)], 'gravar com a conta do caixa fechado: 423 e nada muda');
r = await lote({ modo: 'previa', acao: 'reagendar', nova_data: D(25), itens: prontas });
eq(r.corpo.prontos, 2, 'depois do fechamento, pode');
await query(`DELETE FROM periodos_fechados WHERE tenant_id = $1`, [T]);

// Limites de vencimento: só adiantar.
como(admin);
await RBL.PUT(req('/api/limites-e-aprovacao', 'PUT', { bloqueios: { vencimento: 'so_adiantar' }, alcadas: [] }));
como(sessao('OPERADOR'));
r = await lote({ modo: 'previa', acao: 'reagendar', dias: 3, itens: prontas });
eq([r.corpo.prontos, /só pode ser adiantado/.test(r.corpo.itens[0].motivo)], [0, true], 'limite "só adiantar": adiar fica de fora');
r = await lote({ modo: 'previa', acao: 'reagendar', dias: -3, itens: prontas });
eq(r.corpo.prontos, 2, 'adiantar pode');
como(admin);
r = await lote({ modo: 'previa', acao: 'reagendar', dias: 3, itens: prontas });
eq(r.corpo.prontos, 2, 'quem aprova exceções não precisa pedir');
await RBL.PUT(req('/api/limites-e-aprovacao', 'PUT', { bloqueios: {}, alcadas: [] }));

console.log('--- 7. Recategorizar ---');
como(sessao('OPERADOR'));
const itensC = [{ tabela: 'contas_pagar', id: 'g1' }, { tabela: 'contas_receber', id: 'r-aberta' }, { tabela: 'contas_pagar', id: 'p-parcial' }];
r = await lote({ modo: 'previa', acao: 'recategorizar', categoria_id: 'cat-anuncios', itens: itensC });
eq(r.corpo.itens.map(i => [i.id, i.ok]), [['g1', true], ['r-aberta', false], ['p-parcial', true]], 'categoria de despesa não vale para conta a receber');
eq(r.corpo.itens[1].motivo, 'A categoria escolhida é de despesa; esta é uma conta a receber.', 'diz por quê');
r = await lote({ modo: 'previa', acao: 'recategorizar', centro_custo_id: 'cc-rj', itens: [{ tabela: 'contas_pagar', id: 'g1' }, { tabela: 'contas_pagar', id: 'p-parcial' }] });
eq(r.corpo.itens.map(i => [i.id, i.ok]), [['g1', true], ['p-parcial', false]], 'conta com rateio entre centros muda na própria conta');
r = await lote({ modo: 'previa', acao: 'recategorizar', categoria_id: 'cat-anuncios', centro_custo_id: 'cc-rj', itens: [{ tabela: 'contas_pagar', id: 'g1' }] });
g = await lote({ modo: 'gravar', acao: 'recategorizar', categoria_id: 'cat-anuncios', centro_custo_id: 'cc-rj', itens: [{ tabela: 'contas_pagar', id: 'g1' }], assinatura: r.corpo.assinatura });
const g1 = await titulo('contas_pagar', 'g1');
eq([g.status, g1.categoria_id, g1.centro_custo_id, g1.centro_custo, g1.natureza_custo, g1.is_custo_comercial],
  [200, 'cat-anuncios', 'cc-rj', 'Loja RJ', 'VARIAVEL', true], 'gravou categoria e centro, e a natureza segue a categoria (como a tela de pagar)');
como(sessao('OPERADOR', 'u-op2'));
r = await lote({ modo: 'previa', acao: 'recategorizar', categoria_id: 'cat-aluguel', itens: [{ tabela: 'contas_pagar', id: 'p-paga-b2' }] });
eq([r.corpo.itens[0].ok, r.corpo.itens[0].tipo_motivo], [false, 'permissao'], 'conta já paga sem "alterar lançamento já baixado": fora');
r = await lote({ modo: 'previa', acao: 'recategorizar', categoria_id: 'cat-aluguel', itens: [{ tabela: 'contas_pagar', id: 'p-paga-b1' }] });
eq(r.corpo.itens[0].tipo_motivo, 'nao_encontrada', 'conta paga numa conta bancária não liberada: não existe para a pessoa');

console.log('--- 8. Excluir ---');
como(sessao('OPERADOR'));
eq((await lote({ modo: 'previa', acao: 'excluir', itens: [{ tabela: 'contas_pagar', id: 'g2' }] })).status, 403, 'operador não exclui (mesma regra do DELETE de hoje)');
como(admin);
await cp('e1', { status: 'PAGO', valor_final: 40, valor_pago: 40, data_pagamento: D(-1), data_vencimento: D(-1), conta_bancaria_id: 'b1' });
await cr('e2', { valor_final: 70, data_vencimento: D(9) });
const saldoB1 = await saldoDaConta('b1');
const itensE = [{ tabela: 'contas_pagar', id: 'e1' }, { tabela: 'contas_receber', id: 'e2' }];
await query(`INSERT INTO periodos_fechados (tenant_id, conta_bancaria_id, fechado_ate) VALUES ($1, '', $2)`, [T, D(-1)]);
r = await lote({ modo: 'previa', acao: 'excluir', itens: itensE });
eq(r.corpo.itens.map(i => [i.id, i.ok, i.tipo_motivo ?? null]), [['e1', false, 'periodo'], ['e2', true, null]], 'conta paga em data fechada: fora');
g = await lote({ modo: 'gravar', acao: 'excluir', itens: itensE, assinatura: r.corpo.assinatura });
eq([g.status, Boolean(await titulo('contas_receber', 'e2'))], [423, true], 'gravar com ela: 423 e nada sai');
await query(`DELETE FROM periodos_fechados WHERE tenant_id = $1`, [T]);
r = await lote({ modo: 'previa', acao: 'excluir', itens: itensE });
eq([r.corpo.prontos, /voltam para a conta bancária/.test(r.corpo.itens[0].aviso ?? '')], [2, true], 'prévia avisa que o pago volta para a conta');
g = await lote({ modo: 'gravar', acao: 'excluir', itens: itensE, assinatura: r.corpo.assinatura });
eq([g.status, (await query(`SELECT 1 FROM contas_pagar WHERE id = 'e1'`)).rows.length, (await query(`SELECT 1 FROM contas_receber WHERE id = 'e2'`)).rows.length],
  [200, 0, 0], 'excluiu as duas');
eq(await saldoDaConta('b1'), round2(saldoB1 + 40), 'o pago voltou para a conta que pagou (estorno de hoje)');
g = await lote({ modo: 'gravar', acao: 'excluir', itens: itensE, assinatura: r.corpo.assinatura });
eq([g.status, await saldoDaConta('b1')], [409, round2(saldoB1 + 40)], 'repetir não estorna de novo');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
