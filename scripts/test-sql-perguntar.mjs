/**
 * "Perguntar em texto" (E7, fechamento) contra um Postgres real (PGlite).
 *
 * Parte A — cada FERRAMENTA FIXA rodando no banco, com os direitos de quem
 * pergunta:
 *   contas_a_pagar_e_receber  totais por pessoa e período; conta bancária não
 *                             liberada esconde o que foi baixado nela; link
 *                             com o filtro; parâmetro inválido vira recusa
 *   cobrancas                 pela situação da cobrança
 *   saldos_das_contas         só as contas liberadas e ativas, por moeda; com
 *                             período, o que entrou e saiu
 *   resultado_do_mes          o mesmo número do cálculo da tela (montarDRE)
 *   vendas_agrupadas          por vendedor; só as próprias vendas; receita
 *                             só com o direito; filtro de fornecedor
 *   e sem o direito, cada uma RECUSA sem número.
 *
 * Parte B — a ROTA com a IA dublada (o `fetch` global responde no lugar da
 * Anthropic): guardas, sem chave (a caixa explica como ligar), a resposta
 * com número/filtro/link, pergunta pedindo dado sem direito recusada, o
 * limite por agência e o registro das perguntas.
 *
 * Uso: node --no-warnings scripts/test-sql-perguntar.mjs
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
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE membros (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE config_apis (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT NOT NULL DEFAULT '', acao TEXT NOT NULL DEFAULT '', modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '', entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const exec = { query };
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

const { VENDA_SCHEMA_SQL } = await import('../src/lib/venda-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { PERGUNTAS_IA_SCHEMA_SQL, LIMITE_DE_PERGUNTAS_POR_DIA } = await import('../src/lib/perguntar/uso.ts');
for (const sql of [BAIXAS_SCHEMA_SQL, PERIODO_SCHEMA_SQL, COBRANCA_SCHEMA_SQL, PERMISSOES_SCHEMA_SQL, VENDA_SCHEMA_SQL, RAZAO_SCHEMA_SQL, PERGUNTAS_IA_SCHEMA_SQL, PERGUNTAS_IA_SCHEMA_SQL]) await pg.exec(sql);

const { executarFerramenta } = await import('../src/lib/perguntar/ferramentas.ts');
const { montarDRE, comissaoNaoCapturadaPorConta } = await import('../src/lib/resultado-dre.ts');
const { salvarVenda } = await import('../src/lib/venda-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { normalizarVenda } = await import('../src/lib/venda-modelo.ts');
const { hojeISO } = await import('../src/lib/money.ts');
const { invalidarPermissoes } = await import('../src/lib/permissoes-servidor.ts');
const rota = await import('../src/app/api/perguntar/route.ts');

const T = 'perg-t1', T2 = 'perg-t2';
const HOJE = '2026-11-06';
const inserir = (tabela, id, t, data, extra = {}) => {
  const cols = ['id', 'tenant_id', 'data', ...Object.keys(extra)];
  const vals = [id, t, JSON.stringify({ id, ...data }), ...Object.values(extra)];
  return query(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
};
const DIREITOS_TODOS = { verFinanceiro: true, verSaldos: true, relatorios: true, verReceita: true, vendedorId: null, contasLiberadas: null, empresas: null };
const ctx = (direitos = {}, tenantId = T, hoje = HOJE) => ({ exec, tenantId, hoje, direitos: { ...DIREITOS_TODOS, ...direitos } });
const rodar = (nome, entrada, direitos, tenantId) => executarFerramenta(ctx(direitos, tenantId), nome, entrada);
const num = (r, rotulo) => r.numeros.find(n => n.rotulo === rotulo)?.valor;

// --- Dados ----------------------------------------------------------------------
await inserir('contas_bancarias', 'cb1', T, { nome: 'Itaú', saldo_atual: 1000, ativo: true }, { nome: 'Itaú' });
await inserir('contas_bancarias', 'cb2', T, { nome: 'Bradesco', saldo_atual: 500.5, ativo: true }, { nome: 'Bradesco' });
await inserir('contas_bancarias', 'cb3', T, { nome: 'Conta em dólar', saldo_atual: 100, moeda: 'USD', ativo: true }, { nome: 'Conta em dólar' });
await inserir('contas_bancarias', 'cb4', T, { nome: 'Antiga', saldo_atual: 999, ativo: false }, { nome: 'Antiga' });
await inserir('contas_bancarias', 'cbx', T2, { nome: 'Da outra', saldo_atual: 77777 }, { nome: 'Da outra' });
await inserir('plano_contas', 'cat-desp', T, { codigo: '2.2.01', nome: 'Aluguel', tipo: 'DESPESA', ativo: true }, { codigo: '2.2.01', tipo: 'despesa' });
// A receber
await inserir('contas_receber', 'cr1', T, { descricao: 'Comissão Chile', cliente_nome: 'Sol Operadora', valor_final: 1000, status: 'PENDENTE', data_vencimento: '2026-11-20', origem: 'COMISSAO_FORNECEDOR' });
await inserir('contas_receber', 'cr2', T, { descricao: 'Comissão Peru', cliente_nome: 'Sol Operadora', valor_final: 400, status: 'PENDENTE', data_vencimento: '2026-11-02', origem: 'COMISSAO_FORNECEDOR' });
await inserir('contas_receber', 'cr3', T, { descricao: 'Comissão antiga', cliente_nome: 'Sol Operadora', valor_final: 250, status: 'PENDENTE', data_vencimento: '2026-10-10', origem: 'COMISSAO_FORNECEDOR' });
await inserir('contas_receber', 'cr4', T, { descricao: 'Fee consultoria', cliente_nome: 'Lua Viagens', valor_final: 800, valor_recebido: 800, status: 'RECEBIDO', data_vencimento: '2026-11-03', data_recebimento: '2026-11-03', conta_bancaria_id: 'cb2', origem: 'FEE' });
await inserir('contas_receber', 'cr5', T, { descricao: 'Fee recebido no Itaú', cliente_nome: 'Lua Viagens', valor_final: 300, valor_recebido: 300, status: 'RECEBIDO', data_vencimento: '2026-11-04', data_recebimento: '2026-11-04', conta_bancaria_id: 'cb1', origem: 'FEE' });
await inserir('contas_receber', 'crx', T2, { descricao: 'De outra agência', cliente_nome: 'Sol Operadora', valor_final: 99999, status: 'PENDENTE', data_vencimento: '2026-11-20' });
// A pagar
await inserir('contas_pagar', 'cp1', T, { descricao: 'Aluguel novembro', fornecedor_nome: 'Imobiliária', valor_final: 350, status: 'PENDENTE', data_vencimento: '2026-11-10', categoria_id: 'cat-desp' });
await inserir('contas_pagar', 'cp2', T, { descricao: 'Internet', fornecedor_nome: 'Provedor', valor_final: 120, valor_pago: 120, status: 'PAGO', data_vencimento: '2026-11-05', data_pagamento: '2026-11-05', conta_bancaria_id: 'cb1', categoria_id: 'cat-desp' });
// Cobranças: cr1 com boleto emitido.
await query(`INSERT INTO cobrancas (id, tenant_id, titulo_tabela, titulo_id, provedor, referencia, tipo, status, valor_centavos, vencimento)
             VALUES ('cob1', $1, 'contas_receber', 'cr1', 'asaas', 'ref-1', 'boleto', 'aberta', 100000, '2026-11-20')`, [T]);

// Vendas (o caminho de sempre).
const venda = (id, vendedor, fornecedor, valor, comissao) => normalizarVenda({
  id, data_venda: '2026-10-15', cliente: { id: 'cli-1', nome: 'Carla' }, vendedor,
  produtos: [{ tipo: 'HOSPEDAGEM', descricao: 'Hotel', fornecedor, quantidade: 1, valor_unitario_centavos: valor, componentes: [{ tipo: 'COMISSAO', valor_centavos: comissao }] }],
  pagamentos: [{ forma: 'PIX', valor_centavos: valor }],
}).venda;
await emTransacao(e => salvarVenda(e, T, venda('v1', { id: 'u-ana', nome: 'Ana' }, { id: 'f1', nome: 'Hotel Mar' }, 100000, 10000), { usuario: null, origem: 'manual' }));
await emTransacao(e => salvarVenda(e, T, venda('v2', { id: 'u-bia', nome: 'Bia' }, { id: 'f2', nome: 'Cia Azul' }, 300000, 15000), { usuario: null, origem: 'manual' }));
await emTransacao(e => salvarVenda(e, T, venda('v3', { id: 'u-ana', nome: 'Ana' }, { id: 'f2', nome: 'Cia Azul' }, 50000, 5000), { usuario: null, origem: 'manual' }));

try {
  console.log('--- A1. Contas a pagar e a receber ---');
  let r = await rodar('contas_a_pagar_e_receber', { tipo: 'receber', situacao: 'em_aberto', data: 'vencimento', de: '2026-11-01', ate: '2026-11-30', pessoa: 'sol operadora' });
  eq([num(r, 'Em aberto a receber'), num(r, 'Em atraso a receber'), num(r, 'Contas a receber')], [1400, 400, 2],
    'a receber da Sol neste mês: aberto (com o atrasado), atrasado e quantidade; outra agência fora');
  eq(r.filtro, ['A receber', 'Em aberto (inclui atrasadas)', 'Vencimento de 01/11/2026 a 30/11/2026', 'Pessoa contém "sol operadora"'], 'filtro por extenso');
  eq(r.link, '/financeiro-ag/contas?tipo=receber&situacao=em_aberto&data=vencimento&de=2026-11-01&ate=2026-11-30&busca=sol+operadora&em=pessoa', 'link para a lista com o filtro');
  eq(r.linhas.map(l => l.valor), [400, 1000], 'linhas do filtro, pelo vencimento');
  r = await rodar('contas_a_pagar_e_receber', { tipo: 'ambos', situacao: 'em_aberto', data: 'vencimento', de: '2026-11-02', ate: '2026-11-08' });
  eq([num(r, 'Em aberto a receber'), num(r, 'Em aberto a pagar')], [400, 0], 'contas que vencem na semana: a receber e a pagar');
  r = await rodar('contas_a_pagar_e_receber', { tipo: 'receber', situacao: 'liquidado', data: 'liquidacao', de: '2026-11-01', ate: '2026-11-30' });
  eq(num(r, 'Já recebido'), 1100, 'recebido no mês, todas as contas bancárias');
  r = await rodar('contas_a_pagar_e_receber', { tipo: 'receber', situacao: 'liquidado', data: 'liquidacao', de: '2026-11-01', ate: '2026-11-30' }, { contasLiberadas: ['cb1'] });
  eq([num(r, 'Já recebido'), r.filtro.includes('Só as contas bancárias liberadas para você')], [300, true], 'recebido em conta não liberada fica fora');
  r = await rodar('contas_a_pagar_e_receber', { tipo: 'receber', situacao: 'em_aberto', data: 'vencimento', de: '2026-13-01' });
  eq([Boolean(r.recusado), r.numeros.length, r.recusado], [true, 0, 'Data inicial inválida: use AAAA-MM-DD.'], 'data inválida: recusa com a frase para corrigir');
  r = await rodar('contas_a_pagar_e_receber', { tipo: 'tudo', situacao: 'em_aberto', data: 'vencimento' });
  eq(Boolean(r.recusado), true, 'tipo fora da lista: recusa');
  r = await rodar('contas_a_pagar_e_receber', { tipo: 'receber', situacao: 'em_aberto', data: 'vencimento' }, { verFinanceiro: false });
  eq([r.recusado, r.numeros, r.linhas, r.link], ['Seu acesso não inclui o financeiro (contas a pagar e a receber).', [], [], null], 'sem o financeiro: recusa sem número');

  console.log('--- A2. Cobranças ---');
  r = await rodar('cobrancas', { situacao_cobranca: 'emitida' });
  eq([num(r, 'Em aberto'), num(r, 'Contas'), r.link], [1000, 1, '/financeiro-ag/contas?tipo=receber&situacao=todas&data=vencimento&cobranca=emitida'], 'boleto emitido aguardando');
  r = await rodar('cobrancas', { situacao_cobranca: 'sem_boleto' });
  // cr2, cr3 e as três contas do Pix das vendas; a cr1 tem boleto, a da outra agência não entra.
  eq(num(r, 'Contas'), 5, 'em aberto sem boleto');
  eq(Boolean((await rodar('cobrancas', { situacao_cobranca: 'vencida' }, { verFinanceiro: false })).recusado), true, 'sem financeiro: recusa');

  console.log('--- A3. Saldos ---');
  r = await rodar('saldos_das_contas', {});
  eq([num(r, 'Saldo somado em reais'), num(r, 'Saldo somado em USD'), num(r, 'Contas bancárias')], [1500.5, 100, 3], 'saldos por moeda, sem a desativada nem a de outra agência');
  eq(r.linhas.map(l => l.texto), ['Bradesco', 'Conta em dólar', 'Itaú'], 'cada conta');
  r = await rodar('saldos_das_contas', {}, { contasLiberadas: ['cb1'] });
  eq([num(r, 'Saldo somado em reais'), num(r, 'Contas bancárias')], [1000, 1], 'só as contas liberadas');
  r = await rodar('saldos_das_contas', { conta: 'itaú', de: '2026-11-01', ate: '2026-11-30' });
  eq([num(r, 'Entrou no período (contas recebidas)'), num(r, 'Saiu no período (contas pagas)')], [300, 120], 'com período: o que entrou e saiu na conta');
  eq(r.link, '/financeiro-ag/contas?tipo=ambos&situacao=todas&data=liquidacao&de=2026-11-01&ate=2026-11-30&conta=cb1', 'link para o movimento da conta');
  r = await rodar('saldos_das_contas', {}, { verSaldos: false });
  eq([r.recusado, r.numeros.length], ['Seu acesso não inclui ver o saldo das contas bancárias.', 0], 'sem o direito de ver saldo: recusa');

  console.log('--- A4. Resultado do mês ---');
  r = await rodar('resultado_do_mes', { mes: '2026-11' });
  const ler = async (t) => (await query(`SELECT data FROM ${t} WHERE tenant_id = $1`, [T])).rows.map(x => x.data);
  const [cr, cp, pc] = [await ler('contas_receber'), await ler('contas_pagar'), await ler('plano_contas')];
  const linhasTela = montarDRE({ receber: cr, pagar: cp, vendasComLastro: [], planoContas: pc, comissaoNaoCapturada: comissaoNaoCapturadaPorConta(cr, []), mes: '2026-11' });
  const daTela = (nome) => Math.round(linhasTela.find(l => l.nome === nome || l.nome.startsWith(nome)).valor * 100) / 100;
  eq([num(r, 'Receita bruta'), num(r, 'Lucro líquido')], [daTela('RECEITA BRUTA'), daTela('LUCRO LÍQUIDO')], 'o mesmo número do cálculo da tela');
  eq([num(r, 'Receita bruta') > 0, r.link, r.filtro[0]], [true, '/financeiro-ag/dre?mes=2026-11', 'Mês 11/2026'], 'receita do mês, link para a DRE do mês');
  eq(Boolean((await rodar('resultado_do_mes', { mes: '2026-11' }, { relatorios: false })).recusado), true, 'sem relatórios: recusa');
  eq((await rodar('resultado_do_mes', { mes: 'novembro' })).recusado, 'Mês inválido: use AAAA-MM.', 'mês inválido: recusa');

  console.log('--- A5. Vendas ---');
  r = await rodar('vendas_agrupadas', { agrupar_por: 'vendedor', medida: 'faturamento', de: '2026-10-01', ate: '2026-10-31' });
  eq([num(r, 'Faturamento'), num(r, 'Vendas'), r.linhas.map(l => [l.texto, l.valor])], [4500, 3, [['Bia · 1 venda', 3000], ['Ana · 2 vendas', 1500]]], 'faturamento de outubro por vendedor');
  eq(num(r, 'Receita da agência'), 300, 'com o direito: a receita da agência');
  eq(r.link.startsWith('/relatorios/vendas?relatorio=vendedor&de=2026-10-01&ate=2026-10-31'), true, 'link para o relatório com o filtro');
  r = await rodar('vendas_agrupadas', { agrupar_por: 'vendedor', medida: 'receita', de: '2026-10-01', ate: '2026-10-31' });
  eq(r.linhas.map(l => [l.texto, l.valor]).sort(), [['Ana · 2 vendas', 150], ['Bia · 1 venda', 150]], 'receita de outubro por vendedor');
  r = await rodar('vendas_agrupadas', { agrupar_por: 'vendedor', medida: 'receita', de: '2026-10-01', ate: '2026-10-31' }, { verReceita: false });
  eq([r.recusado, r.numeros.length], ['Seu acesso não inclui ver o ganho da agência nas vendas.', 0], 'receita sem o direito: recusa');
  r = await rodar('vendas_agrupadas', { agrupar_por: 'vendedor', medida: 'faturamento' }, { verReceita: false });
  eq([num(r, 'Receita da agência'), num(r, 'Faturamento')], [undefined, 4500], 'faturamento sem o direito: sai, sem a receita');
  r = await rodar('vendas_agrupadas', { agrupar_por: 'fornecedor', medida: 'faturamento' }, { vendedorId: 'u-ana' });
  eq([num(r, 'Faturamento'), r.filtro.includes('Só as suas vendas')], [1500, true], 'quem não vê a equipe: só as próprias vendas');
  r = await rodar('vendas_agrupadas', { agrupar_por: 'vendedor', medida: 'faturamento', fornecedor: 'azul' });
  eq([num(r, 'Faturamento'), r.filtro.includes('Fornecedor: Cia Azul')], [3500, true], 'filtro pelo nome do fornecedor');
  eq(Boolean((await rodar('vendas_agrupadas', { agrupar_por: 'vendedor', medida: 'faturamento', fornecedor: 'inexistente' })).recusado), true, 'fornecedor que não existe: recusa');
  eq(Boolean((await rodar('vendas_agrupadas', { agrupar_por: 'vendedor', medida: 'faturamento' }, { relatorios: false })).recusado), true, 'sem relatórios: recusa');

  console.log('--- A6. Consulta fora da lista ---');
  r = await executarFerramenta(ctx(), 'executar_sql', { sql: 'SELECT * FROM contas_receber' });
  eq([Boolean(r.recusado), r.numeros.length], [true, 0], 'nome fora da lista: recusa, nada roda');

  // =========================================================================
  console.log('--- B. A rota com a IA dublada ---');
  const MES = hojeISO().slice(0, 7);
  let chamadas = [];
  let roteiro = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error(`rede bloqueada no teste: ${url}`);
    const corpo = JSON.parse(init.body);
    chamadas.push({ chave: init.headers['x-api-key'], corpo });
    const r0 = roteiro.shift() ?? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    const status = r0.__status ?? 200;
    return new Response(JSON.stringify({ model: 'claude-opus-5-5', ...r0 }), { status, headers: { 'content-type': 'application/json' } });
  };
  const usa = (id, name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
  const texto = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
  const sessao = (perfil, userId = `u-${perfil}`, tenantId = T) => ({ userId, nome: `Pessoa ${perfil}`, email: '', perfil, permissoes: {}, tenantId, tenantSlug: tenantId });
  const como = (...a) => { globalThis.__SESSAO_DE_TESTE__ = sessao(...a); };
  const perguntar = async (pergunta) => {
    const res = await rota.POST(new Request('http://localhost/api/perguntar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pergunta }) }));
    return { status: res.status, corpo: await res.json() };
  };
  const estado = async () => (await rota.GET()).json();

  globalThis.__SESSAO_DE_TESTE__ = null;
  eq((await perguntar('quanto tenho a receber?')).status, 401, 'sem login: 401');
  como('VENDEDOR');
  let p = await perguntar('quanto tenho a receber?');
  eq([p.status, p.corpo.codigo, chamadas.length], [403, 'SEM_DIREITO', 0], 'perfil sem financeiro nem relatórios: recusado antes da IA');
  como('OPERADOR');
  eq((await perguntar('oi')).status, 400, 'pergunta curta demais');
  p = await perguntar('quanto tenho a receber da Sol este mês?');
  eq([p.status, p.corpo.codigo, chamadas.length, p.corpo.error.includes('Configurações › Integrações › IA')], [400, 'sem_chave_ia', 0, true], 'sem chave: a caixa explica como ligar, IA não chamada');
  let st = await estado();
  eq([st.chave_ligada, st.pode_perguntar, st.uso.usados], [false, true, 0], 'GET: chave desligada, pode perguntar, nada usado');
  await query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ('apis-config-singleton', $1, $2)`, [T, JSON.stringify({ anthropic: { ativo: true, api_key: 'sk-perg' } })]);

  // Uma pergunta respondida.
  roteiro = [
    usa('t1', 'contas_a_pagar_e_receber', { tipo: 'receber', situacao: 'em_aberto', data: 'vencimento', pessoa: 'Sol' }),
    texto('Você tem R$ 1.650,00 a receber da Sol Operadora em aberto.'),
  ];
  p = await perguntar('quanto tenho a receber da Sol?');
  eq([p.status, p.corpo.texto], [200, 'Você tem R$ 1.650,00 a receber da Sol Operadora em aberto.'], 'resposta da IA');
  const card = p.corpo.resultados[0];
  eq([card.titulo, card.numeros.find(n => n.rotulo === 'Em aberto a receber').valor, card.link.startsWith('/financeiro-ag/contas?tipo=receber')], ['Contas a pagar e a receber', 1650, true],
    'o cartão: o número da ferramenta, o filtro e o link');
  eq([chamadas.length, chamadas[0].chave, chamadas[0].corpo.model, chamadas[0].corpo.tools.length], [2, 'sk-perg', 'claude-opus-5-5', 5], 'chave da agência, modelo atual, 5 ferramentas fixas');
  const volta = chamadas[1].corpo.messages[2].content[0];
  eq([volta.type, JSON.parse(volta.content).numeros.find(n => n.rotulo === 'Em aberto a receber').valor], ['tool_result', 1650], 'a IA recebe só o resultado da consulta');
  const registro = (await query(`SELECT estado, ferramentas, usuario_id FROM perguntas_ia WHERE tenant_id = $1 ORDER BY criado_em DESC LIMIT 1`, [T])).rows[0];
  eq([registro.estado, registro.ferramentas, registro.usuario_id], ['respondida', ['contas_a_pagar_e_receber'], 'u-OPERADOR'], 'a pergunta fica registrada');
  eq(Number((await query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND entidade = 'perguntas_ia'`, [T])).rows[0].n), 1, 'e no registro de atividades');

  // Pergunta pedindo dado sem direito: o perfil de acesso tira saldo e o ganho da agência.
  await query(`INSERT INTO grupos_usuario (tenant_id, id, nome, acesso_total, acoes, contas) VALUES ($1, 'g-restrito', 'Restrito', false, $2::jsonb, '[]'::jsonb)`,
    [T, JSON.stringify(['ver_financeiro', 'editar_financeiro', 'acessar_relatorios', 'acessar_lancamentos_outros'])]);
  await query(`INSERT INTO grupo_usuario_membros (tenant_id, grupo_id, usuario_id) VALUES ($1, 'g-restrito', 'u-restrito')`, [T]);
  invalidarPermissoes(T);
  como('OPERADOR', 'u-restrito');
  roteiro = [
    { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 's1', name: 'saldos_das_contas', input: {} },
      { type: 'tool_use', id: 's2', name: 'vendas_agrupadas', input: { agrupar_por: 'vendedor', medida: 'receita', de: `${MES}-01` } },
    ] },
    texto('Seu acesso não inclui o saldo das contas nem o ganho da agência.'),
  ];
  chamadas = [];
  p = await perguntar('qual o saldo das contas e a receita por vendedor?');
  eq(p.status, 200, 'respondida');
  eq(p.corpo.resultados.map(x => [x.ferramenta, x.recusado, x.numeros.length]), [
    ['saldos_das_contas', 'Seu acesso não inclui ver o saldo das contas bancárias.', 0],
    ['vendas_agrupadas', 'Seu acesso não inclui ver o ganho da agência nas vendas.', 0],
  ], 'pergunta pedindo dado sem direito: as duas consultas recusadas, nenhum número');
  const voltas = chamadas[1].corpo.messages[2].content;
  eq(voltas.map(v => [v.is_error, JSON.parse(v.content).recusado, JSON.stringify(v.content).includes('1000')]), [[true, true, false], [true, true, false]],
    'a IA também não recebe número nenhum');
  const reg2 = (await query(`SELECT ferramentas FROM perguntas_ia WHERE usuario_id = 'u-restrito'`)).rows[0];
  eq(reg2.ferramentas, ['saldos_das_contas:recusado', 'vendas_agrupadas:recusado'], 'o registro diz que foi recusado');

  // Restrito a uma conta: o que foi recebido na outra não aparece.
  await query(`UPDATE grupos_usuario SET contas = '["cb1"]'::jsonb WHERE id = 'g-restrito'`);
  invalidarPermissoes(T);
  roteiro = [usa('c1', 'contas_a_pagar_e_receber', { tipo: 'receber', situacao: 'liquidado', data: 'liquidacao', de: '2026-11-01', ate: '2026-11-30' }), texto('R$ 300,00.')];
  p = await perguntar('quanto recebi em novembro de 2026?');
  eq(p.corpo.resultados[0].numeros.find(n => n.rotulo === 'Já recebido').valor, 300, 'pela rota: conta bancária não liberada fica fora');

  // Erro da IA.
  como('OPERADOR');
  roteiro = [{ __status: 500, error: { message: 'detalhe' } }];
  p = await perguntar('quanto tenho a pagar?');
  eq([p.status, /código 500/.test(p.corpo.error)], [502, true], 'IA falhou: 502 com frase nossa');
  eq((await query(`SELECT estado FROM perguntas_ia WHERE tenant_id = $1 ORDER BY criado_em DESC LIMIT 1`, [T])).rows[0].estado, 'falhou', 'registrada como falha');

  // Limite por agência.
  st = await estado();
  const faltam = LIMITE_DE_PERGUNTAS_POR_DIA - st.uso.usados;
  for (let i = 0; i < faltam; i++) await query(`INSERT INTO perguntas_ia (id, tenant_id, usuario_id, pergunta, estado) VALUES ($1, $2, 'u', 'x', 'respondida')`, [`lote-${i}`, T]);
  chamadas = [];
  p = await perguntar('quanto tenho a receber?');
  eq([p.status, p.corpo.codigo, chamadas.length], [429, 'LIMITE', 0], 'limite da agência: 429 sem chamar a IA');
  como('ADMIN', 'u-admin2', T2);
  await query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ('apis-config-singleton', $1, $2)`, [T2, JSON.stringify({ anthropic: { ativo: true, api_key: 'sk-t2' } })]);
  roteiro = [usa('x1', 'contas_a_pagar_e_receber', { tipo: 'receber', situacao: 'em_aberto', data: 'vencimento', pessoa: 'Sol' }), texto('ok')];
  p = await perguntar('quanto tenho a receber da Sol?');
  eq([p.status, p.corpo.resultados[0].numeros.find(n => n.rotulo === 'Em aberto a receber').valor], [200, 99999], 'outra agência: limite próprio e só os dados dela');
} catch (e) {
  falhas++;
  console.log('ERRO', e);
}

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
