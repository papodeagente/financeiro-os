/**
 * Lista Contas a Pagar/Receber, fechamento de paridade (06/11/2026, E7),
 * contra um Postgres real (PGlite), chamando as ROTAS de produção.
 *
 * Prova:
 *  1. Nº DO TÍTULO: os títulos de antes ganham número uma vez só, em ordem de
 *     criação e únicos entre pagar e receber; quem cadastrou vem do registro
 *     de atividades. Título novo (por qualquer caminho) ganha o próximo, com
 *     quem cadastrou pelo contexto da requisição. Excluir não devolve o
 *     número; restaurar (a linha volta com o mesmo id) mantém o número.
 *     Rodar o esquema de novo não renumera nada.
 *  2. COLUNAS NOVAS: Moeda dos dois lados, Venda Nº e Vendedor (venda nova e
 *     venda antiga), Fatura Nº (fatura ao cliente, item de fatura, fatura do
 *     fornecedor), Cadastrado em/por, campos personalizados; busca por Nº e
 *     por Venda Nº; ordem por Nº.
 *  3. EXCLUÍDO: "Todas" não mostra excluídos; a situação Excluído mostra só
 *     eles, com quando/quem e o estornado; os totais não somam excluídos.
 *  4. PLANILHA com Nº, colunas novas e campos personalizados.
 *  5. PREFERÊNCIA por pessoa no servidor: isolada por usuário e por agência;
 *     chave e valor conferidos.
 *
 * Uso: node --no-warnings scripts/test-sql-contas-lista-e7.mjs
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
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, usuario_id TEXT NOT NULL DEFAULT '', acao TEXT NOT NULL,
    modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '', entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  -- Venda nova (vendas_modelo) e antiga (vendas_crm), como no sistema.
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '',
    vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE vendas_modelo (tenant_id TEXT NOT NULL, venda_id TEXT NOT NULL, numero TEXT NOT NULL DEFAULT '', vendedor JSONB,
    PRIMARY KEY (tenant_id, venda_id));
  CREATE TABLE faturas (tenant_id TEXT NOT NULL, id TEXT NOT NULL, numero INTEGER NOT NULL, titulo_id TEXT NOT NULL DEFAULT '',
    situacao TEXT NOT NULL DEFAULT 'ABERTA', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tenant_id, id));
  CREATE TABLE fatura_itens (tenant_id TEXT NOT NULL, conta_id TEXT NOT NULL, fatura_id TEXT NOT NULL, PRIMARY KEY (tenant_id, conta_id));
  CREATE TABLE faturas_fornecedor (tenant_id TEXT NOT NULL, id TEXT NOT NULL, numero TEXT NOT NULL, conta_pagar_id TEXT,
    situacao TEXT NOT NULL DEFAULT 'GERADA', criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tenant_id, id));
  CREATE TABLE fatura_fornecedor_itens (tenant_id TEXT NOT NULL, fatura_id TEXT NOT NULL, conta_pagar_id TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (tenant_id, fatura_id, conta_pagar_id));
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
process.env.JWT_SECRET = 'segredo-de-teste-lista-e7';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { NUMERACAO_TITULOS_SCHEMA_SQL } = await import('../src/lib/numeracao-titulos.ts');
const { PREFERENCIAS_USUARIO_SCHEMA_SQL } = await import('../src/lib/preferencias-usuario.ts');
const { CONTAS_EXCLUIDAS_SCHEMA_SQL } = await import('../src/lib/contas-excluidas-schema.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);

const P = await import('../src/lib/permissoes-servidor.ts');
const { hojeISO, addDias } = await import('../src/lib/money.ts');
const RL = await import('../src/app/api/contas-pagar-receber/route.ts');
const RPref = await import('../src/app/api/preferencias/route.ts');

const T = 'ag-1';
const T2 = 'ag-2';
const sessao = (perfil, userId = `u-${perfil}`, tenant = T) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const lista = async (params = {}) => json(await RL.GET(req(`/api/contas-pagar-receber?${new URLSearchParams({ por_pagina: '500', situacao: 'todas', ...params })}`)));
const porId = linhas => Object.fromEntries(linhas.map(l => [l.id, l]));
const HOJE = hojeISO();
const D = n => addDias(HOJE, n);

for (const [id, perfil, nome] of [['u-ADMIN', 'ADMIN', 'Admin'], ['u-OPERADOR', 'OPERADOR', 'Olga Operadora'], ['u-vend', 'VENDEDOR', 'Vítor Vendedor']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, nome, data) VALUES ($1, $2, $3, $4)`, [id, T, nome, JSON.stringify({ id, nome, perfil, ativo: true })]);
}
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1', $1, '{"id":"b1","nome":"Inter","saldo_atual":0}')`, [T]);

const cp = (id, data, t = T, criado = null) => query(
  `INSERT INTO contas_pagar (id, tenant_id, status, data, created_at) VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, NOW()))`,
  [id, t, data.status ?? 'PENDENTE', JSON.stringify({ id, fornecedor_nome: 'Operadora X', descricao: `Conta ${id}`, status: 'PENDENTE', ...data }), criado]);
const cr = (id, data, t = T, criado = null) => query(
  `INSERT INTO contas_receber (id, tenant_id, status, data, created_at) VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, NOW()))`,
  [id, t, data.status ?? 'PENDENTE', JSON.stringify({ id, cliente_nome: 'Ana', descricao: `Conta ${id}`, status: 'PENDENTE', ...data }), criado]);

// ---------------------------------------------------------------------------
console.log('--- 1. Nº do título ---');
// Títulos de ANTES do esquema, criados em horas diferentes e misturados.
await cr('r-velha', { valor_final: 100, data_vencimento: D(1) }, T, '2026-01-01T10:00:00Z');
await cp('p-velha', { valor_final: 50, data_vencimento: D(2) }, T, '2026-01-02T10:00:00Z');
await cr('r-media', { valor_final: 70, data_vencimento: D(3) }, T, '2026-01-03T10:00:00Z');
await cp('x-velha', { valor_final: 9, data_vencimento: D(1) }, T2, '2026-01-01T09:00:00Z');
// O registro de atividades sabe quem criou a r-velha.
await query(`INSERT INTO audit_log (id, tenant_id, usuario_id, acao, entidade, entidade_id, data, created_at)
             VALUES ('a1', $1, 'u-OPERADOR', 'CRIAR', 'contas_receber', 'r-velha', '{"usuario_nome":"Olga Operadora"}', '2026-01-01T10:00:01Z')`, [T]);

await pg.exec(NUMERACAO_TITULOS_SCHEMA_SQL);
await pg.exec(PREFERENCIAS_USUARIO_SCHEMA_SQL);
await pg.exec(CONTAS_EXCLUIDAS_SCHEMA_SQL);
const numeros = async t => Object.fromEntries((await query(`SELECT id, numero::int AS n FROM titulos_numeros WHERE tenant_id = $1 ORDER BY numero`, [t])).rows.map(r => [r.id, r.n]));
eq(await numeros(T), { 'r-velha': 1, 'p-velha': 2, 'r-media': 3 }, 'os de antes numerados por ordem de criação, pagar e receber na mesma sequência');
eq(await numeros(T2), { 'x-velha': 1 }, 'cada agência tem a própria sequência');
eq((await um(`SELECT cadastrado_por_nome FROM titulos_numeros WHERE id = 'r-velha'`)).cadastrado_por_nome, 'Olga Operadora', 'quem cadastrou veio do registro de atividades');

// Título novo: o gatilho dá o próximo número e lê quem está na requisição.
await query(`BEGIN`);
await query(`SELECT set_config('app.audit_context', $1, true)`, [JSON.stringify({ userId: 'u-ADMIN', userName: 'Admin' })]);
await cp('p-nova', { valor_final: 30, data_vencimento: D(4), moeda: 'USD' });
await query(`COMMIT`);
await cr('r-nova', { valor_final: 40, data_vencimento: D(5) });
eq((await numeros(T))['p-nova'], 4, 'título novo ganha o próximo número');
eq((await numeros(T))['r-nova'], 5, 'e o seguinte, do outro lado');
eq((await um(`SELECT cadastrado_por, cadastrado_por_nome FROM titulos_numeros WHERE id = 'p-nova'`)), { cadastrado_por: 'u-ADMIN', cadastrado_por_nome: 'Admin' }, 'cadastrado por quem estava na requisição');
eq((await um(`SELECT cadastrado_por_nome FROM titulos_numeros WHERE id = 'r-nova'`)).cadastrado_por_nome, '', 'sem requisição: sistema (vazio)');

// Excluir: a linha sai da tabela e vai para a guarda; o número não volta.
const linha = (await um(`SELECT to_jsonb(t) AS l, data FROM contas_receber t WHERE id = 'r-media'`));
await query(`DELETE FROM contas_receber WHERE id = 'r-media'`);
await query(`INSERT INTO contas_excluidas (tenant_id, tabela, id, linha, data, baixa_estornada, excluido_por_nome) VALUES ($1, 'contas_receber', 'r-media', $2, $3, $4, 'Admin')`,
  [T, JSON.stringify(linha.l), JSON.stringify(linha.data), JSON.stringify({ valor: 12.5, conta_bancaria_id: 'b1' })]);
await cp('p-depois', { valor_final: 10, data_vencimento: D(6) });
eq((await numeros(T))['p-depois'], 6, 'depois de excluir, o próximo NÃO reaproveita o número do excluído');
eq((await numeros(T))['r-media'], 3, 'o excluído continua com o número dele');
// Restaurar: a linha volta inteira, com o mesmo id.
await query(`INSERT INTO contas_receber SELECT (jsonb_populate_record(NULL::contas_receber, linha)).* FROM contas_excluidas WHERE id = 'r-media'`);
eq((await numeros(T))['r-media'], 3, 'restaurado volta com o mesmo número');
eq((await um(`SELECT ultimo::int AS u FROM titulos_numeracao WHERE tenant_id = $1`, [T])).u, 6, 'restaurar não gasta número');
await query(`DELETE FROM contas_receber WHERE id = 'r-media'`); // volta a ficar só na guarda
// Rodar o esquema de novo (outra réplica subindo): nada muda, gatilho não duplica.
await pg.exec(NUMERACAO_TITULOS_SCHEMA_SQL);
eq(await numeros(T), { 'r-velha': 1, 'p-velha': 2, 'r-media': 3, 'p-nova': 4, 'r-nova': 5, 'p-depois': 6 }, 'esquema de novo não renumera');
eq(Number((await um(`SELECT COUNT(*) AS n FROM pg_trigger WHERE tgname = 'fin_numerar_titulo_v1'`)).n), 2, 'um gatilho por tabela');
await cr('r-mais', { valor_final: 1, data_vencimento: D(7) });
eq((await numeros(T))['r-mais'], 7, 'depois de rodar o esquema de novo, segue a sequência');

// ---------------------------------------------------------------------------
console.log('--- 2. Colunas novas ---');
// Venda nova (vendas_modelo) com vendedor; venda antiga (vendas_crm) com vendedor_id.
await query(`INSERT INTO vendas_modelo (tenant_id, venda_id, numero, vendedor) VALUES ($1, 'v-nova', '1203', '{"id":"u-vend","nome":"Vítor Vendedor"}')`, [T]);
await query(`INSERT INTO vendas_crm (id, tenant_id, vendedor_id, data) VALUES ('v-antiga', $1, 'u-vend', '{"numero":"88"}')`, [T]);
await cr('r-venda', { valor_final: 500, data_vencimento: D(8), origem_venda_id: 'v-nova', auto_gerado: true, moeda: 'EUR' });
await cr('r-venda-antiga', { valor_final: 600, data_vencimento: D(8), venda_id: 'v-antiga' });
// Fatura ao cliente: a conta da fatura e uma conta que é item dela.
await query(`INSERT INTO faturas (tenant_id, id, numero, titulo_id) VALUES ($1, 'f1', 41, 'r-nova')`, [T]);
await query(`INSERT INTO fatura_itens (tenant_id, conta_id, fatura_id) VALUES ($1, 'r-velha', 'f1')`, [T]);
// Fatura do fornecedor: só pelo item ativo.
await query(`INSERT INTO faturas_fornecedor (tenant_id, id, numero, conta_pagar_id) VALUES ($1, 'ff1', 'FF-7', 'p-depois')`, [T]);
await query(`INSERT INTO fatura_fornecedor_itens (tenant_id, fatura_id, conta_pagar_id, ativo) VALUES ($1, 'ff1', 'p-velha', true), ($1, 'ff1', 'p-nova', false)`, [T]);
// Campo personalizado gravado no título.
await query(`UPDATE contas_pagar SET data = data || '{"campos_personalizados":{"proj":"Expo Lisboa","ok":true}}' WHERE id = 'p-velha'`);

como(sessao('ADMIN'));
let r = await lista();
eq(r.status, 200, 'lista responde');
let l = porId(r.corpo.linhas);
eq(Object.keys(l).sort(), ['p-depois', 'p-nova', 'p-velha', 'r-mais', 'r-nova', 'r-velha', 'r-venda', 'r-venda-antiga'], '"Todas" não traz o excluído');
eq([l['r-velha'].numero, l['p-velha'].numero, l['p-nova'].numero], [1, 2, 4], 'Nº em cada linha');
eq([l['p-nova'].moeda, l['r-venda'].moeda, l['r-velha'].moeda], ['USD', 'EUR', 'BRL'], 'Moeda nos dois lados (sem moeda = real)');
eq([l['r-venda'].venda_numero, l['r-venda'].vendedor, l['r-venda'].venda_id], ['1203', 'Vítor Vendedor', 'v-nova'], 'venda nova: Nº e vendedor');
eq([l['r-venda-antiga'].venda_numero, l['r-venda-antiga'].vendedor], ['88', 'Vítor Vendedor'], 'venda antiga: Nº e vendedor pelo cadastro da equipe');
eq([l['r-nova'].fatura_numero, l['r-velha'].fatura_numero], ['41', '41'], 'Fatura Nº: a conta da fatura e o item dela');
eq([l['p-depois'].fatura_numero, l['p-velha'].fatura_numero, l['p-nova'].fatura_numero], ['FF-7', 'FF-7', ''], 'fatura do fornecedor (item desfeito não conta)');
eq([l['p-nova'].cadastrado_por, l['r-velha'].cadastrado_por, l['r-mais'].cadastrado_por], ['Admin', 'Olga Operadora', ''], 'Cadastrado por');
eq(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(l['r-velha'].cadastrado_em) && l['r-velha'].cadastrado_em.startsWith('2026-01-01T07:00'), true, 'Cadastrado em, no horário de Brasília');
eq(l['p-velha'].campos_personalizados, { ok: true, proj: 'Expo Lisboa' }, 'campos personalizados chegam na linha');
r = await lista({ ordem: 'numero', direcao: 'desc' });
eq(r.corpo.linhas.map(x => x.numero), [9, 8, 7, 6, 5, 4, 2, 1], 'ordem por Nº');
r = await lista({ busca: '1203', em: 'venda' });
eq(r.corpo.linhas.map(x => x.id), ['r-venda'], 'pesquisar em Venda Nº');
r = await lista({ busca: '4', em: 'numero' });
eq(r.corpo.linhas.map(x => x.id), ['p-nova'], 'pesquisar em Nº');

// ---------------------------------------------------------------------------
console.log('--- 3. Excluído ---');
r = await lista({ situacao: 'excluido' });
eq(r.corpo.linhas.map(x => [x.id, x.situacao, x.numero, x.excluido_por, x.estornado_na_exclusao]), [['r-media', 'excluido', 3, 'Admin', 12.5]], 'situação Excluído mostra só os excluídos, com Nº, quem excluiu e o estornado');
eq(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.corpo.linhas[0].excluido_em), true, 'quando foi excluída');
eq([r.corpo.totais.receber.valor, r.corpo.totais.receber.aberto, r.corpo.totais.excluidas], [0, 0, 1], 'excluídos não entram nos totais');
eq(r.corpo.linhas[0].saldo, 0, 'excluído sem saldo em aberto');
r = await lista({ situacao: 'em_aberto' });
eq(r.corpo.linhas.some(x => x.id === 'r-media'), false, '"Em aberto" não traz excluído');
como(sessao('ADMIN', 'u-ADMIN', T2));
r = await lista({ situacao: 'excluido' });
eq(r.corpo.linhas.length, 0, 'excluído de outra agência não aparece');
como(sessao('ADMIN'));

// ---------------------------------------------------------------------------
console.log('--- 4. Planilha ---');
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, $2)`, [T, JSON.stringify({ campos_personalizados_titulos: [
  { id: 'proj', nome: 'Projeto', tipo: 'texto', ativo: true, aplica_a: 'ambos' },
  { id: 'ok', nome: 'Conferido', tipo: 'sim_nao', ativo: true, aplica_a: 'pagar' },
  { id: 'velho', nome: 'Desligado', tipo: 'texto', ativo: false },
] })]);
const resp = await RL.GET(req(`/api/contas-pagar-receber?${new URLSearchParams({ situacao: 'todas', ordem: 'numero' })}&format=csv`));
const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(await resp.arrayBuffer()));
const [cab, primeira, segunda] = csv.replace(/^\uFEFF/, '').split('\r\n');
eq(resp.status, 200, 'planilha sai');
eq(cab.split(';').slice(0, 2), ['"Nº"', '"Tipo"'], 'planilha começa pelo Nº');
eq(['"Moeda"', '"Venda Nº"', '"Fatura Nº"', '"Vendedor"', '"Cadastrado em"', '"Cadastrado por"', '"Projeto"', '"Conferido"'].every(c => cab.includes(c)), true, 'colunas novas e campos ativos na planilha');
eq(cab.includes('Desligado'), false, 'campo desligado fica de fora');
eq([primeira.startsWith('"1";'), primeira.includes('"Olga Operadora"')], [true, true], 'linha 1 com Nº e quem cadastrou');
eq([segunda.includes('"Expo Lisboa"'), segunda.endsWith('"Sim"')], [true, true], 'valores dos campos personalizados por extenso');

// ---------------------------------------------------------------------------
console.log('--- 5. Preferência por pessoa ---');
const PREF = 'contas-pagar-receber.colunas';
const lerPref = async () => json(await RPref.GET(req(`/api/preferencias?chave=${PREF}`)));
const gravarPref = async (valor, chave = PREF) => json(await RPref.PUT(req('/api/preferencias', 'PUT', { chave, valor })));
como(null);
eq((await lerPref()).status, 401, 'sem sessão: 401');
como(sessao('OPERADOR'));
eq((await lerPref()).corpo, { chave: PREF, valor: null }, 'nunca escolheu: valor null');
eq((await gravarPref(['numero', 'pessoa', 'valor', 'acoes'])).corpo, { ok: true }, 'grava a escolha');
eq((await lerPref()).corpo.valor, ['numero', 'pessoa', 'valor', 'acoes'], 'lê a própria escolha');
await gravarPref(['pessoa', 'valor', 'acoes']);
eq((await lerPref()).corpo.valor, ['pessoa', 'valor', 'acoes'], 'regravar substitui');
como(sessao('ADMIN'));
eq((await lerPref()).corpo.valor, null, 'outra pessoa da mesma agência não vê a escolha dela');
como(sessao('OPERADOR', 'u-OPERADOR', T2));
eq((await lerPref()).corpo.valor, null, 'a mesma pessoa em outra agência começa do zero');
como(sessao('OPERADOR'));
eq((await gravarPref(['x'], 'Chave Ruim!')).status, 400, 'chave fora do formato: 400');
eq((await gravarPref('x'.repeat(9000))).status, 400, 'preferência grande demais: 400');
eq((await json(await RPref.PUT(req('/api/preferencias', 'PUT', { chave: PREF })))).status, 400, 'sem valor: 400');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
