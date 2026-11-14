/**
 * Lançamento (E7, frente D, 06/11/2026) contra um Postgres real (PGlite),
 * chamando as ROTAS de produção:
 *  1. ITENS — a conta da venda mostra os produtos dela (os do fornecedor da
 *     conta, ou todos na conta do cliente); fatura ao cliente e fatura do
 *     fornecedor mostram os itens; conta lançada à mão não tem itens.
 *  2. COMISSÕES — as da venda da conta, conforme o direito: administrador vê
 *     tudo; quem não vê o ganho da agência nem a equipe vê só a própria e o
 *     aviso de que há mais.
 *  3. ANEXO LIVRE — qualquer tipo aceito, conferido pelo CONTEÚDO (um .pdf
 *     que é texto é recusado), tamanho máximo, até 20; a conta da venda
 *     também aceita; tirar um anexo; a versão da conta muda (a tela atualiza).
 *  4. RATEIO SALVO APLICADO SOZINHO — a regra com gatilho é gravada e lida;
 *     a escolha da regra pela categoria e pela pessoa.
 *  5. SUGESTÃO DE CATEGORIA — pelo histórico do fornecedor (pagar) e do
 *     cliente (receber), sem categoria do tipo errado nem desativada.
 *  6. RECEBER EM MOEDA COM "REPETIR" — a série nasce na moeda, com o valor em
 *     reais pelo câmbio do lançamento; campos personalizados e conta prevista
 *     vão junto; moeda não cadastrada é recusada.
 *
 * Uso: node --no-warnings scripts/test-sql-lancamento-e7d.mjs
 */
import { register } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT DEFAULT '', vendedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', vendedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE venda_produtos (tenant_id TEXT NOT NULL, venda_id TEXT NOT NULL, id TEXT NOT NULL, sequencia INTEGER NOT NULL DEFAULT 1,
    tipo TEXT NOT NULL DEFAULT 'OUTROS', descricao TEXT NOT NULL DEFAULT '', fornecedor_nome TEXT NOT NULL DEFAULT '', fornecedor_externo TEXT NOT NULL DEFAULT '',
    moeda TEXT NOT NULL DEFAULT 'BRL', localizador TEXT NOT NULL DEFAULT '', data_inicio DATE, data_fim DATE, quantidade INTEGER NOT NULL DEFAULT 1,
    valor_unitario_centavos BIGINT NOT NULL DEFAULT 0, taxas_centavos BIGINT NOT NULL DEFAULT 0, cancelado_em DATE, PRIMARY KEY (tenant_id, id));
  CREATE TABLE fatura_itens (tenant_id TEXT NOT NULL, conta_id TEXT NOT NULL, fatura_id TEXT NOT NULL, venda_id TEXT NOT NULL DEFAULT '',
    venda_numero TEXT NOT NULL DEFAULT '', data_venda DATE, descricao TEXT NOT NULL DEFAULT '', valor_centavos BIGINT NOT NULL DEFAULT 0,
    taxas_servico_centavos BIGINT NOT NULL DEFAULT 0);
  CREATE TABLE fatura_fornecedor_itens (tenant_id TEXT NOT NULL, fatura_id TEXT NOT NULL, conta_pagar_id TEXT NOT NULL, venda_id TEXT NOT NULL,
    venda_numero TEXT NOT NULL DEFAULT '', valor_centavos BIGINT NOT NULL, moeda TEXT NOT NULL DEFAULT 'BRL', valor_moeda_centavos BIGINT NOT NULL DEFAULT 0,
    descricao TEXT NOT NULL DEFAULT '', ativo BOOLEAN NOT NULL DEFAULT TRUE);
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
process.env.JWT_SECRET = 'segredo-de-teste-lancamento-e7d';
// Os anexos vão para uma pasta temporária, nunca para a cópia de trabalho.
process.chdir(await mkdtemp(path.join(tmpdir(), 'anexos-e7d-')));

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RECORRENCIA_SCHEMA_SQL } = await import('../src/lib/recorrencia-schema.ts');
const { CENTROS_CUSTO_SCHEMA_SQL, salvarRegra, listarRegras } = await import('../src/lib/centros-custo-servidor.ts');
const { CAMBIO_SCHEMA_SQL } = await import('../src/lib/cambio-servidor.ts');
const { MOEDAS_SCHEMA_SQL } = await import('../src/lib/moedas-servidor.ts');
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(RECORRENCIA_SCHEMA_SQL);
await pg.exec(CENTROS_CUSTO_SCHEMA_SQL);
await pg.exec(CAMBIO_SCHEMA_SQL);
await pg.exec(MOEDAS_SCHEMA_SQL);
const P = await import('../src/lib/permissoes-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { regraQueSeAplicaSozinha } = await import('../src/lib/dimensoes.ts');
const ROR = await import('../src/app/api/titulos/[tabela]/[id]/origem/route.ts');
const RAN = await import('../src/app/api/titulos/[tabela]/[id]/anexos/route.ts');
const RSU = await import('../src/app/api/sugestao-categoria/route.ts');
const RRE = await import('../src/app/api/recorrencias/route.ts');
const RMO = await import('../src/app/api/moedas/route.ts');

const T = 'ag-1';
const sessao = (perfil, userId = `u-${perfil}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const ctx = obj => ({ params: Promise.resolve(obj) });
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];

for (const [id, perfil] of [['u-ADMIN', 'ADMIN'], ['u-VENDEDOR', 'VENDEDOR'], ['u-OPERADOR', 'OPERADOR']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, T, JSON.stringify({ id, nome: id, perfil, ativo: true })]);
}
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, '{}')`, [T]);

// Venda v1 com dois produtos de dois fornecedores, comissão do vendedor e do outro vendedor.
await query(`INSERT INTO vendas_crm (id, tenant_id, data) VALUES ('v1', $1, '{"id":"v1","numero":"V-1"}')`, [T]);
await query(`INSERT INTO venda_produtos (tenant_id, venda_id, id, sequencia, tipo, descricao, fornecedor_nome, localizador, data_inicio, data_fim, quantidade, valor_unitario_centavos, taxas_centavos)
  VALUES ($1, 'v1', 'p1', 1, 'HOTEL', 'Hotel em Gramado', 'Hotel Serra', 'ABC123', '2026-12-20', '2026-12-23', 2, 50000, 1000),
         ($1, 'v1', 'p2', 2, 'AEREO', 'Aéreo São Paulo – Porto Alegre', 'Cia Aérea', 'XYZ999', '2026-12-20', NULL, 1, 80000, 0)`, [T]);
await query(`INSERT INTO comissoes (id, tenant_id, venda_id, vendedor_id, status, data) VALUES
  ('c1', $1, 'v1', 'u-VENDEDOR', 'PENDENTE', '{"vendedor_id":"u-VENDEDOR","vendedor_nome":"Vendedor","plano_nome":"Padrão","valor_comissao":90,"percentual_aplicado":5,"valor_base":1800,"status":"PENDENTE"}'),
  ('c2', $1, 'v1', 'u-OUTRO', 'PENDENTE', '{"vendedor_id":"u-OUTRO","vendedor_nome":"Outro","valor_comissao":30,"status":"PENDENTE"}')`, [T]);
const pagar = (id, data) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1, $2, $3, $4)`, [id, T, data.status ?? 'PENDENTE', JSON.stringify({ id, ...data })]);
const receber = (id, data) => query(`INSERT INTO contas_receber (id, tenant_id, status, venda_id, data) VALUES ($1, $2, $3, $4, $5)`, [id, T, data.status ?? 'PENDENTE', data.venda_id ?? '', JSON.stringify({ id, ...data })]);
await pagar('cpH', { origem_venda_id: 'v1', venda_produtos: ['p1'], fornecedor_nome: 'Hotel Serra', valor_final: 1010, descricao: 'Venda V-1 - Hotel' });
await receber('crV', { venda_id: 'v1', origem_venda_id: 'v1', cliente_nome: 'Ana', valor_final: 1810, descricao: 'Venda V-1' });
await receber('crCF', { venda_id: 'v1', origem: 'COMISSAO_FORNECEDOR', fornecedor_nome: 'Hotel Serra', valor_final: 100, descricao: 'Comissão a receber - Hotel Serra' });
await query(`INSERT INTO fatura_itens (tenant_id, conta_id, fatura_id, venda_numero, data_venda, descricao, valor_centavos, taxas_servico_centavos) VALUES
  ($1, 'x1', 'f1', 'V-7', '2026-11-02', 'Passagem do diretor', 120000, 3000)`, [T]);
await receber('crF', { fatura_id: 'f1', fatura_numero: '12', origem: 'FATURA', cliente_nome: 'Empresa X', valor_final: 1230, descricao: 'Fatura 12' });
await query(`INSERT INTO fatura_fornecedor_itens (tenant_id, fatura_id, conta_pagar_id, venda_id, venda_numero, valor_centavos, descricao) VALUES
  ($1, 'ff1', 'cpA', 'v1', 'V-1', 101000, 'Hotel em Gramado'), ($1, 'ff1', 'cpB', 'v2', 'V-2', 5000, 'Desfeito'), ($1, 'ff2', 'cpC', 'v3', 'V-3', 1, 'Outra')`, [T]);
await query(`UPDATE fatura_fornecedor_itens SET ativo = FALSE WHERE conta_pagar_id = 'cpB'`);
await pagar('cpFF', { fatura_fornecedor_id: 'ff1', fatura_fornecedor_numero: 'FF-0001', fornecedor_nome: 'Hotel Serra', valor_final: 1010, descricao: 'Fatura FF-0001' });
await pagar('cpM', { fornecedor_nome: 'Imobiliária Centro', valor_final: 3000, descricao: 'Aluguel', categoria_id: 'cat-aluguel' });

const origem = async (tab, id) => json(await ROR.GET(req(`/x`), ctx({ tabela: tab, id })));

// ---------------------------------------------------------------------------
console.log('--- 1. Itens ---');
como(sessao('ADMIN'));
let r = await origem('pagar', 'cpH');
eq([r.status, r.corpo.origem.tipo, r.corpo.itens.map(i => [i.descricao, i.quantidade, i.valor])], [200, 'venda', [['Hotel em Gramado', 2, 1010]]],
  'conta do fornecedor: só o produto dela (2 diárias + taxas)');
eq(r.corpo.itens[0].detalhe, 'Hotel Serra · Localizador ABC123 · 20/12/2026 a 23/12/2026', 'fornecedor, localizador e período por extenso');
r = await origem('receber', 'crV');
eq(r.corpo.itens.map(i => i.descricao), ['Hotel em Gramado', 'Aéreo São Paulo – Porto Alegre'], 'conta do cliente: todos os produtos da venda');
r = await origem('receber', 'crF');
eq([r.corpo.origem.rotulo, r.corpo.itens.map(i => [i.descricao, i.valor, i.detalhe])], ['Fatura 12', [['Passagem do diretor', 1230, 'Venda V-7 · 02/11/2026']]], 'fatura ao cliente: os itens dela');
r = await origem('pagar', 'cpFF');
eq(r.corpo.itens.map(i => [i.descricao, i.valor]), [['Hotel em Gramado', 1010]], 'fatura do fornecedor: só os itens ativos dela');
r = await origem('pagar', 'cpM');
eq([r.corpo.origem.tipo, r.corpo.itens, r.corpo.comissoes], ['manual', [], []], 'lançada à mão: sem itens nem comissões');
eq((await origem('pagar', 'nao-existe')).status, 404, 'conta que não existe: 404');
eq((await origem('outra', 'cpM')).status, 400, 'tabela inválida: 400');

// ---------------------------------------------------------------------------
console.log('--- 2. Comissões ---');
r = await origem('receber', 'crV');
eq([r.corpo.comissoes.map(c => [c.quem, c.valor]), r.corpo.comissoes_ocultas],
  [[['Hotel Serra', 100], ['Vendedor', 90], ['Outro', 30]], false], 'administrador: comissão de fornecedor e da equipe');
eq(r.corpo.comissoes[1].descricao.replace(/\s/g, ' '), 'Padrão · 5% de R$ 1.800,00', 'a regra da comissão por extenso');
como(sessao('VENDEDOR', 'u-VENDEDOR'));
eq((await origem('receber', 'crV')).status, 403, 'quem não vê o financeiro: não abre');
como(sessao('ADMIN'));
const { origemDoTitulo } = await import('../src/lib/titulo-origem-servidor.ts');
const dadosCrV = (await um(`SELECT data FROM contas_receber WHERE id = 'crV'`)).data;
let so = await origemDoTitulo(pool, T, 'contas_receber', dadosCrV, { verGanho: false, verEquipe: false, verPropria: true, usuarioId: 'u-VENDEDOR' });
eq([so.comissoes.map(c => c.quem), so.comissoes_ocultas], [['Vendedor'], true], 'só a própria comissão: a dela, com o aviso de que há mais');
so = await origemDoTitulo(pool, T, 'contas_receber', dadosCrV, { verGanho: true, verEquipe: false, verPropria: false, usuarioId: 'u-X' });
eq([so.comissoes.map(c => c.quem), so.comissoes_ocultas], [['Hotel Serra'], true], 'só o ganho da agência: a comissão do fornecedor, sem a da equipe');

// ---------------------------------------------------------------------------
console.log('--- 3. Anexo livre ---');
const enviar = async (tab, id, nome, bytes) => {
  const f = new FormData();
  f.append('arquivo', new File([bytes], nome));
  return json(await RAN.POST(new Request('http://localhost/x', { method: 'POST', body: f }), ctx({ tabela: tab, id })));
};
const PDF = new TextEncoder().encode('%PDF-1.4\n%fake\n');
const CSV = new TextEncoder().encode('data;valor\n2026-11-06;10,00\n');
const versaoAntes = (await um(`SELECT (FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000000))::bigint::text AS v FROM contas_pagar WHERE id = 'cpM'`)).v;
r = await enviar('pagar', 'cpM', 'contrato de aluguel.pdf', PDF);
eq([r.status, r.corpo.anexos.length, r.corpo.anexos[0].nome, /^\/api\/comprovantes\/anexo-[\w-]+\.pdf$/.test(r.corpo.anexos[0].url)], [201, 1, 'contrato de aluguel.pdf', true], 'PDF anexado na pasta privada');
eq(r.corpo._versao !== versaoAntes && /^\d+$/.test(r.corpo._versao), true, 'a versão da conta muda (a tela atualiza o que tem em mãos)');
r = await enviar('pagar', 'cpM', 'planilha.csv', CSV);
eq([r.status, r.corpo.anexos.map(a => a.nome)], [201, ['contrato de aluguel.pdf', 'planilha.csv']], 'CSV também (qualquer tipo aceito)');
r = await enviar('pagar', 'cpM', 'falso.pdf', new TextEncoder().encode('não sou pdf'));
eq([r.status, /Tipo de arquivo não aceito/.test(r.corpo.error)], [400, true], 'nome .pdf com conteúdo de texto: recusado pelo conteúdo');
r = await enviar('pagar', 'cpM', 'programa.exe', new Uint8Array([0x4d, 0x5a, 0x90, 0x00]));
eq(r.status, 400, 'executável: recusado');
r = await enviar('pagar', 'cpM', 'grande.pdf', new Uint8Array(15 * 1024 * 1024 + 10).fill(0x25));
eq(r.status === 400 || r.status === 413, true, 'acima de 15 MB: recusado');
r = await enviar('pagar', 'cpH', 'voucher.pdf', PDF);
eq(r.status, 201, 'conta nascida da venda também aceita anexo');
const anexos = (await um(`SELECT data->'anexos' AS a FROM contas_pagar WHERE id = 'cpM'`)).a;
r = await json(await RAN.DELETE(req(`/x?url=${encodeURIComponent(anexos[1].url)}`, 'DELETE'), ctx({ tabela: 'pagar', id: 'cpM' })));
eq([r.status, r.corpo.anexos.map(a => a.nome)], [200, ['contrato de aluguel.pdf']], 'tirar um anexo');
await query(`UPDATE contas_pagar SET data = jsonb_set(data, '{comprovante}', to_jsonb($1::text)) WHERE id = 'cpM'`, [anexos[0].url]);
eq((await json(await RAN.DELETE(req(`/x?url=${encodeURIComponent(anexos[0].url)}`, 'DELETE'), ctx({ tabela: 'pagar', id: 'cpM' })))).status, 409, 'o comprovante da baixa não sai por aqui');
r = await origem('pagar', 'cpM');
eq(r.corpo.anexos.length, 1, 'a aba Anexos lê a lista da conta');
como(sessao('VENDEDOR', 'u-VENDEDOR'));
eq((await enviar('pagar', 'cpM', 'x.pdf', PDF)).status, 403, 'sem lançar no financeiro: não anexa');
como(sessao('ADMIN'));
for (let i = 0; i < 19; i++) await enviar('receber', 'crV', `doc-${i}.pdf`, PDF);
eq((await enviar('receber', 'crV', 'doc-20.pdf', PDF)).status, 201, 'vigésimo anexo: aceito');
r = await enviar('receber', 'crV', 'doc-21.pdf', PDF);
eq([r.status, /já tem 20 anexos/.test(r.corpo.error)], [400, true], 'vigésimo primeiro: recusado');

// ---------------------------------------------------------------------------
console.log('--- 4. Rateio salvo aplicado sozinho ---');
await query(`INSERT INTO centros_custo (id, tenant_id, nome, data) VALUES ('sp', $1, 'SP', '{"id":"sp","nome":"SP","ativo":true}'), ('rj', $1, 'RJ', '{"id":"rj","nome":"RJ","ativo":true}')`, [T]);
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, tipo, data) VALUES
  ('cat-aluguel', $1, '2.2.01', 'DESPESA', '{"id":"cat-aluguel","codigo":"2.2.01","nome":"Aluguel","tipo":"DESPESA"}'),
  ('cat-luz', $1, '2.2.02', 'DESPESA', '{"id":"cat-luz","codigo":"2.2.02","nome":"Energia","tipo":"DESPESA"}'),
  ('cat-velha', $1, '2.2.09', 'DESPESA', '{"id":"cat-velha","codigo":"2.2.09","nome":"Velha","tipo":"DESPESA","ativo":false}'),
  ('cat-venda', $1, '1.1', 'RECEITA', '{"id":"cat-venda","codigo":"1.1","nome":"Vendas","tipo":"RECEITA"}'),
  ('cat-fee', $1, '1.3', 'RECEITA', '{"id":"cat-fee","codigo":"1.3","nome":"Fee","tipo":"RECEITA"}')`, [T]);
const linhas = [{ centro_custo_id: 'sp', percentual: 60 }, { centro_custo_id: 'rj', percentual: 40 }];
await emTransacao(e => salvarRegra(e, T, { id: 'rr1', nome: 'Aluguel das lojas', linhas, aplicar_quando: { categoria_id: 'cat-aluguel' } }));
await emTransacao(e => salvarRegra(e, T, { id: 'rr2', nome: 'Imobiliária', linhas, aplicar_quando: { pessoa: '  Imobiliária   Centro ' } }));
await emTransacao(e => salvarRegra(e, T, { id: 'rr3', nome: 'Manual', linhas }));
let erro = null;
try { await emTransacao(e => salvarRegra(e, T, { id: 'rr4', nome: 'X', linhas, aplicar_quando: { categoria_id: 'nao-existe' } })); } catch (e) { erro = e.message; }
eq(/não existe nesta agência/.test(erro ?? ''), true, 'gatilho com categoria de fora: recusado');
const regras = await listarRegras(pool, T);
eq(regras.map(x => [x.id, x.aplicar_quando ?? null]), [['rr1', { categoria_id: 'cat-aluguel' }], ['rr2', { pessoa: 'Imobiliária Centro' }], ['rr3', null]], 'gatilhos gravados e lidos (limpos)');
eq([regraQueSeAplicaSozinha(regras, { categoria_id: 'cat-aluguel' })?.id, regraQueSeAplicaSozinha(regras, { pessoa: 'imobiliaria centro' })?.id,
  regraQueSeAplicaSozinha(regras, { categoria_id: 'cat-aluguel', pessoa: 'Imobiliária Centro' })?.id, regraQueSeAplicaSozinha(regras, { categoria_id: 'cat-luz' })],
['rr1', 'rr2', 'rr2', null], 'escolhe pela categoria, pela pessoa (sem acento e maiúscula) e a pessoa vence a categoria; sem gatilho, nada');

// ---------------------------------------------------------------------------
console.log('--- 5. Sugestão de categoria ---');
await pagar('cpH1', { fornecedor_id: 'fx', fornecedor_nome: 'Imobiliária Centro', categoria_id: 'cat-aluguel', valor_final: 1 });
await pagar('cpH2', { fornecedor_nome: 'IMOBILIÁRIA CENTRO', categoria_id: 'cat-aluguel', valor_final: 1 });
await pagar('cpH3', { fornecedor_nome: 'Imobiliária Centro', categoria_id: 'cat-luz', valor_final: 1 });
await pagar('cpH4', { fornecedor_nome: 'Imobiliária Centro', categoria_id: 'cat-velha', valor_final: 1 });
await pagar('cpH5', { fornecedor_nome: 'Imobiliária Centro', categoria_id: 'cat-venda', valor_final: 1 });
await pagar('cpH6', { fornecedor_nome: 'Imobiliária Centro', categoria_id: 'cat-luz', valor_final: 1, status: 'CANCELADO' });
r = await json(await RSU.GET(req('/x?tabela=pagar&nome=imobiliaria centro')));
eq(r.corpo.categorias.map(c => [c.id, c.vezes]), [['cat-aluguel', 3], ['cat-luz', 1]], 'pagar: as mais usadas com a pessoa, sem a desativada, sem receita e sem cancelada');
await receber('crH1', { cliente_id: 'cli-9', cliente_nome: 'Empresa X', categoria_id: 'cat-fee', valor_final: 1 });
await receber('crH2', { cliente_id: 'cli-9', cliente_nome: 'Empresa X Ltda', categoria_id: 'cat-fee', valor_final: 1 });
await receber('crH3', { cliente_id: 'cli-9', cliente_nome: 'Empresa X', categoria_id: 'cat-luz', valor_final: 1 });
r = await json(await RSU.GET(req('/x?tabela=receber&pessoa_id=cli-9&nome=')));
eq(r.corpo.categorias.map(c => [c.id, c.vezes]), [['cat-fee', 2]], 'receber: pelo cadastro do cliente, só categorias de receita');
eq((await json(await RSU.GET(req('/x?tabela=pagar&nome=ab')))).corpo.categorias, [], 'nome curto demais: nada');
eq((await RSU.GET(req('/x?tabela=x'))).status, 400, 'tabela inválida: 400');

// ---------------------------------------------------------------------------
console.log('--- 6. Conta a receber em moeda com "Repetir" ---');
const serie = (modelo, id) => ({
  modo: 'gravar', id, tabela: 'contas_receber', tipo: 'parcelado', inicio: '2026-12-10', valor: 3000,
  regra: { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'ocorrencias', ocorrencias: 3 } },
  modelo: { origem: 'OUTROS', cliente_nome: 'Agência Parceira', descricao: 'Pacote em dólar', ...modelo },
});
r = await json(await RRE.POST(req('/api/recorrencias', 'POST', serie({ moeda: 'USD', cambio: 5.5, conta_previsao_id: 'b1', campos_personalizados: { pedido: 'P-9' } }, 'serie-usd-1'))));
eq([r.status, r.corpo.criados], [200, 3], 'série a receber em USD criada');
const titulos = (await query(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'serie_id' = 'serie-usd-1' ORDER BY id`, [T])).rows.map(x => x.data);
eq(titulos.map(t => [t.moeda, t.cambio, t.valor_original, t.valor_final]), [['USD', 5.5, 1000, 5500], ['USD', 5.5, 1000, 5500], ['USD', 5.5, 1000, 5500]],
  'cada parcela na moeda, com o valor em reais pelo câmbio do lançamento');
eq([titulos[0].conta_previsao_id, titulos[0].campos_personalizados], ['b1', { pedido: 'P-9' }], 'conta prevista e campos personalizados vão junto na série');
const { valorNaMoedaDoTitulo } = await import('../src/lib/cambio.ts');
eq(valorNaMoedaDoTitulo(titulos[0], titulos[0].valor_final), { moeda: 'USD', valor: 1000, cambio: 5.5 }, 'a liquidação reconhece o valor na moeda (câmbio por parcela na baixa)');
eq((await json(await RRE.POST(req('/api/recorrencias', 'POST', serie({ moeda: 'USD' }, 'serie-usd-2'))))).status, 400, 'em moeda sem câmbio: recusado');
r = await json(await RRE.POST(req('/api/recorrencias', 'POST', serie({ moeda: 'ARS', cambio: 0.006 }, 'serie-ars-1'))));
eq([r.status, /não está cadastrada/.test(r.corpo.error ?? '')], [400, true], 'moeda não cadastrada: recusada');
await RMO.POST(req('/api/moedas', 'POST', { codigo: 'ARS' }));
eq((await json(await RRE.POST(req('/api/recorrencias', 'POST', serie({ moeda: 'ARS', cambio: 0.006 }, 'serie-ars-1'))))).status, 200, 'cadastrada a ARS, a série nasce');
r = await json(await RRE.POST(req('/api/recorrencias', 'POST', serie({}, 'serie-brl-1'))));
const brl = (await um(`SELECT data FROM contas_receber WHERE data->>'serie_id' = 'serie-brl-1' ORDER BY id LIMIT 1`)).data;
eq([r.status, 'moeda' in brl, brl.valor_original, brl.valor_final], [200, false, 1000, 1000], 'em reais: a mesma conta de sempre (sem moeda gravada)');

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
