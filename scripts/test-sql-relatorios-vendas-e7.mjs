/**
 * Relatórios de vendas no fechamento da E7 (frente C) contra um Postgres real
 * (PGlite), pelas ROTAS de produção com sessão de teste:
 *   (a) a viagem corporativa (venda, passageiro e o cartão corporativo do
 *       cliente no pagamento) é gravada e volta igual;
 *   (b) Vendas por produto com as colunas novas (serviço, bilhetes, taxas
 *       separadas, moeda de origem, forma, dados corporativos);
 *   (c) uma empresa só: nada de empresa (nem coluna pedida no link, nem o
 *       relatório por empresa, nem o filtro);
 *   (d) conciliação do cartão corporativo do cliente: uma linha por bilhete,
 *       a soma bate com o pagamento, só os 4 últimos números do cartão, o que
 *       falta, e sem o direito de ver o ganho não saem DU/RAV/Fee;
 *   (e) duas empresas: relatório por empresa, filtro e coluna.
 *
 * Uso: node --no-warnings scripts/test-sql-relatorios-vendas-e7.mjs
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
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_contas_receber_venda_parcela ON contas_receber (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE UNIQUE INDEX idx_contas_pagar_venda_item ON contas_pagar (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.__SESSAO_DE_TESTE__ = null;
register('./sessao-de-teste-hook.mjs', import.meta.url);

const { VENDA_SCHEMA_SQL } = await import('../src/lib/venda-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(VENDA_SCHEMA_SQL);
await pg.exec(VENDA_SCHEMA_SQL); // idempotente

const rotaVenda = await import('../src/app/api/vendas/completa/route.ts');
const rotaUma = await import('../src/app/api/vendas/completa/[id]/route.ts');
const rotaRel = await import('../src/app/api/relatorios/vendas/route.ts');

const T = 'agencia-c';
const sessao = (perfil, userId = `u-${perfil.toLowerCase()}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; };
const rel = async q => json(await rotaRel.GET(pedir('GET', `/api/relatorios/vendas?${q}`)));

await query(`INSERT INTO usuarios (id, nome, data, tenant_id) VALUES ('u-bia', 'Bia', '{}', $1), ('u-admin', 'Ana', '{}', $1)`, [T]);
como(sessao('ADMIN', 'u-admin'));

console.log('--- (a) Viagem corporativa gravada ---');
const corporativa = {
  data_venda: '2026-11-03', cliente: { id: 'cli-x', nome: 'Empresa X', documento: '11.222.333/0001-81' }, vendedor: { id: 'u-bia', nome: 'Bia' },
  corporativo: { centro_custo: 'CC-100 Vendas', solicitante: 'Rita', aprovador: 'Paulo', matricula: '', motivo: 'Feira', projeto: 'Expansão Sul', requisicao: 'RQ-77', lixo: 'x' },
  produtos: [{
    id: 'pa', tipo: 'AEREO', descricao: 'GRU-POA', fornecedor: { id: 'f-cia', nome: 'Consolidadora' }, localizador: 'ABC123',
    data_inicio: '2026-12-01', data_fim: '2026-12-05', detalhes: { cia: 'Voa Bem', trechos: 'GRU-POA-GRU', destino: 'Porto Alegre' },
    passageiros: [
      { id: 'x1', nome: 'Ana', documento: '9572100000001', tarifa_centavos: 100000, taxas_centavos: 5000, outras_taxas_centavos: 1000, corporativo: { centro_custo: 'CC-101', matricula: 'M-1' } },
      { id: 'x2', nome: 'Beto', documento: '', tarifa_centavos: 50000, taxas_centavos: 5000, outras_taxas_centavos: 0 },
    ],
    componentes: [
      { id: 'c1', tipo: 'TAXA_DU', valor_centavos: 4000, passageiro_id: 'x1' }, { id: 'c2', tipo: 'TAXA_DU', valor_centavos: 4000, passageiro_id: 'x2' },
      { id: 'c3', tipo: 'RAV', valor_centavos: 3000 }, { id: 'c4', tipo: 'COMISSAO', valor_centavos: 15000 },
    ],
  }],
  pagamentos: [{ id: 'g1', forma: 'CARTAO', valor_centavos: 172000, parcelas: 1,
    campos: { cartao_corporativo: true, bandeira: 'Visa', final_cartao: '4111 1111 1111 1234', autorizacao: 'A1B2', requisicao: 'RQ-77' } }],
};
let r = await json(await rotaVenda.POST(pedir('POST', '/api/vendas/completa', { venda: corporativa })));
eq(r.status, 201, 'venda corporativa lançada');
const vA = r.corpo.venda.id;
r = await json(await rotaUma.GET(pedir('GET', `/api/vendas/completa/${vA}`), { params: Promise.resolve({ id: vA }) }));
const lida = r.corpo.venda;
eq(lida.corporativo, { centro_custo: 'CC-100 Vendas', solicitante: 'Rita', aprovador: 'Paulo', motivo: 'Feira', projeto: 'Expansão Sul', requisicao: 'RQ-77' }, 'dados corporativos da venda voltam iguais (vazio e campo estranho ficam fora)');
eq([lida.produtos[0].passageiros[0].corporativo, lida.produtos[0].passageiros[1].corporativo], [{ centro_custo: 'CC-101', matricula: 'M-1' }, undefined], 'centro de custo e matrícula do passageiro');
eq(lida.pagamentos[0].campos, { autorizacao: 'A1B2', bandeira: 'Visa', final_cartao: '1234', cartao_corporativo: true, requisicao: 'RQ-77' }, 'cartão corporativo do cliente: só os 4 últimos números');

const lazer = {
  data_venda: '2026-11-05', cliente: { id: 'cli-y', nome: 'Carla' }, vendedor: { id: 'u-bia', nome: 'Bia' },
  produtos: [{ id: 'ph', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f-h', nome: 'Hotel Mar' }, moeda: 'USD', cambio: 5,
    detalhes: { hotel: 'Hotel Mar', checkin: '2026-12-10', checkout: '2026-12-13', regime: 'Café' },
    passageiros: [{ id: 'y1', nome: 'Carla', tarifa_centavos: 30000 }], componentes: [{ id: 'k', tipo: 'COMISSAO', valor_centavos: 3000 }] }],
  pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 150000 }],
};
r = await json(await rotaVenda.POST(pedir('POST', '/api/vendas/completa', { venda: lazer })));
const vB = r.corpo.venda.id;
eq(r.status, 201, 'venda de lazer lançada');

console.log('--- (b) Vendas por produto com as colunas novas ---');
const cols = 'venda_numero,cia,trechos,documentos,nomes_passageiros,taxa_embarque,outras_taxas,diarias,regime,tarifa_moeda,formas,cartao_corporativo,cc_cliente,solicitante,aprovador,matricula,projeto,motivo,requisicao,percentual_comissao,empresa';
r = await rel(`relatorio=produto&de=2026-11-01&ate=2026-11-30&colunas=${cols}`);
eq(r.status, 200, 'relatório responde');
eq(r.corpo.colunas.map(c => c.id).includes('empresa'), false, 'uma empresa só: a coluna Empresa não sai nem pedida no link');
eq(r.corpo.multiempresa, false, 'multiempresa = false');
const [la, lb] = r.corpo.linhas;
eq([la.cia, la.trechos, la.documentos, la.nomes_passageiros, la.taxa_embarque, la.outras_taxas], ['Voa Bem', 'GRU-POA-GRU', '9572100000001', 'Ana, Beto', 10000, 1000], 'aéreo: companhia, trechos, bilhetes, passageiros e taxas separadas');
eq([la.formas, la.cartao_corporativo, la.cc_cliente, la.solicitante, la.aprovador, la.matricula, la.projeto, la.motivo, la.requisicao],
  ['Cartão', 'Sim', 'CC-100 Vendas, CC-101', 'Rita', 'Paulo', 'M-1', 'Expansão Sul', 'Feira', 'RQ-77'], 'forma e viagem corporativa na linha');
eq(la.percentual_comissao, 10, 'comissão em % da tarifa (sensível, com o direito)');
eq([lb.diarias, lb.regime, lb.tarifa_moeda, lb.cartao_corporativo], [3, 'Café', 300, ''], 'hotel: diárias pelas datas, regime, tarifa na moeda de origem');
eq(r.corpo.totais.tarifa_moeda, undefined, 'valor em moeda de origem não se soma no total');
eq(r.corpo.catalogo.length > 80, true, 'mais de 80 colunas para escolher');

console.log('--- (c) Uma empresa só ---');
r = await rel('relatorio=empresa&de=2026-11-01&ate=2026-11-30');
eq([r.corpo.relatorio, r.corpo.linhas.length], ['produto', 2], 'relatório por empresa pedido sem ter duas empresas: o por produto de sempre');
r = await rel('relatorio=produto&de=2026-11-01&ate=2026-11-30&empresa=emp_b');
eq([r.corpo.linhas.length, r.corpo.opcoes.empresas], [2, undefined], 'filtro de empresa ignorado e sem lista de empresas');

console.log('--- (d) Conciliação do cartão corporativo do cliente ---');
r = await rel('relatorio=cartao_corporativo&de=2026-11-01&ate=2026-11-30');
eq(r.status, 200, 'relatório do cartão responde');
const cc = r.corpo.linhas;
eq(cc.map(l => [l.passageiro, l.bilhete, l.valor_bilhete, l.valor_transacao, l.final_cartao, l.cc_cliente, l.matricula]), [
  ['Ana', '9572100000001', 112000, 112000, '1234', 'CC-101', 'M-1'],
  ['Beto', '', 60000, 60000, '1234', 'CC-100 Vendas', ''],
], 'um bilhete por linha, RAV do produto dividido pela tarifa, soma = pagamento');
eq(cc.reduce((a, l) => a + l.valor_transacao, 0), 172000, 'a soma das transações é o valor pago no cartão');
eq([cc[0].pendencias, cc[1].pendencias], ['Pronto', 'Falta bilhete'], 'o que falta para a linha valer');
eq([cc[0].taxa_du, cc[0].rav, cc[1].rav], [4000, 2000, 1000], 'Taxa DU do passageiro e RAV na proporção da tarifa');
eq([r.corpo.quantidade_vendas, r.corpo.titulo], [1, 'Conciliação do cartão corporativo do cliente'], 'só a venda paga no cartão corporativo');
const csv = await (await rotaRel.GET(pedir('GET', '/api/relatorios/vendas?relatorio=cartao_corporativo&de=2026-11-01&ate=2026-11-30&formato=csv'))).text();
eq([csv.includes('Final do cartão'), csv.includes('1234'), /\d{13,}/.test(csv.replace('9572100000001', ''))], [true, true, false], 'CSV com o final do cartão e nenhum número de cartão');

// Sem o direito de ver o ganho: DU, RAV, Fee e desconto ficam fora (o mesmo caminho da rota).
{
  const { montarRelatorioDeVendas, lerConsulta } = await import('../src/lib/relatorios-vendas-servidor.ts');
  const c = lerConsulta(new URLSearchParams('relatorio=cartao_corporativo&de=2026-11-01&ate=2026-11-30&colunas=passageiro,taxa_du,rav,valor_transacao'));
  const s = await montarRelatorioDeVendas(pool, T, c.consulta, { verReceita: false });
  eq([s.colunas.map(k => k.id), 'taxa_du' in s.linhas[0], s.catalogo.some(k => k.id === 'rav')], [['passageiro', 'valor_transacao'], false, false], 'sem o direito: DU/RAV nem saem do servidor');
}

console.log('--- (e) Duas empresas ---');
await pg.exec(`
  CREATE TABLE empresas (tenant_id TEXT NOT NULL, id TEXT NOT NULL, nome TEXT NOT NULL, razao_social TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '',
    principal BOOLEAN NOT NULL DEFAULT FALSE, ativa BOOLEAN NOT NULL DEFAULT TRUE, ordem INTEGER NOT NULL DEFAULT 100, PRIMARY KEY (tenant_id, id));
  CREATE TABLE empresa_selecao (tenant_id TEXT NOT NULL, usuario_id TEXT NOT NULL, empresas JSONB NOT NULL DEFAULT '[]'::jsonb, PRIMARY KEY (tenant_id, usuario_id));
  CREATE FUNCTION fin_empresa_principal(t TEXT) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
`);
await query(`INSERT INTO empresas (tenant_id, id, nome, principal, ordem) VALUES ($1, 'principal', 'Viaje Bem', true, 0), ($1, 'emp_b', 'Loja B', false, 1)`, [T]);
await query(`UPDATE vendas_crm SET data = data || '{"empresa_id":"emp_b"}'::jsonb WHERE tenant_id = $1 AND id = $2`, [T, vB]);
r = await rel('relatorio=empresa&de=2026-11-01&ate=2026-11-30');
eq([r.corpo.relatorio, r.corpo.multiempresa, r.corpo.linhas.map(l => [l.grupo, l.vendas, l.faturamento])],
  ['empresa', true, [['Viaje Bem', 1, 172000], ['Loja B', 1, 150000]]], 'vendas por empresa');
r = await rel('relatorio=produto&de=2026-11-01&ate=2026-11-30&empresa=emp_b&colunas=venda_numero,empresa');
eq([r.corpo.linhas.length, r.corpo.linhas[0]?.empresa, r.corpo.colunas.map(c => c.id), r.corpo.opcoes.empresas.map(o => o.rotulo)],
  [1, 'Loja B', ['venda_numero', 'empresa'], ['Loja B', 'Viaje Bem']], 'filtro, coluna e opções de empresa');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
