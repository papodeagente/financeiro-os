/**
 * Notas fiscais, fechamento de paridade (E7, 06/11/2026), contra um Postgres
 * real (PGlite), rodando o código DE PRODUÇÃO (rotas com sessão de teste, a
 * venda completa, o emissor simulado, sem rede).
 *
 * O que se prova:
 *   (a) esquema: a chave única da nota emitida fora;
 *   (b) Gerar notas: período pela venda ou pelo embarque, filtros por tipo,
 *       vendedor e fornecedor/representante, paginação (sem o corte de 300)
 *       e as opções dos filtros;
 *   (c) data da nota: dia, venda ou embarque, na prévia e na nota gravada
 *       (data de competência); a configuração guarda só o que veio;
 *   (d) nota emitida fora: rota (201, repetida 200, sem direito 403), abate o
 *       saldo da venda, a trava de uma nota por conta, cancelar só registra,
 *       o lote da mudança responde item a item;
 *   (e) tomador do exterior sem CPF/CNPJ: a prévia explica o caminho;
 *   (f) dispensa de retenção pequena na conta a receber (só com o limite);
 *   (g) acompanhamento sozinho das notas na prefeitura: intervalo crescente,
 *       um aviso no sino na recusa, a tarefa atende quem tem nota pendente;
 *   (h) isolamento entre agências.
 *
 * Uso: node --no-warnings scripts/test-sql-notas-e7.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
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
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
  CREATE UNIQUE INDEX uq_notificacoes_chave ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const fonteDb = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const ini = fonteDb.indexOf('CREATE TABLE IF NOT EXISTS config_fiscal (');
await pg.exec(fonteDb.slice(ini, fonteDb.indexOf('-- Convites:', ini)));

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
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { MIGRACAO_SCHEMA_SQL } = await import('../src/lib/migracao/schema.ts');
const { NOTAS_REGRAS_SCHEMA_SQL } = await import('../src/lib/nota-regras-schema.ts');
for (const sql of [BAIXAS_SCHEMA_SQL, PERIODO_SCHEMA_SQL, COBRANCA_SCHEMA_SQL, PERMISSOES_SCHEMA_SQL, MIGRACAO_SCHEMA_SQL, VENDA_SCHEMA_SQL, NOTAS_REGRAS_SCHEMA_SQL, NOTAS_REGRAS_SCHEMA_SQL, RAZAO_SCHEMA_SQL]) {
  await pg.exec(sql);
}

const srvVenda = await import('../src/lib/venda-servidor.ts');
const { normalizarVenda } = await import('../src/lib/venda-modelo.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const nfse = await import('../src/lib/nfse-servico.ts');
const notas = await import('../src/lib/nota-regras-servidor.ts');
const externa = await import('../src/lib/nota-externa.ts');
const acomp = await import('../src/lib/nota-acompanhamento.ts');
const { salvarRetencao } = await import('../src/lib/nota-retencoes-servidor.ts');
const rotaGerar = await import('../src/app/api/fiscal/gerar/route.ts');
const rotaPrevia = await import('../src/app/api/fiscal/gerar/previa/route.ts');
const rotaConfig = await import('../src/app/api/fiscal/notas-config/route.ts');
const rotaExterna = await import('../src/app/api/fiscal/notas-externas/route.ts');

const T = 'agencia-e7';
const T2 = 'outra-agencia';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });

for (const t of [T, T2]) {
  await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ($1, $2, $3)`, [`ag-${t}`, t, { cnpj: '11222333000181', razao_social: 'Agência' }]);
  await query(`INSERT INTO config_fiscal (id, tenant_id, data) VALUES ($1, $2, $3)`, [t === T ? 'config-fiscal-singleton' : 'config-fiscal-outra', t, {
    provedor: 'simulado', ambiente: 'HOMOLOGACAO', certificado: { referencia_gateway: 'simulado', validade_fim: '2030-01-01' }, cnae: '7911200', aliquota_iss: 2,
  }]);
}
await query(`INSERT INTO usuarios (id, tenant_id, nome) VALUES ('u-1', $1, 'Bia Vendas'), ('u-2', $1, 'Caio Vendas')`, [T]);
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data) VALUES ('cli-1', $1, 'Carla Dias', '12345678909', $2)`, [T, { nome: 'Carla Dias', tipo: 'PF', cpf: '12345678909', cpf_cnpj: '12345678909', email: 'carla@x.com' }]);
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data) VALUES ('cli-ext', $1, 'John Smith', '', $2)`, [T, { nome: 'John Smith', tipo: 'PF', estrangeiro: true, passaporte: 'P1234', pais: 'Estados Unidos' }]);
await query(`INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, data) VALUES ('f-cia', $1, 'Cia Aérea', '02012862000160', $2)`, [T, { razao_social: 'Cia Aérea S.A.', cnpj: '02012862000160' }]);
await query(`INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, data) VALUES ('f-hotel', $1, 'Hotel Mar', '33000167000101', $2)`, [T, { razao_social: 'Hotel Mar Ltda', cnpj: '33000167000101' }]);
await query(`INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, data) VALUES ('r-cons', $1, 'Consolidadora', '04252011000110', $2)`, [T, { razao_social: 'Consolidadora Ltda', cnpj: '04252011000110' }]);

console.log('--- (a) Esquema ---');
eq((await todos(`SELECT indexname FROM pg_indexes WHERE tablename = 'notas_fiscais' AND indexname IN ('uq_nota_chave_externa', 'idx_notas_fiscais_processando') ORDER BY 1`)).map(r => r.indexname),
  ['idx_notas_fiscais_processando', 'uq_nota_chave_externa'], 'chave da nota de fora e índice das notas na prefeitura (esquema rodou duas vezes)');

globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
await notas.salvarRegra(pool, T, {
  descricao: 'Todas as vendas',
  destinos: {
    PAGANTE: { ligado: true, receitas: ['TAXA_DU', 'RAV', 'FEE', 'MARKUP'], gatilho: 'MANUAL' },
    FORNECEDOR: { ligado: false }, REPRESENTANTE: { ligado: true, receitas: ['COMISSAO'], gatilho: 'MANUAL' },
  },
}, { id: 'u' });

const gravar = venda => emTransacao(exec => srvVenda.salvarVenda(exec, T, venda, { usuario: { id: 'u', nome: 'Ana' }, origem: 'manual' }));
const aereo = (id, extra = {}) => ({
  id, tipo: 'AEREO', descricao: 'GRU-LIS', fornecedor: { id: 'f-cia', nome: 'Cia Aérea' }, quantidade: 1, valor_unitario_centavos: 100000,
  localizador: 'XKT9QZ', passageiros: [], componentes: [{ tipo: 'TAXA_DU', valor_centavos: 4000 }, { tipo: 'RAV', valor_centavos: 3000 }], ...extra,
});
const hotel = (id, extra = {}) => ({
  id, tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' }, representante: { id: 'r-cons', nome: 'Consolidadora' },
  quantidade: 1, valor_unitario_centavos: 200000, componentes: [{ tipo: 'FEE', valor_centavos: 5000 }, { tipo: 'COMISSAO', valor_centavos: 20000 }], ...extra,
});
const novaVenda = (id, numero, data, vendedor, produtos, cliente = { id: 'cli-1', nome: 'Carla Dias' }) => normalizarVenda({
  id, numero, data_venda: data, cliente, vendedor, produtos,
  pagamentos: [{ id: `pg-${id}`, forma: 'PIX', valor_centavos: 100 }],
}).venda;
await gravar(novaVenda('v-a', 'VND-0001', '2026-11-01', { id: 'u-1', nome: 'Bia Vendas' }, [aereo('pa', { data_inicio: '2026-12-20', data_fim: '2026-12-28' })]));
await gravar(novaVenda('v-b', 'VND-0002', '2026-11-02', { id: 'u-2', nome: 'Caio Vendas' }, [hotel('pb', { data_inicio: '2026-11-03', data_fim: '2026-11-05' })]));
await gravar(novaVenda('v-c', 'VND-0003', '2026-10-20', { id: 'u-1', nome: 'Bia Vendas' }, [aereo('pc', { data_inicio: '2026-11-10', data_fim: '2026-11-12' })]));

console.log('--- (b) Gerar notas: filtros e paginação ---');
const grade = async q => (await json(await rotaGerar.GET(pedir('GET', `/api/fiscal/gerar?de=2026-11-01&ate=2026-11-30${q}`)))).corpo;
let g = await grade('');
eq([g.linhas.map(l => l.venda_id), g.total_vendas, g.paginas, g.vendas_fora], [['v-b', 'v-a'], 2, 1, 0], 'pela data da venda: as vendas de novembro, a mais nova primeiro');
g = await grade('&data_de=EMBARQUE');
eq(g.linhas.map(l => [l.venda_id, l.data_embarque]), [['v-b', '2026-11-03'], ['v-c', '2026-11-10']], 'pelo embarque: entra a venda de outubro que embarca em novembro; sai a que embarca em dezembro');
g = await grade('&tipo=HOSPEDAGEM');
eq(g.linhas.map(l => l.produto_id), ['pb'], 'só hospedagem');
g = await grade('&vendedor=u-1');
eq(g.linhas.map(l => l.venda_id), ['v-a'], 'só as vendas do vendedor');
g = await grade('&fornecedor=r-cons');
eq(g.linhas.map(l => [l.produto_id, l.representante_nome]), [['pb', 'Consolidadora']], 'o fornecedor casa também com o representante');
g = await grade('&fornecedor=f-cia&tipo=HOSPEDAGEM');
eq([g.linhas.length, g.total_vendas], [0, 0], 'filtros juntos que não casam: nada');
g = await grade('&por_pagina=1');
const p1 = g.linhas.map(l => l.venda_id);
g = await grade('&por_pagina=1&pagina=2');
eq([p1, g.linhas.map(l => l.venda_id), g.pagina, g.paginas, g.total_vendas], [['v-b'], ['v-a'], 2, 2, 2], 'paginação por venda: página 2 de 2');
g = await grade('&por_pagina=1&pagina=9');
eq([g.linhas.length, g.paginas], [0, 2], 'página além do fim: vazia, e a tela sabe quantas há');
g = await grade('&busca=VND-0002');
eq(g.linhas.map(l => l.venda_id), ['v-b'], 'busca pelo número da venda');
eq([g.opcoes.vendedores.map(v => v.nome), g.opcoes.fornecedores.map(f => f.nome)], [['Bia Vendas', 'Caio Vendas'], ['Cia Aérea', 'Consolidadora', 'Hotel Mar']], 'opções dos filtros: quem aparece nas vendas do período');

console.log('--- (c) Data da nota ---');
let pv = await notas.previaDeNotas(pool, T, [{ venda_id: 'v-b' }], { data_da_nota: 'EMBARQUE', hoje: '2026-11-30' });
eq([pv.data_da_nota, pv.notas.map(n => [n.destino, n.data_nota, n.aviso_data])], ['EMBARQUE', [['PAGANTE', '2026-11-03', null], ['REPRESENTANTE', '2026-11-03', null]]], 'prévia pela data do embarque');
pv = await notas.previaDeNotas(pool, T, [{ venda_id: 'v-a' }], { data_da_nota: 'EMBARQUE', hoje: '2026-11-30' });
eq([pv.notas[0].data_nota, Boolean(pv.notas[0].aviso_data)], ['2026-11-30', true], 'embarque ainda por vir: a data de hoje, com aviso');
pv = await notas.previaDeNotas(pool, T, [{ venda_id: 'v-b' }], { hoje: '2026-11-30' });
eq([pv.data_da_nota, pv.notas[0].data_nota], ['DIA', '2026-11-30'], 'sem escolha: a configuração (padrão: o dia)');
let r = await json(await rotaConfig.PUT(pedir('PUT', '/api/fiscal/notas-config', { data_da_nota: 'VENDA' })));
eq([r.corpo.data_da_nota, r.corpo.enviar_ao_cliente, r.corpo.automatico], ['VENDA', true, false], 'a configuração guarda só o que veio (o resto continua)');
g = await grade('');
eq(g.data_da_nota, 'VENDA', 'a grade diz a data que as notas vão levar');
r = await json(await rotaPrevia.POST(pedir('POST', '/api/fiscal/gerar/previa', { selecao: [{ venda_id: 'v-b' }] })));
eq(r.corpo.notas[0].data_nota, '2026-11-02', 'prévia pela rota: a data da venda (configuração)');
r = await json(await rotaGerar.POST(pedir('POST', '/api/fiscal/gerar', { selecao: [{ venda_id: 'v-b' }], assinatura: r.corpo.assinatura, data_da_nota: 'VENDA' })));
eq([r.status, r.corpo.emitidas.map(n => [n.destino, n.data_competencia])], [200, [['PAGANTE', '2026-11-02'], ['REPRESENTANTE', '2026-11-02']]], 'a nota gravada leva a data de competência escolhida');
const { montarCorpoEmissao } = await import('../src/lib/nfse-acelera.ts');
eq(montarCorpoEmissao({ nota: r.corpo.emitidas[0], config: {} }).data_competencia, '2026-11-02', 'o emissor nacional recebe a data escolhida');

console.log('--- (d) Nota emitida fora do sistema ---');
const deFora = { numero: '000123', serie: '1', data_emissao: '2026-11-03', valor_centavos: 7000, tomador: { nome: 'Carla Dias', cpf_cnpj: '123.456.789-09' }, venda_numero: 'VND-0001', codigo_verificacao: 'AB12' };
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', deFora)));
eq(r.status, 403, 'sem o direito de emitir nota: 403');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', deFora)));
eq([r.status, r.corpo.repetida, r.corpo.nota.status, r.corpo.nota.emitida_fora, r.corpo.nota.venda_id, r.corpo.nota.cliente_id, r.corpo.nota.chave_externa],
  [201, false, 'AUTORIZADA', true, 'v-a', 'cli-1', 'fora:11222333000181|1|123'], 'registrada: autorizada, de fora, ligada à venda pelo número');
const idFora = r.corpo.nota.id;
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', { ...deFora, numero: '123' })));
eq([r.status, r.corpo.repetida, r.corpo.nota.id], [200, true, idFora], 'a mesma nota de novo (123 = 000123): devolve a que existe');
eq(Number((await um(`SELECT COUNT(*) n FROM notas_fiscais WHERE tenant_id = $1 AND data->>'emitida_fora' = 'true'`, [T])).n), 1, 'uma nota só no banco');
g = await grade('&busca=VND-0001&pendentes=1');
eq(g.linhas.map(l => [l.venda_id, l.receita, l.valor_notas, l.saldo, l.situacao]), [], 'a nota de fora cobre a receita de 70,00: a venda sai do "pede ação"');
g = await grade('&busca=VND-0001');
eq(g.linhas.map(l => [l.venda_id, l.receita, l.valor_notas, l.saldo, l.situacao]), [['v-a', 7000, 7000, 0, 'EMITIDA']], 'na grade inteira: em nota pela nota de fora, saldo zero');
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', { ...deFora, numero: '9', data_emissao: '2099-01-01' })));
eq([r.status, r.corpo.codigo], [400, 'DADOS'], 'data futura: recusada com a frase');
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', { ...deFora, numero: '10', venda_numero: 'VND-9999' })));
eq([r.status, r.corpo.codigo], [404, 'VENDA'], 'venda que não existe: recusada');
await query(`INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data) VALUES ('cr-x', $1, '', 'cli-1', 'RECEBIDO', $2)`, [T, { id: 'cr-x', origem: 'VENDA', status: 'RECEBIDO', valor_final: 500 }]);
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', { ...deFora, numero: '11', venda_numero: '', conta_receber_id: 'cr-x' })));
eq(r.status, 201, 'nota de fora ligada a uma conta a receber');
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', { ...deFora, numero: '12', venda_numero: '', conta_receber_id: 'cr-x' })));
eq([r.status, r.corpo.codigo], [409, 'CONTA_COM_NOTA'], 'a conta já tem nota valendo: a segunda é recusada (trava de sempre)');
const cancelada = await nfse.cancelarNota(T, idFora, 'Lançada em duplicidade');
eq([cancelada.status, cancelada.motivo_cancelamento], ['CANCELADA', 'Lançada em duplicidade'], 'cancelar a nota de fora: só registra aqui (o emissor não a conhece)');
const lote = await emTransacao(exec => externa.registrarNotasEmitidasFora(exec, T, [
  { numero: '500', data_emissao: '2026-09-01', valor_centavos: 1000, tomador: { nome: 'A', cpf_cnpj: '12345678909' } },
  { numero: '', data_emissao: '2026-09-01', valor_centavos: 1000, tomador: { nome: 'B', cpf_cnpj: '12345678909' } },
  { numero: '501', data_emissao: '2026-09-02', valor_centavos: 2000, tomador: { nome: 'C', estrangeiro: true, pais: 'Chile' }, situacao: 'CANCELADA', cancelada_em: '2026-09-10' },
], { id: '', nome: 'Mudança' }));
eq(lote.map(x => [x.indice, x.ok, Boolean(x.erro)]), [[0, true, false], [1, false, true], [2, true, false]], 'lote da mudança: item a item, o erro não para os outros');
const da501 = (await um(`SELECT status, data FROM notas_fiscais WHERE tenant_id = $1 AND data->>'numero' = '501'`, [T]));
eq([da501.status, da501.data.registro_origem, da501.data.tomador.estrangeiro], ['CANCELADA', 'MUDANCA', true], 'a nota cancelada do sistema anterior entra como cancelada, marcada da mudança');

console.log('--- (e) Tomador do exterior ---');
await gravar(novaVenda('v-ext', 'VND-0010', '2026-11-04', null, [aereo('pe')], { id: 'cli-ext', nome: 'John Smith' }));
pv = await notas.previaDeNotas(pool, T, [{ venda_id: 'v-ext' }], { hoje: '2026-11-30' });
eq([pv.notas[0].valida, pv.notas[0].pendencias.includes(notas.PENDENCIA_TOMADOR_EXTERIOR), pv.notas[0].tomador_nota.estrangeiro, pv.notas[0].tomador_nota.documento_estrangeiro],
  [false, true, true, 'P1234'], 'tomador do exterior sem CPF/CNPJ: não emite e diz como registrar a nota de fora');

console.log('--- (f) Dispensa de retenção pequena na conta a receber ---');
await salvarRetencao(pool, T, { cliente: { id: 'cli-1', nome: 'Carla Dias' }, tipo_produto: 'AEREO', nacional: { VALOR: { IR: 0.5 } } });
const vRet = id => normalizarVenda({ id, numero: id, data_venda: '2026-11-05', cliente: { id: 'cli-1', nome: 'Carla Dias' }, produtos: [aereo(`p-${id}`)], pagamentos: [{ id: `pg-${id}`, forma: 'PIX', valor_centavos: 107000 }] }).venda;
await gravar(vRet('v-ret1'));
const contaDe = async id => (await um(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'origem' = 'VENDA'`, [T, id])).data;
eq((await contaDe('v-ret1')).retencao_na_fonte?.IR, 5, 'sem limite: o IR de 5,00 (0,5% de 1.000) é retido, como antes');
await json(await rotaConfig.PUT(pedir('PUT', '/api/fiscal/notas-config', { retencao_minima: { ir_centavos: 1000 } })));
await gravar(vRet('v-ret2'));
const c2 = await contaDe('v-ret2');
eq([c2.retencao_na_fonte ?? null, c2.valor_final], [null, 1070], 'com o limite de 10,00 digitado: o IR de 5,00 não se retém, a conta fica cheia');

console.log('--- (g) Acompanhamento sozinho das notas na prefeitura ---');
const notaPendente = (id, emitida) => ({ id, conta_receber_id: '', venda_id: 'v-a', cliente_id: 'cli-1', status: 'PROCESSANDO', tomador: { razao_social: 'Carla Dias', cpf_cnpj: '12345678909' }, valor_servicos: 70, erro: '', emitida_em: emitida, protocolo: 'P-1' });
await query(`INSERT INTO notas_fiscais (id, tenant_id, venda_id, status, data) VALUES ('np-1', $1, 'v-a', 'PROCESSANDO', $2)`, [T, notaPendente('np-1', '2026-11-06T10:00:00.000Z')]);
await query(`INSERT INTO notas_fiscais (id, tenant_id, venda_id, status, data) VALUES ('np-2', $1, 'v-a', 'PROCESSANDO', $2)`, [T, notaPendente('np-2', '2026-11-06T11:58:00.000Z')]);
const respostas = new Map();
const consultas = [];
const consultar = async (tenant, id) => {
  consultas.push(id);
  const st = respostas.get(id) ?? 'PROCESSANDO';
  const atual = (await um(`SELECT data FROM notas_fiscais WHERE tenant_id = $1 AND id = $2`, [tenant, id])).data;
  const nova = { ...atual, status: st, erro: st === 'REJEITADA' ? 'CPF do tomador não confere com a Receita.' : '' };
  await query(`UPDATE notas_fiscais SET status = $3, data = $4 WHERE tenant_id = $1 AND id = $2`, [tenant, id, st, nova]);
  return nova;
};
const agora = new Date('2026-11-06T12:00:00.000Z');
let res = await acomp.acompanharNotasDaAgencia(pool, T, agora, consultar);
eq([consultas, res.consultadas, res.sem_resposta], [['np-1'], 1, 1], 'consulta só a nota de 2 h atrás (a de 2 min espera os 5 min)');
let passo = (await um(`SELECT data->'acompanhamento' a FROM notas_fiscais WHERE id = 'np-1'`)).a;
eq([passo.tentativas, passo.proxima_em], [1, '2026-11-06T12:15:00.000Z'], 'sem resposta: a próxima em 15 minutos');
consultas.length = 0;
res = await acomp.acompanharNotasDaAgencia(pool, T, new Date('2026-11-06T12:10:00.000Z'), consultar);
eq(consultas, ['np-2'], '10 min depois: só a nota nova; a outra espera o intervalo');
respostas.set('np-1', 'REJEITADA');
respostas.set('np-2', 'AUTORIZADA');
consultas.length = 0;
res = await acomp.acompanharNotasDaAgencia(pool, T, new Date('2026-11-06T12:40:00.000Z'), consultar);
eq([consultas.sort(), res.recusadas, res.autorizadas], [['np-1', 'np-2'], 1, 1], 'a prefeitura respondeu: uma recusada, uma autorizada');
const avisos = await todos(`SELECT titulo, descricao, link, data FROM notificacoes WHERE tenant_id = $1 AND tipo = 'NOTA_RECUSADA'`, [T]);
eq([avisos.length, avisos[0]?.titulo, avisos[0]?.descricao.includes('CPF do tomador não confere'), avisos[0]?.data.nota_id], [1, 'A prefeitura recusou a nota para Carla Dias', true, 'np-1'], 'um aviso no sino, com o motivo');
passo = (await um(`SELECT data->'acompanhamento' a FROM notas_fiscais WHERE id = 'np-1'`)).a;
eq([passo.proxima_em, passo.avisada_recusa], ['', true], 'resposta final: sem próxima consulta, aviso marcado');
res = await acomp.acompanharNotasDaAgencia(pool, T, new Date('2026-11-07T12:00:00.000Z'), consultar);
eq([res.consultadas, Number((await um(`SELECT COUNT(*) n FROM notificacoes WHERE tipo = 'NOTA_RECUSADA'`)).n)], [0, 1], 'nada mais a consultar; o aviso não se repete');
await query(`INSERT INTO notas_fiscais (id, tenant_id, venda_id, status, data) VALUES ('np-3', $1, '', 'PROCESSANDO', $2)`, [T, notaPendente('np-3', '2026-11-06T10:00:00.000Z')]);
const ctx = { exec: pool, agora, emTransacao, restanteMs: () => 60000 };
eq(await acomp.tarefaAcompanharNotas.agencias(ctx), [T], 'a tarefa atende só quem tem nota na prefeitura');
const falha = async () => { throw new Error('rede caiu'); };
res = await acomp.acompanharNotasDaAgencia(pool, T, agora, falha);
passo = (await um(`SELECT data->'acompanhamento' a FROM notas_fiscais WHERE id = 'np-3'`)).a;
eq([res.falhas, passo.tentativas, passo.proxima_em], [1, 1, '2026-11-06T12:15:00.000Z'], 'falha de rede: só empurra a próxima consulta');

console.log('--- (h) Isolamento ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', T2);
r = await json(await rotaGerar.GET(pedir('GET', '/api/fiscal/gerar?de=2026-10-01&ate=2026-11-30')));
eq([r.corpo.linhas.length, r.corpo.total_vendas, r.corpo.opcoes.vendedores.length], [0, 0, 0], 'a outra agência não vê as vendas');
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', deFora)));
eq([r.status, r.corpo.codigo], [404, 'VENDA'], 'a outra agência não liga nota à venda daqui');
r = await json(await rotaExterna.POST(pedir('POST', '/api/fiscal/notas-externas', { ...deFora, venda_numero: '' })));
eq([r.status, r.corpo.repetida], [201, false], 'a mesma numeração em outra agência é outra nota');

console.log(`\n${total - falhas}/${total} testes passaram`);
if (falhas) process.exit(1);
