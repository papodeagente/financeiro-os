/**
 * Notas por regra e retenções na fonte (E5, parte E) contra um Postgres real
 * (PGlite), rodando o código DE PRODUÇÃO (rotas com sessão de teste, a
 * venda completa, a fila do agendador) e o emissor simulado (sem rede).
 *
 * O que se prova:
 *   (a) esquema idempotente e a chave única da nota gerada;
 *   (b) a nota de antes (uma por conta a receber) continua igual: prévia,
 *       emissão e a trava de uma nota por conta;
 *   (c) os 2 defeitos da nota para a operadora, corrigidos: o tomador é o
 *       fornecedor que pagou a comissão, e a base é a comissão inteira;
 *   (d) regras pela rota: criar, repetida (409), sem direito (403);
 *   (e) "Gerar notas": grade, prévia com assinatura, emissão dos 3 destinos,
 *       prévia mudada (409), nada sai duas vezes;
 *   (f) nota complementar quando a receita cresce;
 *   (g) retenções na fonte: conta a receber líquida, retenção na nota;
 *   (h) gatilhos pela fila: ao receber, ao receber a comissão, ao fechar a
 *       fatura; desligado não emite; "nada sai" segura;
 *   (i) cancelamento sugerido quando a venda é cancelada (não cancela sozinho);
 *   (j) isolamento entre agências.
 *
 * Uso: node --no-warnings scripts/test-sql-notas-regras.mjs
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
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
// config_fiscal e notas_fiscais saem do próprio db.ts (mesmo SQL de produção).
const fonteDb = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const ini = fonteDb.indexOf('CREATE TABLE IF NOT EXISTS config_fiscal (');
await pg.exec(fonteDb.slice(ini, fonteDb.indexOf('-- Convites:', ini)));

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
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
const { comNadaSai } = await import('../src/lib/nada-sai.ts');
const fila = await import('../src/lib/agendador/fila.ts');
const rotaRegras = await import('../src/app/api/fiscal/regras/route.ts');
const rotaRegra = await import('../src/app/api/fiscal/regras/[id]/route.ts');
const rotaRetencoes = await import('../src/app/api/fiscal/retencoes/route.ts');
const rotaRetencao = await import('../src/app/api/fiscal/retencoes/[id]/route.ts');
const rotaGerar = await import('../src/app/api/fiscal/gerar/route.ts');
const rotaPrevia = await import('../src/app/api/fiscal/gerar/previa/route.ts');
const rotaConfig = await import('../src/app/api/fiscal/notas-config/route.ts');

const T = 'agencia-notas';
const T2 = 'outra-agencia';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });

// Cadastros: agência, emissor simulado, cliente, fornecedores.
for (const t of [T, T2]) {
  await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ($1, $2, $3)`, [`ag-${t}`, t, { cnpj: '11222333000181', razao_social: 'Agência' }]);
  await query(`INSERT INTO config_fiscal (id, tenant_id, data) VALUES ($1, $2, $3)`, [t === T ? 'config-fiscal-singleton' : 'config-fiscal-outra', t, {
    provedor: 'simulado', ambiente: 'HOMOLOGACAO', certificado: { referencia_gateway: 'simulado', validade_fim: '2030-01-01' }, cnae: '7911200', aliquota_iss: 2,
  }]);
}
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data) VALUES ('cli-1', $1, 'Prefeitura de Exemplo', '00394460000141', $2)`, [T, { nome: 'Prefeitura de Exemplo', tipo: 'PJ', cnpj: '00394460000141', cpf_cnpj: '00394460000141', email: 'nf@prefeitura.gov.br' }]);
await query(`INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, data) VALUES ('f-cia', $1, 'Cia Aérea', '02012862000160', $2)`, [T, { razao_social: 'Cia Aérea S.A.', nome_fantasia: 'Cia Aérea', cnpj: '02012862000160', email: 'fin@cia.com' }]);
await query(`INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, data) VALUES ('r-cons', $1, 'Consolidadora', '04252011000110', $2)`, [T, { razao_social: 'Consolidadora Ltda', cnpj: '04252011000110' }]);
await query(`INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, data) VALUES ('f-hotel', $1, 'Hotel Mar', '33000167000101', $2)`, [T, { razao_social: 'Hotel Mar Ltda', cnpj: '33000167000101' }]);

console.log('--- (a) Esquema ---');
const tabelas = (await todos(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('nota_regras','retencoes_cliente') ORDER BY 1`)).map(r => r.table_name);
eq(tabelas, ['nota_regras', 'retencoes_cliente'], 'tabelas das regras e das retenções (esquema rodou duas vezes)');
eq((await todos(`SELECT indexname FROM pg_indexes WHERE tablename = 'notas_fiscais' AND indexname = 'uq_nota_chave_geracao'`)).length, 1, 'chave única da nota gerada');

console.log('--- (b) A nota de antes (por conta) continua igual ---');
await query(`INSERT INTO vendas_crm (id, tenant_id, cliente_id, status, data) VALUES ('v-antiga', $1, 'cli-1', 'CONFIRMADO', $2)`, [T, { id: 'v-antiga', numero: 'VND-0900', cliente_id: 'cli-1', data_venda: '2026-10-20', valor_final: 10000, valor_total_custo: 8000 }]);
await query(`INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data) VALUES ('cr-cli', $1, 'v-antiga', 'cli-1', 'RECEBIDO', $2)`, [T, { id: 'cr-cli', origem: 'VENDA', venda_id: 'v-antiga', cliente_id: 'cli-1', status: 'RECEBIDO', valor_final: 10000, valor_recebido: 10000 }]);
await query(`INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data) VALUES ('cr-op', $1, 'v-antiga', 'f-cia', 'RECEBIDO', $2)`, [T, { id: 'cr-op', origem: 'COMISSAO_FORNECEDOR', venda_id: 'v-antiga', cliente_id: 'f-cia', fornecedor_id: 'f-cia', cliente_nome: 'Cia Aérea', status: 'RECEBIDO', valor_final: 1500, valor_recebido: 1500 }]);
let pv = await nfse.montarPrevia(T, 'cr-cli', {});
eq([pv.pode_emitir, pv.regime, pv.valor_servicos, pv.base_calculo, pv.valor_iss, pv.comissao_da_parcela, pv.repasse_da_parcela, pv.tomador.razao_social, pv.tomador.cpf_cnpj],
  [true, 'INTERMEDIACAO', 2000, 2000, 40, 2000, 8000, 'Prefeitura de Exemplo', '00394460000141'], 'conta do cliente: a mesma prévia de antes (margem da venda, tomador cliente)');
const notaAntiga = await nfse.emitirNota(T, 'cr-cli', {}, { id: 'u', nome: 'Ana' });
eq([notaAntiga.status, notaAntiga.valor_servicos, notaAntiga.conta_receber_id, notaAntiga.origem], ['AUTORIZADA', 2000, 'cr-cli', undefined], 'emissão por conta como antes (emissor simulado, sem rede)');
let erro = await nfse.emitirNota(T, 'cr-cli', {}, { id: 'u', nome: 'Ana' }).then(() => null, e => e.message);
eq(/já tem nota/.test(erro ?? ''), true, 'uma nota por conta a receber: a segunda é recusada');

console.log('--- (c) Nota para a operadora: tomador e base corrigidos ---');
pv = await nfse.montarPrevia(T, 'cr-op', {});
eq([pv.tomador.razao_social, pv.tomador.cpf_cnpj, pv.tomador.email], ['Cia Aérea S.A.', '02012862000160', 'fin@cia.com'], 'DEPOIS: o tomador é a operadora que pagou a comissão (antes: vazio, nota travada)');
eq([pv.valor_servicos, pv.base_calculo, pv.valor_iss, pv.repasse_da_parcela, pv.pode_emitir, pv.pendencias], [1500, 1500, 30, 0, true, []], 'DEPOIS: a base é a comissão inteira, 1.500 (antes: 300, a margem da venda do cliente)');
const notaOp = await nfse.emitirNota(T, 'cr-op', {}, { id: 'u', nome: 'Ana' });
eq([notaOp.status, notaOp.tomador.cpf_cnpj, notaOp.valor_servicos], ['AUTORIZADA', '02012862000160', 1500], 'nota para a operadora sai com o tomador e a base certos');
await query(`UPDATE fornecedores_crm SET cnpj = '', data = data - 'cnpj' WHERE id = 'f-cia'`);
pv = await nfse.montarPrevia(T, 'cr-op', {});
eq(pv.pendencias.some(p => /fornecedor que paga esta comissão está sem CNPJ/.test(p)), true, 'operadora sem CNPJ: a pendência manda ao cadastro do fornecedor');
await query(`UPDATE fornecedores_crm SET cnpj = '02012862000160', data = data || '{"cnpj":"02012862000160"}' WHERE id = 'f-cia'`);

console.log('--- (d) Regras pela rota ---');
const regraGeral = {
  descricao: 'Todas as vendas',
  destinos: {
    PAGANTE: { ligado: true, receitas: ['TAXA_DU', 'RAV', 'FEE', 'MARKUP'], descontos: ['DESCONTO'], gatilho: 'MANUAL' },
    FORNECEDOR: { ligado: true, receitas: ['COMISSAO', 'OVER'], descontos: [], gatilho: 'MANUAL' },
    REPRESENTANTE: { ligado: false },
  },
  ibs_cbs: { cst: '410' },
};
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
let r = await json(await rotaRegras.POST(pedir('POST', '/api/fiscal/regras', regraGeral)));
eq(r.status, 403, 'vendedor não configura regra da nota');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
r = await json(await rotaRegras.POST(pedir('POST', '/api/fiscal/regras', regraGeral)));
eq([r.status, r.corpo.descricao, r.corpo.ibs_cbs.cst], [201, 'Todas as vendas', '410'], 'regra criada (com os campos de IBS/CBS informados)');
const idGeral = r.corpo.id;
r = await json(await rotaRegras.POST(pedir('POST', '/api/fiscal/regras', { ...regraGeral, descricao: 'Outra' })));
eq([r.status, r.corpo.codigo], [409, 'REGRA_REPETIDA'], 'mesma combinação: recusada');
r = await json(await rotaRegras.POST(pedir('POST', '/api/fiscal/regras', {
  descricao: 'Hospedagem', tipo_produto: 'HOSPEDAGEM',
  destinos: { PAGANTE: { ligado: true, receitas: ['FEE', 'MARKUP'], gatilho: 'MANUAL' }, REPRESENTANTE: { ligado: true, receitas: ['COMISSAO'], gatilho: 'MANUAL' } },
})));
eq(r.status, 201, 'regra do tipo de produto com nota ao representante');
const idHotel = r.corpo.id;
r = await json(await rotaRegras.GET());
eq([r.corpo.regras.length, r.corpo.config.automatico, r.corpo.sugerida.descricao], [2, false, 'Todas as vendas'], 'lista, configuração (automático desligado) e a regra sugerida');

console.log('--- (e) Gerar notas: grade, prévia e emissão ---');
const vendaBase = () => normalizarVenda({
  id: 'v-nova', data_venda: '2026-11-01', cliente: { id: 'cli-1', nome: 'Prefeitura de Exemplo' },
  produtos: [
    { id: 'p-aereo', tipo: 'AEREO', descricao: 'GRU-REC', fornecedor: { id: 'f-cia', nome: 'Cia Aérea' }, quantidade: 1, valor_unitario_centavos: 100000, taxas_centavos: 10000,
      componentes: [{ tipo: 'TAXA_DU', valor_centavos: 4000 }, { tipo: 'RAV', valor_centavos: 3000 }, { tipo: 'COMISSAO', valor_centavos: 6000 }, { tipo: 'OVER', valor_centavos: 1000 }] },
    { id: 'p-hotel', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' }, representante: { id: 'r-cons', nome: 'Consolidadora' },
      quantidade: 1, valor_unitario_centavos: 200000, componentes: [{ tipo: 'FEE', valor_centavos: 5000 }, { tipo: 'MARKUP', valor_centavos: 10000 }, { tipo: 'COMISSAO', valor_centavos: 20000 }] },
  ],
  pagamentos: [{ id: 'pg-bol', forma: 'BOLETO', valor_centavos: 332000, parcelas: 2, primeiro_vencimento: '2026-12-01' }],
}).venda;
const gravar = venda => emTransacao(exec => srvVenda.salvarVenda(exec, T, venda, { usuario: { id: 'u', nome: 'Ana' }, origem: 'manual' }));
await gravar(vendaBase());
r = await json(await rotaGerar.GET(pedir('GET', '/api/fiscal/gerar?de=2026-11-01&ate=2026-11-30')));
eq(r.corpo.linhas.map(l => [l.venda_id, l.produto_id, l.receita, l.valor_notas, l.saldo, l.situacao]), [
  ['v-nova', 'p-aereo', 14000, 0, 14000, 'A_EMITIR'], ['v-nova', 'p-hotel', 35000, 0, 35000, 'A_EMITIR'],
], 'grade: Receitas × Valor das notas × Saldo (a venda de outubro fica fora do período)');
r = await json(await rotaPrevia.POST(pedir('POST', '/api/fiscal/gerar/previa', { selecao: [{ venda_id: 'v-nova' }] })));
const previa1 = r.corpo;
eq(previa1.notas.map(n => [n.destino, n.tomador_nota.razao_social, n.valor_centavos, n.valida, n.envio.pedido]), [
  ['PAGANTE', 'Prefeitura de Exemplo', 22000, true, true],
  ['FORNECEDOR', 'Cia Aérea S.A.', 7000, true, false],
  ['REPRESENTANTE', 'Consolidadora Ltda', 20000, true, false],
], 'prévia: uma nota ao pagante (os 2 produtos), ao fornecedor e ao representante; e-mail só ao cliente');
eq(previa1.notas[0].itens.map(i => [i.produto_id, i.valor_centavos]), [['p-aereo', 7000], ['p-hotel', 15000]], 'a nota ao pagante junta os produtos das duas regras (mesmo tomador e gatilho)');
r = await json(await rotaGerar.POST(pedir('POST', '/api/fiscal/gerar', { selecao: [{ venda_id: 'v-nova' }], assinatura: 'velha' })));
eq([r.status, r.corpo.codigo, r.corpo.detalhes.assinatura === previa1.assinatura], [409, 'PREVIA_MUDOU', true], 'assinatura diferente: não emite e devolve a prévia nova');
r = await json(await rotaGerar.POST(pedir('POST', '/api/fiscal/gerar', { selecao: [{ venda_id: 'v-nova' }] })));
eq([r.status, r.corpo.codigo], [400, 'SEM_PREVIA'], 'sem prévia não emite');
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
r = await json(await rotaGerar.POST(pedir('POST', '/api/fiscal/gerar', { selecao: [{ venda_id: 'v-nova' }], assinatura: previa1.assinatura })));
eq(r.status, 403, 'sem o direito de emitir: 403');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
r = await json(await rotaGerar.POST(pedir('POST', '/api/fiscal/gerar', { selecao: [{ venda_id: 'v-nova' }], assinatura: previa1.assinatura })));
eq([r.status, r.corpo.emitidas.map(n => [n.status, n.destino, n.valor_servicos, n.enviar_email]), r.corpo.recusadas], [200, [
  ['AUTORIZADA', 'PAGANTE', 220, true], ['AUTORIZADA', 'FORNECEDOR', 70, false], ['AUTORIZADA', 'REPRESENTANTE', 200, false],
], []], 'emitidas as 3 notas (emissor simulado)');
const gravada = (await um(`SELECT data FROM notas_fiscais WHERE tenant_id = $1 AND data->>'destino' = 'FORNECEDOR' AND venda_id = 'v-nova'`, [T])).data;
eq([gravada.origem, gravada.chave_geracao, gravada.itens.map(i => [i.produto_id, i.valor_centavos]), gravada.cst, gravada.ibs_cbs.situacao, gravada.conta_receber_id],
  ['REGRA', 'v-nova|FORNECEDOR|f-cia|1', [['p-aereo', 7000]], '410', 'CONFIRMAR_COM_O_CONTADOR', ''], 'nota gravada com a regra, a chave, os produtos e o IBS/CBS a confirmar com o contador');
r = await json(await rotaGerar.GET(pedir('GET', '/api/fiscal/gerar?de=2026-11-01&ate=2026-11-30')));
eq(r.corpo.linhas.map(l => [l.valor_notas, l.saldo, l.situacao]), [[14000, 0, 'EMITIDA'], [35000, 0, 'EMITIDA']], 'grade depois: tudo em nota, saldo zero');
r = await json(await rotaPrevia.POST(pedir('POST', '/api/fiscal/gerar/previa', { selecao: [{ venda_id: 'v-nova' }] })));
eq(r.corpo.notas.length, 0, 'nada a emitir de novo');
r = await json(await rotaGerar.POST(pedir('POST', '/api/fiscal/gerar', { selecao: [{ venda_id: 'v-nova' }], assinatura: previa1.assinatura })));
eq([r.status, r.corpo.codigo], [409, 'PREVIA_MUDOU'], 'repetir a emissão antiga: recusada (nada sai duas vezes)');
erro = await query(`INSERT INTO notas_fiscais (id, tenant_id, venda_id, status, data) VALUES ('dup', $1, 'v-nova', 'AUTORIZADA', $2)`, [T, { chave_geracao: 'v-nova|FORNECEDOR|f-cia|1' }]).then(() => null, e => e.code);
eq(erro, '23505', 'a chave da geração é única entre as notas vivas (o banco garante)');

console.log('--- (f) Complementar ---');
const maior = vendaBase();
maior.produtos[0].componentes.push({ id: 'c-rav2', tipo: 'RAV', valor_centavos: 2500, percentual: null, passageiro_id: null, descricao: '' });
maior.pagamentos[0].valor_centavos += 2500;
await gravar(maior);
r = await json(await rotaGerar.GET(pedir('GET', '/api/fiscal/gerar?de=2026-11-01&ate=2026-11-30&pendentes=1')));
eq(r.corpo.linhas.map(l => [l.produto_id, l.saldo, l.situacao]), [['p-aereo', 2500, 'COMPLEMENTAR']], 'receita cresceu: complementar sugerida (filtro de pendentes)');
r = await json(await rotaPrevia.POST(pedir('POST', '/api/fiscal/gerar/previa', { selecao: [{ venda_id: 'v-nova', produto_ids: ['p-aereo'] }] })));
eq(r.corpo.notas.map(n => [n.destino, n.valor_centavos, n.complementar, n.complementar_de.length, n.chave]), [['PAGANTE', 2500, true, 1, 'v-nova|PAGANTE|cli-1|2']], 'prévia da complementar');
r = await json(await rotaGerar.POST(pedir('POST', '/api/fiscal/gerar', { selecao: [{ venda_id: 'v-nova', produto_ids: ['p-aereo'] }], assinatura: r.corpo.assinatura })));
eq(r.corpo.emitidas.map(n => [n.valor_servicos, n.complementar_de.length, /^Nota complementar/.test(n.discriminacao)]), [[25, 1, true]], 'complementar emitida e marcada');

console.log('--- (g) Retenções na fonte (Lei 9.430) ---');
r = await json(await rotaRetencoes.POST(pedir('POST', '/api/fiscal/retencoes', { cliente: { id: 'cli-1', nome: 'Prefeitura de Exemplo' }, tipo_produto: 'AEREO', nacional: { DU_RAV: { IR: 1.5, CSLL: 1 }, VALOR: { IR: 1.2 } } })));
eq(r.status, 201, 'retenção cadastrada para cliente × produto');
const idRet = r.corpo.id;
r = await json(await rotaRetencoes.POST(pedir('POST', '/api/fiscal/retencoes', { cliente: { id: 'cli-1', nome: 'x' }, tipo_produto: 'AEREO' })));
eq([r.status, r.corpo.codigo], [409, 'REPETIDA'], 'a mesma combinação não se repete');
r = await json(await rotaRetencoes.POST(pedir('POST', '/api/fiscal/retencoes', { cliente: { id: 'cli-1' }, tipo_produto: 'SEGURO', nacional: { VALOR: { PIS: -1 } } })));
eq(r.status, 400, 'percentual negativo: recusado');
const comRet = normalizarVenda({ ...JSON.parse(JSON.stringify(maior)), id: 'v-ret', produtos: [{ ...JSON.parse(JSON.stringify(maior.produtos[0])), id: 'p-ar2' }], pagamentos: [{ id: 'pg-pix', forma: 'PIX', valor_centavos: 119500 }] }).venda;
await gravar(comRet);
const crRet = (await todos(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = 'v-ret' AND data->>'origem' = 'VENDA'`, [T])).map(x => x.data);
// Bases: valor 100000 × 1,2% = 1200; DU/RAV 9500 × 1,5% = 143 (142,5) e × 1% = 95.
eq(crRet.map(c => [c.valor_final, c.retencao_na_fonte.valor_bruto, c.retencao_na_fonte.IR, c.retencao_na_fonte.CSLL]), [[1195 - 14.38, 1195, 13.43, 0.95]], 'conta a receber líquida: bruto, IR e CSLL retidos');
r = await json(await rotaPrevia.POST(pedir('POST', '/api/fiscal/gerar/previa', { selecao: [{ venda_id: 'v-ret' }] })));
const pagante = r.corpo.notas.find(n => n.destino === 'PAGANTE');
eq([pagante.valor_centavos, pagante.retencoes.por_tributo, pagante.valida], [9500, { IR: 143, CSLL: 95, PIS: 0, COFINS: 0 }, true], 'nota ao pagante: retenção só sobre o que ela cobra (DU/RAV)');
r = await json(await rotaGerar.POST(pedir('POST', '/api/fiscal/gerar', { selecao: [{ venda_id: 'v-ret' }], assinatura: r.corpo.assinatura })));
const notaRet = r.corpo.emitidas.find(n => n.destino === 'PAGANTE');
eq([notaRet.valor_ir_retido, notaRet.valor_csll_retido, notaRet.total_retido, notaRet.valor_liquido], [1.43, 0.95, 2.38, 92.62], 'a nota declara IR e CSLL retidos e o líquido');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', T2);
r = await json(await rotaRetencao.DELETE(pedir('DELETE', `/api/fiscal/retencoes/${idRet}`), params(idRet)));
eq(r.status, 404, 'outra agência não apaga a retenção');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');

console.log('--- (h) Gatilhos pela fila ---');
r = await json(await rotaRegra.PUT(pedir('PUT', `/api/fiscal/regras/${idGeral}`, {
  ...regraGeral,
  destinos: { ...regraGeral.destinos, PAGANTE: { ...regraGeral.destinos.PAGANTE, gatilho: 'AO_RECEBER' }, FORNECEDOR: { ...regraGeral.destinos.FORNECEDOR, gatilho: 'AO_RECEBER_COMISSAO' } },
}), params(idGeral)));
eq([r.status, r.corpo.destinos.PAGANTE.gatilho], [200, 'AO_RECEBER'], 'gatilhos na regra');
const vGat = normalizarVenda({ ...JSON.parse(JSON.stringify(vendaBase())), id: 'v-gat', produtos: [vendaBase().produtos[0]], pagamentos: [{ id: 'pg', forma: 'PIX', valor_centavos: 117000 }] }).venda;
await gravar(vGat);
const tarefa = notas.tarefaNotasPorGatilho;
const ctxTarefa = { exec: pool, emTransacao, agora: new Date(), restanteMs: () => 30000 };
eq((await tarefa.agencias(ctxTarefa)).includes(T), true, 'a tarefa atende a agência com gatilho nas regras');
await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || '{"status":"RECEBIDO"}', updated_at = NOW() WHERE tenant_id = $1 AND data->>'origem_venda_id' = 'v-gat' AND data->>'origem' = 'VENDA'`, [T]);
let res = await tarefa.executar(ctxTarefa, T);
eq(res, { na_fila: 0, motivo: 'emissão automática desligada' }, 'automático desligado: nada entra na fila');
r = await json(await rotaConfig.PUT(pedir('PUT', '/api/fiscal/notas-config', { automatico: true, enviar_ao_cliente: true })));
eq({ automatico: r.corpo.automatico, enviar_ao_cliente: r.corpo.enviar_ao_cliente }, { automatico: true, enviar_ao_cliente: true }, 'emissão automática ligada');
// E7: os campos novos chegam com o padrão de antes (data do dia, sem dispensa, sem tributos aproximados).
eq([r.corpo.data_da_nota, r.corpo.retencao_minima, r.corpo.tributos_aproximados.ligado], ['DIA', { ir_centavos: null, csll_pis_cofins_centavos: null }, false], 'configuração nova com o padrão de antes');
res = await comNadaSai('ensaio da mudança', () => tarefa.executar(ctxTarefa, T));
eq(res.na_fila, 0, '"nada sai": a tarefa não põe nota na fila');
erro = await comNadaSai('ensaio', () => notas.emitirNotasDaRegra(pool, T, { selecao: [{ venda_id: 'v-gat' }] }, { id: '', nome: '' })).then(() => null, e => e.codigo);
eq(erro, 'NADA_SAI', '"nada sai": a emissão pela tela também segura');
res = await tarefa.executar(ctxTarefa, T);
eq(res.na_fila >= 1, true, 'cliente quitado: a nota ao pagante entra na fila');
let naFila = await todos(`SELECT chave_idem, status FROM tarefas WHERE tenant_id = $1 AND tipo = $2 ORDER BY chave_idem`, [T, notas.TAREFA_NOTA_POR_GATILHO]);
eq(naFila.filter(x => x.chave_idem.startsWith('v-gat')).map(x => x.chave_idem), ['v-gat|PAGANTE|cli-1|1'], 'só a nota ao pagante (a comissão ainda não foi recebida)');
res = await tarefa.executar(ctxTarefa, T);
eq((await todos(`SELECT 1 FROM tarefas WHERE tenant_id = $1 AND chave_idem LIKE 'v-gat%'`, [T])).length, 1, 'rodar de novo não duplica a tarefa');
// Mudança de sistema em andamento: o processador adia (não gasta tentativa).
await query(`INSERT INTO migracao_lotes (id, tenant_id, status) VALUES ('lote1', $1, 'aplicando')`, [T]).catch(async () => {
  await query(`INSERT INTO migracao_lotes (id, tenant_id, status, data) VALUES ('lote1', $1, 'aplicando', '{}')`, [T]);
});
fila.registrarProcessador(notas.TAREFA_NOTA_POR_GATILHO, notas.processarNotaPorGatilho);
let rodada = await fila.processarFila(pool, { orcamentoMs: 5000 });
eq([rodada.adiadas, (await um(`SELECT COUNT(*)::int n FROM notas_fiscais WHERE tenant_id = $1 AND venda_id = 'v-gat'`, [T])).n], [1, 0], 'mudança de sistema em andamento: adiada, nenhuma nota');
await query(`DELETE FROM migracao_lotes WHERE id = 'lote1'`);
await query(`UPDATE tarefas SET proxima_em = NOW() - INTERVAL '1 second' WHERE tenant_id = $1`, [T]);
rodada = await fila.processarFila(pool, { orcamentoMs: 5000 });
const notaGat = (await um(`SELECT data FROM notas_fiscais WHERE tenant_id = $1 AND venda_id = 'v-gat'`, [T])).data;
eq([rodada.processadas, notaGat.status, notaGat.gatilho, notaGat.destino, notaGat.enviar_email, notaGat.emitida_por], [1, 'AUTORIZADA', 'AO_RECEBER', 'PAGANTE', true, 'Emissão automática'], 'ao receber: a fila emitiu a nota ao pagante e pediu o envio ao cliente');
// Comissão acertada: a agência pagou a cia (ou recebeu a comissão).
await query(`INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, updated_at) VALUES ('com-gat', $1, 'v-gat', 'f-cia', 'RECEBIDO', $2, NOW())`, [T, { id: 'com-gat', origem: 'COMISSAO_FORNECEDOR', origem_venda_id: 'v-gat', venda_parte_id: 'f-cia', cliente_id: 'f-cia', status: 'RECEBIDO', valor_final: 70 }]);
await tarefa.executar(ctxTarefa, T);
rodada = await fila.processarFila(pool, { orcamentoMs: 5000 });
const destinosGat = (await todos(`SELECT data->>'destino' d, data->>'gatilho' g FROM notas_fiscais WHERE tenant_id = $1 AND venda_id = 'v-gat' ORDER BY 1`, [T])).map(x => [x.d, x.g]);
eq(destinosGat, [['FORNECEDOR', 'AO_RECEBER_COMISSAO'], ['PAGANTE', 'AO_RECEBER']], 'ao receber a comissão: a nota ao fornecedor sai pela fila');
// Ao fechar a fatura (a parte B chama aoFecharFatura).
await query(`UPDATE nota_regras SET data = jsonb_set(data, '{destinos,PAGANTE,gatilho}', '"AO_FECHAR_FATURA"') WHERE id = $1`, [idHotel]);
const vFat = normalizarVenda({ ...JSON.parse(JSON.stringify(vendaBase())), id: 'v-fat', produtos: [vendaBase().produtos[1]], pagamentos: [{ id: 'pf', forma: 'FATURAR', valor_centavos: 215000 }] }).venda;
await gravar(vFat);
eq(await notas.aoFecharFatura(pool, T, ['v-fat']), 1, 'fatura fechada: a nota ao pagante entra na fila');
await fila.processarFila(pool, { orcamentoMs: 5000 });
const notaFat = (await um(`SELECT data FROM notas_fiscais WHERE tenant_id = $1 AND venda_id = 'v-fat' AND data->>'destino' = 'PAGANTE'`, [T]))?.data;
eq([notaFat?.gatilho, notaFat?.valor_servicos], ['AO_FECHAR_FATURA', 150], 'ao fechar a fatura: emitida');

console.log('--- (i) Cancelamento sugerido ---');
await query(`UPDATE vendas_crm SET status = 'CANCELADO', data = data || '{"status":"CANCELADO"}' WHERE id = 'v-gat'`);
r = await json(await rotaGerar.GET(pedir('GET', '/api/fiscal/gerar?de=2026-11-01&ate=2026-11-30')));
const sug = r.corpo.cancelar.filter(c => c.venda_id === 'v-gat');
eq([sug.length, sug.every(s => /venda foi cancelada/.test(s.motivo))], [2, true], 'venda cancelada: as 2 notas aparecem para cancelar');
eq((await todos(`SELECT status FROM notas_fiscais WHERE tenant_id = $1 AND venda_id = 'v-gat'`, [T])).map(x => x.status), ['AUTORIZADA', 'AUTORIZADA'], 'nada foi cancelado sozinho');

console.log('--- (j) Isolamento ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', T2);
r = await json(await rotaGerar.GET(pedir('GET', '/api/fiscal/gerar?de=2026-01-01&ate=2026-12-31')));
eq([r.corpo.linhas.length, r.corpo.cancelar.length, r.corpo.tem_regras], [0, 0, false], 'outra agência não vê vendas, notas nem regras');
r = await json(await rotaRegra.PUT(pedir('PUT', `/api/fiscal/regras/${idGeral}`, regraGeral), params(idGeral)));
eq(r.status, 404, 'outra agência não altera a regra');
r = await json(await rotaRegra.DELETE(pedir('DELETE', `/api/fiscal/regras/${idGeral}`), params(idGeral)));
eq(r.status, 404, 'outra agência não apaga a regra');
r = await json(await rotaPrevia.POST(pedir('POST', '/api/fiscal/gerar/previa', { selecao: [{ venda_id: 'v-nova' }] })));
eq(r.corpo.notas.length, 0, 'prévia com id de venda de outra agência: nada');
eq((await notas.notasDaVenda(pool, T2, 'v-nova')).length, 0, 'notas da venda só da própria agência');
r = await json(await rotaRetencoes.GET(pedir('GET', '/api/fiscal/retencoes')));
eq(r.corpo.retencoes.length, 0, 'retenções só da própria agência');
globalThis.__SESSAO_DE_TESTE__ = null;

console.log(`\n${total - falhas}/${total} testes passaram`);
if (falhas) process.exit(1);
