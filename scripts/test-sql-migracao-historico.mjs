/**
 * Mudança v2 (E7, 06/11/2026) contra um Postgres real (PGlite), pelas ROTAS
 * de verdade (/api/mudanca/*) e pelo código de produção.
 *
 * Planilhas montadas em memória com o SheetJS, no formato das exportações
 * do sistema anterior. O que se prova:
 *   (a) cada lista do histórico é reconhecida (as liquidadas pelo conteúdo);
 *   (b) o ensaio não grava nada e explica cada linha;
 *   (c) contas liquidadas: conta + baixa na data e conta certas, pela
 *       liquidação no servidor, SEM dinheiro em dobro (saldo de hoje e da
 *       data de corte iguais ao informado; razão igual ao saldo);
 *   (d) extrato: o que já é baixa se liga; o resto vira liquidação; transferência
 *       e depois do corte ficam de fora com o motivo;
 *   (e) vendas por produto viram venda completa (origem "mudança"), com
 *       passageiros e componentes, sem gerar contas, ligadas às contas trazidas;
 *       salvar de novo continua sem gerar contas; a comissão por função não as conta;
 *   (f) notas (só registro, não emitida fica fora), comissões pagas, metas,
 *       reembolsos (ligado à conta que já veio) e créditos de clientes;
 *   (g) provas: saldo na data de corte, liquidado por mês, receita por mês; PDF;
 *   (h) mês em paralelo: bate, só lá, só aqui, valor e data diferentes, por
 *       conta, pessoa e categoria; nada gravado; PDF;
 *   (i) desfazer o histórico: estorna as liquidações, a abertura volta, o saldo
 *       volta ao de antes; o que alguém mexeu fica, com o motivo;
 *   (j) isolamento entre agências.
 *
 * Uso: node --no-warnings scripts/test-sql-migracao-historico.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';

let falhas = 0, total = 0;
const ord = v => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ord(v[k])])) : Array.isArray(v) ? v.map(ord) : v);
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(ord(a)) === JSON.stringify(ord(b));
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, crm_supplier_id TEXT, external_id TEXT, crm_atualizado_em TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb, tenant_id TEXT NOT NULL DEFAULT '');
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
`);
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
process.env.JWT_SECRET = 'segredo-de-teste-migracao-v2';

const imp = p => import(`../src/lib/${p}`);
for (const [arq, nome] of [
  ['baixas-servidor.ts', 'BAIXAS_SCHEMA_SQL'], ['periodo-fechado.ts', 'PERIODO_SCHEMA_SQL'], ['cobranca/schema.ts', 'COBRANCA_SCHEMA_SQL'],
  ['migracao/schema.ts', 'MIGRACAO_SCHEMA_SQL'], ['venda-schema.ts', 'VENDA_SCHEMA_SQL'], ['fornecedor-schema.ts', 'FORNECEDOR_SCHEMA_SQL'],
  ['nota-regras-schema.ts', 'NOTAS_REGRAS_SCHEMA_SQL'], ['comissao-funcoes-schema.ts', 'COMISSAO_FUNCOES_SCHEMA_SQL'],
  ['cancelamento-schema.ts', 'PARTE_D_SCHEMA_SQL'], ['fatura-schema.ts', 'FATURA_SCHEMA_SQL'], ['razao-schema.ts', 'RAZAO_SCHEMA_SQL'],
]) {
  const m = await imp(arq);
  if (!m[nome]) throw new Error(`sem ${nome}`);
  await pg.exec(m[nome]);
}
// O esquema da venda continua idempotente com a origem nova.
await pg.exec((await imp('venda-schema.ts')).VENDA_SCHEMA_SQL);
await pg.exec((await imp('migracao/schema.ts')).MIGRACAO_SCHEMA_SQL);

const { emTransacao } = await imp('caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await imp('razao-servidor.ts');
const { registrarBaixas } = await imp('baixas-servidor.ts');
const vendaSrv = await imp('venda-servidor.ts');
const { calcularNoBanco } = await imp('comissao-funcoes-servidor.ts');
const { ajustarCredito } = await imp('credito-cliente-servidor.ts');

const A = 'agencia-a';
const B = 'agencia-b';
const sessao = (perfil, t = A) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: t, tenantSlug: t });
const CORTE = '2026-10-31';

// ---------------------------------------------------------------------------
// O que a agência já tem.
const conta = (id, t, nome, saldo, extra = {}) => query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ($1, $2, $3, $4::jsonb)`,
  [id, t, nome, JSON.stringify({ id, nome, tipo: 'CORRENTE', banco: '341', agencia: '0001', conta: '12345-6', saldo_inicial: saldo, saldo_atual: saldo, ...extra })]);
await conta('cb-itau', A, 'Itaú', 0);
await conta('cb-caixa', A, 'Caixa da loja', 0, { banco: '', agencia: '', conta: '' });
const cat = (id, codigo, nome, tipo, pai = null) => query(`INSERT INTO plano_contas (id, tenant_id, codigo, descricao, tipo, data) VALUES ($1, $2, $3, '', $4, $5::jsonb)`,
  [id, A, codigo, tipo, JSON.stringify({ id, codigo, nome, tipo, categoria_pai_id: pai, ativo: true })]);
await cat('pc-1', '1', 'RECEITAS', 'RECEITA');
await cat('pc-2', '2', 'DESPESAS', 'DESPESA');
await query(`INSERT INTO comissao_funcoes (tenant_id, id, nome, sistema) VALUES ($1, 'f-vend', 'Vendedor', 'VENDEDOR')`, [A]);
await query(`INSERT INTO comissao_pessoas (tenant_id, id, funcao_id, pessoa_id, pessoa_nome) VALUES ($1, 'f-vend:u-ana', 'f-vend', 'u-ana', 'Ana Lima')`, [A]);
await emTransacao(exec => abrirRazaoNoExecutor(exec, A));

// ---------------------------------------------------------------------------
// Planilhas no formato das exportações.
function xlsx(linhas) {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planilha1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
const latin1 = s => new Uint8Array(Buffer.from(s, 'latin1'));

const arqContas = xlsx([['Descrição', 'Tipo', 'Banco', 'Agência', 'Conta', 'Saldo'], ['Itaú', 'Conta Corrente', '341', '0001', '12345-6', '5.000,00']]);
// Contas a Pagar/Receber com "Data de" = Liquidação: a maior parte liquidada.
const arqLiquidados = xlsx([
  ['Pessoa', 'CPF/CNPJ', 'Movimento', 'Documento', 'Descrição', 'Emissão', 'Vencimento', 'Liquidação', 'Valor Final', 'Categoria', 'Conta', 'Venda Nº'],
  ['Maria Souza', '123.456.789-09', 'Receber', 'NF 1', 'Pacote Lisboa', '01/10/2026', '05/10/2026', '05/10/2026', '1.200,00', 'Pacotes', 'Itaú', '900'],
  ['Hotel Sol', '12.345.678/0001-95', 'Pagar', 'FAT 9', 'Diárias', '02/10/2026', '10/10/2026', '09/10/2026', '800,00', 'Hospedagem', 'Itaú', '900'],
  ['Maria Souza', '123.456.789-09', 'Receber', 'NF 2', 'Pacote Lisboa 2ª parcela', '01/10/2026', '15/11/2026', '', '600,00', 'Pacotes', 'Itaú', '900'],
  ['Carlos Reis', '', 'Receber', 'R 7', 'Seguro', '01/10/2026', '04/11/2026', '05/11/2026', '300,00', 'Seguros', 'Itaú', ''],
  ['Carlos Reis', '', 'Pagar', 'RB 1', 'Reembolso do hotel', '20/10/2026', '20/11/2026', '', '150,00', 'Reembolsos', 'Itaú', ''],
  ['Ana Viagens', '', 'Receber', 'X', 'Liquidada', '01/09/2026', '10/09/2026', '12/09/2026', '50,00', 'Pacotes', 'Itaú', ''],
]);
const arqExtrato = latin1(
  'Data;Conta;Pessoa;Descrição;Valor\r\n'
  + '05/10/2026;Itaú;Maria Souza;Recebimento NF 1;1.200,00\r\n'
  + '09/10/2026;Itaú;Hotel Sol;Pagamento FAT 9;-800,00\r\n'
  + '20/10/2026;Itaú;;Tarifa bancária;-35,90\r\n'
  + '25/10/2026;Itaú;;Transferência para poupança;-100,00\r\n'
  + '03/11/2026;Itaú;;Rendimento;10,00\r\n');
const arqVendas = xlsx([
  ['Venda Nº', 'Data Venda', 'Situação', 'Produto', 'Pagante', 'CPF', 'Vendedor', 'Fornecedor', 'Passageiros', 'Documento', 'Data Início', 'Data Fim', 'Total Produtos', 'Total Taxas', 'Taxa DU', 'Comissão', 'Valor Total', 'Receitas'],
  ['900', '01/10/2026', 'Fechada', 'Hospedagem', 'Maria Souza', '123.456.789-09', 'Ana Lima', 'Hotel Sol', 'Maria Souza, João Souza', 'HS1', '10/12/2026', '15/12/2026', '1.000,00', '0,00', '0,00', '100,00', '1.000,00', '100,00'],
  ['900', '01/10/2026', 'Fechada', 'Aéreo', 'Maria Souza', '123.456.789-09', 'Ana Lima', 'Cia Azul', 'Maria Souza', 'LOC1', '10/12/2026', '15/12/2026', '700,00', '80,00', '20,00', '0,00', '800,00', '20,00'],
  ['901', '02/10/2026', 'Fechada', 'Seguro', 'Pedro Lima', '', 'Ana Lima', 'Seguradora X', '', '', '', '', '100,00', '0,00', '0,00', '10,00', '100,00', '10,00'],
]);
const arqNotas = xlsx([
  ['Número', 'Série', 'Data de Emissão', 'Tomador', 'CPF/CNPJ', 'Valor Total Serviços', 'Valor ISS', 'Situação', 'Venda Nº'],
  ['55', '1', '06/10/2026', 'Maria Souza', '123.456.789-09', '120,00', '6,00', 'Emitida', '900'],
  ['56', '1', '07/10/2026', 'Fulano', '', '50,00', '2,50', 'Não emitida', ''],
]);
const arqComissoes = xlsx([
  ['Pessoa', 'Venda Nº', 'Data Venda', 'Pagante', 'Descrição/Produto', 'Valor', 'Valor Retido', 'Pago em'],
  ['Ana Lima', '900', '01/10/2026', 'Maria Souza', 'Hospedagem', '12,00', '0,00', '20/10/2026'],
]);
const arqMetas = xlsx([
  ['Pessoa', 'Função', 'Plano', 'Ano', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
  ['Ana Lima', 'Vendedor', 'Plano A', '2026', '', '', '', '', '', '', '', '', '', '10.000,00', '12.000,00', '15.000,00'],
  ['Zé Ninguém', 'Vendedor', 'Plano A', '2026', '', '', '', '', '', '', '', '', '', '1.000,00', '', ''],
]);
const arqReembolsos = xlsx([
  ['Pessoa', 'CPF/CNPJ', 'Tipo', 'Venda Nº', 'Valor', 'Prazo', 'Descrição'],
  ['Carlos Reis', '', 'Ao cliente', '', '150,00', '20/11/2026', 'Reembolso do hotel'],
  ['Hotel Sol', '12.345.678/0001-95', 'Do fornecedor', '900', '200,00', '30/11/2026', 'Diária não usada'],
]);
const arqCreditos = xlsx([
  ['Cliente', 'CPF/CNPJ', 'Saldo', 'Validade', 'Venda de origem'],
  ['Maria Souza', '123.456.789-09', '250,00', '31/12/2027', '900'],
  ['Pedro Lima', '', '50,00', '01/01/2020', ''],
]);

// ---------------------------------------------------------------------------
const rota = p => import(`../src/app/api/mudanca/${p}`);
const rotaLotes = await rota('lotes/route.ts');
const rotaLote = await rota('lotes/[id]/route.ts');
const rotaArquivos = await rota('lotes/[id]/arquivos/route.ts');
const rotaMapa = await rota('lotes/[id]/mapeamento/route.ts');
const rotaEnsaio = await rota('lotes/[id]/ensaio/route.ts');
const rotaAplicar = await rota('lotes/[id]/aplicar/route.ts');
const rotaProvas = await rota('lotes/[id]/provas/route.ts');
const rotaPdf = await rota('lotes/[id]/provas/pdf/route.ts');
const rotaDesfazer = await rota('lotes/[id]/desfazer/route.ts');
const rotaConcluir = await rota('lotes/[id]/concluir/route.ts');
const rotaParalelo = await rota('paralelo/route.ts');
const rotaComparar = await rota('lotes/[id]/paralelo/route.ts');
const rotaCompararPdf = await rota('lotes/[id]/paralelo/pdf/route.ts');
const rotaHistorico = await rota('historico/route.ts');

const pedir = (metodo, url, corpo, cab = {}) => new Request(`http://localhost${url}`, {
  method: metodo,
  headers: corpo instanceof FormData ? cab : { 'Content-Type': 'application/json', ...cab },
  body: corpo === undefined ? undefined : corpo instanceof FormData ? corpo : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: r.headers.get('Content-Type')?.includes('json') ? await r.json() : null, resposta: r });
const p = (id, extra = {}) => ({ params: Promise.resolve({ id, ...extra }) });
const soltar = async (id, nome, bytes) => {
  const f = new FormData();
  f.append('arquivo', new File([bytes], nome));
  return json(await rotaArquivos.POST(pedir('POST', `/api/mudanca/lotes/${id}/arquivos`, f), p(id)));
};
const confirmarTudo = async id => {
  const mapa = await json(await rotaMapa.GET(pedir('GET', `/api/mudanca/lotes/${id}/mapeamento`), p(id)));
  for (const a of mapa.corpo.arquivos) {
    const r = await json(await rotaMapa.PUT(pedir('PUT', `/api/mudanca/lotes/${id}/mapeamento`, {
      arquivo_id: a.arquivo_id, tipo_lista: a.tipo_lista, colunas: a.colunas.map(c => ({ indice: c.indice, campo: c.campo })),
    }), p(id)));
    if (!r.corpo.mapeamento_confirmado) console.log('não confirmou', a.arquivo_nome, JSON.stringify(r.corpo.faltando));
  }
};
const n1 = async (sql, args = []) => Number((await query(sql, args)).rows[0]?.n ?? 0);
const contar = async () => ({
  cr: await n1(`SELECT COUNT(*)::int AS n FROM contas_receber`), cp: await n1(`SELECT COUNT(*)::int AS n FROM contas_pagar`),
  baixas: await n1(`SELECT COUNT(*)::int AS n FROM baixas`), vendas: await n1(`SELECT COUNT(*)::int AS n FROM vendas_crm`),
  reembolsos: await n1(`SELECT COUNT(*)::int AS n FROM reembolsos`), creditos: await n1(`SELECT COUNT(*)::int AS n FROM creditos_cliente`),
  metas: await n1(`SELECT COUNT(*)::int AS n FROM comissao_metas`), registros: await n1(`SELECT COUNT(*)::int AS n FROM migracao_historico`),
});
const saldoDe = async id => (await query(`SELECT data FROM contas_bancarias WHERE id = $1`, [id])).rows[0].data;
const razaoDe = async id => Number((await query(`SELECT saldo_centavos AS s FROM razao_saldo_bancario WHERE tenant_id = $1 AND conta_bancaria_id = $2`, [A, id])).rows[0]?.s ?? 0);

console.log('--- (a) Arquivos e listas ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
const L = (await json(await rotaLotes.POST(pedir('POST', '/api/mudanca/lotes', { data_corte: CORTE }, { 'Idempotency-Key': 'v2-1' })))).corpo.id;
const arquivos = {};
for (const [nome, bytes] of [
  ['contas.xlsx', arqContas], ['outubro-liquidadas.xlsx', arqLiquidados], ['extrato-outubro.csv', arqExtrato], ['vendas-por-produto.xlsx', arqVendas],
  ['notas.xlsx', arqNotas], ['comissoes-pagas.xlsx', arqComissoes], ['metas-2026.xlsx', arqMetas], ['reembolsos.xlsx', arqReembolsos], ['creditos.xlsx', arqCreditos],
]) {
  const r = await soltar(L, nome, bytes);
  arquivos[nome] = r.corpo;
}
eq(Object.fromEntries(Object.entries(arquivos).map(([n, a]) => [n, a.tipo_lista])), {
  'contas.xlsx': 'contas', 'outubro-liquidadas.xlsx': 'liquidados', 'extrato-outubro.csv': 'movimentos', 'vendas-por-produto.xlsx': 'vendas',
  'notas.xlsx': 'notas', 'comissoes-pagas.xlsx': 'comissoes_pagas', 'metas-2026.xlsx': 'metas', 'reembolsos.xlsx': 'reembolsos', 'creditos.xlsx': 'creditos',
}, 'cada lista do histórico reconhecida (as liquidadas pelo conteúdo da lista de contas)');
eq(arquivos['outubro-liquidadas.xlsx'].periodo, { de: '2026-09-12', ate: '2026-11-05' }, 'período das liquidadas pela data de liquidação');
await confirmarTudo(L);

console.log('--- (b) Ensaio ---');
const antes = await contar();
const ens = await json(await rotaEnsaio.POST(pedir('POST', `/api/mudanca/lotes/${L}/ensaio`), p(L)));
eq([ens.status, ens.corpo.ensaio.pode_aplicar, ens.corpo.ensaio.problemas], [200, true, []], 'ensaio limpo');
eq(await contar(), antes, 'o ensaio NÃO grava nada no financeiro');
const res = Object.fromEntries(ens.corpo.resumo_do_ensaio.map(r => [r.tipo_lista, [r.criar, r.vincular, r.recusar]]));
eq(res, {
  contas: [0, 1, 0], liquidados: [6, 0, 0], movimentos: [1, 2, 2], vendas: [2, 1, 0], notas: [1, 0, 1], comissoes_pagas: [1, 0, 0],
  metas: [1, 0, 1], reembolsos: [2, 0, 0], creditos: [1, 0, 1],
}, 'resumo por lista: criar, vincular, recusar');
eq(ens.corpo.ensaio.historico.liquidados, { quantidade: 3, centavos: 205000 }, 'três liquidadas até o corte (a liquidada depois do corte e as abertas entram em aberto)');
const linhasEnsaio = async filtro => (await json(await rotaEnsaio.GET(pedir('GET', `/api/mudanca/lotes/${L}/ensaio?${filtro}`), p(L)))).corpo.linhas;
const recusadas = (await linhasEnsaio('resultado=recusar&por_pagina=500')).map(l => [l.tipo_lista, l.codigo]).sort();
eq(recusadas, [['creditos', 'vencido'], ['metas', 'pessoa_sem_funcao'], ['movimentos', 'depois_do_corte'], ['movimentos', 'transferencia'], ['notas', 'nao_emitida']].sort(),
  'cada recusa com o motivo');
const carlos = (await linhasEnsaio('busca=R%207')).find(l => l.tipo_lista === 'liquidados');
eq([carlos.resultado, carlos.avisos.some(a => a.includes('depois da data de corte'))], ['criar', true], 'liquidada depois do corte: entra em aberto (dá a baixa aqui)');

console.log('--- (c) Aplicar: contas liquidadas sem dinheiro em dobro ---');
const ass = (await json(await rotaEnsaio.GET(pedir('GET', `/api/mudanca/lotes/${L}/ensaio`), p(L)))).corpo.assinatura;
const ap = await json(await rotaAplicar.POST(pedir('POST', `/api/mudanca/lotes/${L}/aplicar`, { assinatura: ass }, { 'Idempotency-Key': 'ap-v2' }), p(L)));
eq([ap.status, ap.corpo.situacao], [200, 'aplicado'], 'aplica');
const itau = await saldoDe('cb-itau');
// 50 (setembro) + 1.200 recebidos − 800 pagos − 35,90 de tarifa (do extrato) = 414,10 de histórico na conta.
eq([itau.saldo_atual, itau.saldo_inicial], [5000, 4585.9], 'saldo de hoje = o informado (5.000); a abertura foi para antes do histórico (5.000 − 414,10)');
eq(await razaoDe('cb-itau'), 500000, 'o razão da conta soma exatamente o saldo (baixa + compensação = zero)');
const baixas = (await query(`SELECT titulo_tabela, data_baixa::text AS d, conta_bancaria_id AS c, valor_centavos AS v, origem FROM baixas WHERE tenant_id = $1 ORDER BY data_baixa`, [A])).rows;
eq(baixas.map(b => [b.titulo_tabela, b.d, b.c, Number(b.v), b.origem]), [
  ['contas_receber', '2026-09-12', 'cb-itau', 5000, 'migracao'],
  ['contas_receber', '2026-10-05', 'cb-itau', 120000, 'migracao'],
  ['contas_pagar', '2026-10-09', 'cb-itau', 80000, 'migracao'],
  ['contas_pagar', '2026-10-20', 'cb-itau', 3590, 'migracao'],
], 'cada liquidação pela liquidação no servidor, na data e na conta certas');
const maria1 = (await query(`SELECT data FROM contas_receber WHERE data->>'numero_documento' = 'NF 1'`)).rows[0].data;
eq([maria1.status, maria1.data_recebimento, maria1.conta_bancaria_id, maria1.origem_migracao.lote_id === L], ['RECEBIDO', '2026-10-05', 'cb-itau', true], 'conta liquidada: recebida em 05/10 no Itaú, com a origem');
const abertas = (await query(`SELECT data->>'numero_documento' AS d, data->>'status' AS s FROM contas_receber WHERE data->>'numero_documento' IN ('NF 2','R 7') ORDER BY 1`)).rows;
eq(abertas.map(r => [r.d, r.s]), [['NF 2', 'PENDENTE'], ['R 7', 'PENDENTE']], 'a aberta e a liquidada depois do corte entram em aberto');

console.log('--- (d) Extrato ---');
const mov = (await linhasEnsaio('tipo_lista=movimentos&por_pagina=50')).map(l => [l.resultado, l.codigo ?? '']);
eq(mov, [['vincular', ''], ['vincular', ''], ['criar', ''], ['recusar', 'transferencia'], ['recusar', 'depois_do_corte']], 'extrato: liga às liquidações, cria a tarifa, deixa de fora transferência e depois do corte');
const tarifa = (await query(`SELECT data FROM contas_pagar WHERE data->>'descricao' = 'Tarifa bancária'`)).rows[0].data;
eq([tarifa.status, tarifa.fornecedor_nome, tarifa.data_pagamento], ['PAGO', 'Sem pessoa informada', '2026-10-20'], 'tarifa do extrato vira conta paga');

console.log('--- (e) Vendas ---');
const vendas = (await query(`SELECT v.id, v.data->>'numero_anterior' AS n, m.origem, m.total_cliente_centavos AS t, m.receita_centavos AS r FROM vendas_crm v JOIN vendas_modelo m ON m.venda_id = v.id WHERE v.tenant_id = $1 ORDER BY 2`, [A])).rows;
eq(vendas.map(v => [v.n, v.origem, Number(v.t), Number(v.r)]), [['900', 'mudanca', 180000, 12000], ['901', 'mudanca', 10000, 1000]], 'vendas no modelo completo, origem "mudança", total e receita certos');
const v900 = vendas[0].id;
const carregada = await vendaSrv.carregarVenda(pool, A, v900);
eq([carregada.venda.produtos.length, carregada.venda.produtos[0].passageiros.map(x => x.nome), carregada.venda.produtos[0].componentes.map(c => [c.tipo, c.valor_centavos]), carregada.venda.produtos[1].componentes.map(c => c.tipo)],
  [2, ['Maria Souza', 'João Souza'], [['COMISSAO', 10000]], ['TAXA_DU']], 'produtos com passageiros e componentes de mercado');
eq(await n1(`SELECT COUNT(*)::int AS n FROM contas_receber WHERE data->>'auto_gerado' = 'true'`) + await n1(`SELECT COUNT(*)::int AS n FROM contas_pagar WHERE data->>'auto_gerado' = 'true'`), 0,
  'a venda trazida NÃO gera contas (as contas dela vieram das listas)');
const ligadas = (await query(`SELECT data->>'numero_documento' AS d FROM contas_receber WHERE data->>'origem_venda_id' = $1 UNION ALL SELECT data->>'numero_documento' FROM contas_pagar WHERE data->>'origem_venda_id' = $1 ORDER BY 1`, [v900])).rows.map(r => r.d);
eq(ligadas, ['FAT 9', 'NF 1', 'NF 2'], 'as contas trazidas com o Venda Nº 900 ficam ligadas à venda');
await emTransacao(exec => vendaSrv.salvarVenda(exec, A, carregada.venda, { usuario: { id: 'u', nome: 'Teste' }, origem: 'manual' }));
eq([await n1(`SELECT COUNT(*)::int AS n FROM contas_receber WHERE data->>'auto_gerado' = 'true'`), (await query(`SELECT origem FROM vendas_modelo WHERE venda_id = $1`, [v900])).rows[0].origem],
  [0, 'mudanca'], 'editar a venda trazida continua sem gerar contas (dinheiro em dobro nunca)');
const posicao = await vendaSrv.posicaoDaVendaNoBanco(pool, A, v900, '2026-11-06');
eq([posicao.posicao.cliente.recebido, posicao.posicao.cliente.em_aberto], [120000, 60000], 'a posição da venda lê as contas trazidas (recebido 1.200, em aberto 600)');
await query(`INSERT INTO comissao_config (tenant_id, data) VALUES ($1, '{"regra":"FUNCOES"}'::jsonb) ON CONFLICT DO NOTHING`, [A]).catch(() => null);
const calc = await calcularNoBanco(pool, A, '2026-12-31');
eq(calc.itens.filter(i => i.venda_id === v900).length, 0, 'a comissão por função não conta a venda trazida (já paga lá)');

console.log('--- (f) Registros, metas, reembolsos e créditos ---');
const regs = (await query(`SELECT tipo, numero, valor_centavos AS v, venda_id FROM migracao_historico WHERE tenant_id = $1 ORDER BY tipo`, [A])).rows;
eq(regs.map(r => [r.tipo, r.numero, Number(r.v), r.venda_id === v900]), [['comissoes_pagas', '900', 1200, true], ['notas', '55', 12000, true]], 'nota emitida e comissão paga como registro, ligadas à venda');
const hist = await json(await rotaHistorico.GET(pedir('GET', '/api/mudanca/historico?tipo=notas')));
eq([hist.status, hist.corpo.registros.map(r => [r.numero, r.valor]), hist.corpo.contagem], [200, [['55', 120]], { faturas: 0, notas: 1, comissoes_pagas: 1 }], 'consulta dos registros');
eq(await n1(`SELECT COUNT(*)::int AS n FROM notas_fiscais`).catch(() => 0), 0, 'nenhuma nota é emitida (nem vai para a fila de notas)');
const metas = (await query(`SELECT pessoa_funcao_id AS p, mes, valor_centavos AS v FROM comissao_metas WHERE tenant_id = $1 ORDER BY mes`, [A])).rows;
eq(metas.map(m => [m.p, m.mes, Number(m.v)]), [['f-vend:u-ana', '2026-10', 1000000], ['f-vend:u-ana', '2026-11', 1200000], ['f-vend:u-ana', '2026-12', 1500000]], 'metas na pessoa da função');
const reemb = (await query(`SELECT tipo, situacao, conta_tabela, conta_id, venda_id, valor_centavos AS v FROM reembolsos WHERE tenant_id = $1 ORDER BY tipo`, [A])).rows;
const contaCarlos = (await query(`SELECT id, data FROM contas_pagar WHERE data->>'numero_documento' = 'RB 1'`)).rows[0];
eq(reemb.map(r => [r.tipo, r.situacao, r.conta_id === contaCarlos.id, r.venda_id === v900, Number(r.v)]),
  [['CLIENTE', 'APROVADO', true, false, 15000], ['FORNECEDOR', 'SOLICITADO', false, true, 20000]], 'reembolso ao cliente usa a conta que já veio (aprovado); o do fornecedor entra solicitado, ligado à venda');
eq(contaCarlos.data.reembolso_id ? true : false, true, 'a conta trazida passa a ser a do reembolso');
const cred = (await query(`SELECT cliente_nome, saldo_centavos AS s, validade::text AS v, origem_venda_id FROM creditos_cliente WHERE tenant_id = $1`, [A])).rows;
eq(cred.map(c => [c.cliente_nome, Number(c.s), c.v, c.origem_venda_id === v900]), [['Maria Souza', 25000, '2027-12-31', true]], 'crédito na carteira do cliente, pronto para usar');

console.log('--- (g) Provas ---');
const pr = await json(await rotaProvas.GET(pedir('GET', `/api/mudanca/lotes/${L}/provas`), p(L)));
const h = pr.corpo.historico;
eq(h.contas_no_corte.map(c => [c.rotulo, c.anterior, c.enturos, c.diferenca, c.explicada, c.saldo_hoje]), [['Itaú', 5000, 5000, 0, true, 5000]],
  'dinheiro em dobro: o saldo na data de corte refeito aqui é o informado, e o de hoje também');
eq(h.liquidados.map(l => [l.mes, l.tipo, l.anterior, l.enturos, l.explicada]), [['2026-09', 'receber', 50, 50, true], ['2026-10', 'pagar', 800, 800, true], ['2026-10', 'receber', 1200, 1200, true]], 'liquidado por mês: arquivo × aqui');
eq(h.receita.map(r => [r.mes, r.vendas, r.faturamento.anterior, r.faturamento.enturos, r.receita.anterior, r.receita.enturos, r.receita.explicada]),
  [['2026-10', 2, 1900, 1900, 130, 130, true]], 'receita por mês: sistema anterior × receita pelos componentes aqui');
eq(pr.corpo.diferencas_sem_explicacao, 0, 'nenhuma diferença sem motivo');
const pdf = await rotaPdf.GET(pedir('GET', `/api/mudanca/lotes/${L}/provas/pdf`), p(L));
eq([pdf.status, new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5))], [200, '%PDF-'], 'PDF com as provas do histórico');

const pvC = await json(await rotaConcluir.POST(pedir('POST', `/api/mudanca/lotes/${L}/concluir`, { modo: 'previa' }), p(L)));
await rotaConcluir.POST(pedir('POST', `/api/mudanca/lotes/${L}/concluir`, { modo: 'gravar', assinatura: pvC.corpo.assinatura }, { 'Idempotency-Key': 'cc-v2' }), p(L));

console.log('--- (h) Mês em paralelo ---');
// Em novembro, aqui: a NF 2 da Maria foi recebida no dia 16 (lá, no dia 15) e uma conta nova só aqui.
const nf2 = (await query(`SELECT id FROM contas_receber WHERE data->>'numero_documento' = 'NF 2'`)).rows[0].id;
await emTransacao(exec => registrarBaixas(exec, { tenantId: A, origem: 'tela', politica: null }, [{ titulo_tabela: 'contas_receber', titulo_id: nf2, data: '2026-11-16', conta_bancaria_id: 'cb-caixa', valor: 600 }], { gravar: true }));
await query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ('cr-aqui', $1, 'x', 'PENDENTE', $2::jsonb)`,
  [A, JSON.stringify({ id: 'cr-aqui', cliente_nome: 'Cliente Aqui', valor_final: 77, data_vencimento: '2026-11-22', status: 'PENDENTE', descricao: 'Só aqui' })]);
const novembro = xlsx([
  ['Pessoa', 'Movimento', 'Documento', 'Vencimento', 'Liquidação', 'Valor Final', 'Categoria', 'Conta'],
  ['Carlos Reis', 'Pagar', 'RB 1', '20/11/2026', '', '150,00', 'Reembolsos', 'Itaú'],
  ['Maria Souza', 'Receber', 'NF 2', '15/11/2026', '15/11/2026', '600,00', 'Pacotes', 'Itaú'],
  ['Carlos Reis', 'Receber', 'R 7', '04/11/2026', '05/11/2026', '320,00', 'Seguros', 'Itaú'],
  ['Nova Cliente', 'Receber', 'N 1', '25/11/2026', '', '99,00', 'Pacotes', 'Itaú'],
]);
const cmp = await json(await rotaParalelo.POST(pedir('POST', '/api/mudanca/paralelo', { mes: '2026-11' }, { 'Idempotency-Key': 'par-1' })));
const P = cmp.corpo.id;
eq([cmp.status, cmp.corpo.mes, cmp.corpo.situacao], [200, '2026-11', 'rascunho'], 'cria a comparação do mês (não conta como mudança em andamento)');
const sol = await soltar(P, 'novembro.xlsx', novembro);
eq(sol.status, 200, 'solta o arquivo do mês na comparação');
await confirmarTudo(P);
const antesP = await contar();
const rel = await json(await rotaComparar.GET(pedir('GET', `/api/mudanca/lotes/${P}/paralelo`), p(P)));
eq(await contar(), antesP, 'o mês em paralelo NÃO grava nada');
const sec = rel.corpo.secoes[0];
eq([rel.status, sec.fonte, sec.contagem], [200, 'contas', { bate: 1, data: 1, valor: 1, so_la: 1, so_aqui: 1 }], 'bate, data diferente, valor diferente, só lá e só aqui');
const porTipo = Object.fromEntries(sec.pares.map(x => [x.tipo, x]));
eq([porTipo.data.anterior.pessoa, porTipo.data.detalhe.includes('16/11/2026'), porTipo.valor.diferenca, porTipo.so_la.anterior.pessoa, porTipo.so_aqui.enturos.pessoa],
  ['Maria Souza', true, 20, 'Nova Cliente', 'Cliente Aqui'], 'cada diferença explicada');
eq([sec.por_pessoa.find(g => g.rotulo === 'Carlos Reis').diferenca, sec.por_categoria.some(g => g.rotulo === 'Pacotes'), sec.por_conta.length > 0], [20, true, true], 'totais por pessoa, categoria e conta');
const pdfP = await rotaCompararPdf.GET(pedir('GET', `/api/mudanca/lotes/${P}/paralelo/pdf`), p(P));
eq([pdfP.status, pdfP.headers.get('Content-Type')], [200, 'application/pdf'], 'PDF do mês em paralelo');
const lotesVisiveis = (await json(await rotaLotes.GET(pedir('GET', '/api/mudanca/lotes')))).corpo.lotes.map(l => l.id);
eq([lotesVisiveis.includes(P), lotesVisiveis.includes(L)], [false, true], 'a comparação não aparece como mudança');
const ensP = await json(await rotaEnsaio.POST(pedir('POST', `/api/mudanca/lotes/${P}/ensaio`), p(P)));
eq([ensP.status, ensP.corpo.codigo], [409, 'LOTE_DE_COMPARACAO'], 'comparação não ensaia nem aplica');

console.log('--- (i) Desfazer o histórico ---');
// Depois da mudança: a Maria usou parte do crédito (ajuste aqui).
const creditoId = (await query(`SELECT id FROM creditos_cliente WHERE tenant_id = $1`, [A])).rows[0].id;
await emTransacao(exec => ajustarCredito(exec, A, creditoId, -5000, 'Usado em outra viagem', 'teste'));
const pv = await json(await rotaDesfazer.POST(pedir('POST', `/api/mudanca/lotes/${L}/desfazer`, { modo: 'previa' }), p(L)));
const ficam = pv.corpo.ficam.map(f => f.motivo);
eq([ficam.includes('O crédito foi usado ou ajustado depois da mudança.'), ficam.includes('Recebeu baixa depois da mudança.')], [true, true], 'prévia: o crédito usado e a conta recebida aqui ficam, com o motivo');
const gD = await json(await rotaDesfazer.POST(pedir('POST', `/api/mudanca/lotes/${L}/desfazer`, { modo: 'gravar', assinatura: pv.corpo.assinatura }, { 'Idempotency-Key': 'df-v2' }), p(L)));
eq(gD.status, 200, 'desfaz');
const itauDepois = await saldoDe('cb-itau');
eq([itauDepois.saldo_atual, itauDepois.saldo_inicial, await razaoDe('cb-itau')], [0, 0, 0], 'o Itaú volta ao que era: histórico estornado, abertura devolvida, saldo de abertura estornado; o razão conta tudo');
const est = (await query(`SELECT COUNT(*) FILTER (WHERE tipo = 'baixa')::int AS b, COUNT(*) FILTER (WHERE tipo = 'estorno')::int AS e FROM baixas WHERE tenant_id = $1 AND origem = 'migracao' OR (tenant_id = $1 AND tipo = 'estorno')`, [A])).rows[0];
eq([est.b, est.e], [4, 4], 'cada liquidação trazida tem o seu estorno (nada some em silêncio)');
eq([await n1(`SELECT COUNT(*)::int AS n FROM vendas_crm`), await n1(`SELECT COUNT(*)::int AS n FROM vendas_modelo`), await n1(`SELECT COUNT(*)::int AS n FROM venda_produtos`),
  await n1(`SELECT COUNT(*)::int AS n FROM reembolsos`), await n1(`SELECT COUNT(*)::int AS n FROM comissao_metas`), await n1(`SELECT COUNT(*)::int AS n FROM migracao_historico`),
  await n1(`SELECT COUNT(*)::int AS n FROM creditos_cliente`)], [1, 1, 2, 0, 0, 0, 1], 'a venda 901, os reembolsos, as metas e os registros saem; ficam a venda 900 (editada aqui) e o crédito usado');
eq(gD.corpo.ficaram.some(f => f.tipo_lista === 'vendas' && f.motivo === 'A venda foi alterada depois da mudança.'), true, 'a venda editada aqui fica, com o motivo');
eq((await query(`SELECT data->>'numero_documento' AS d FROM contas_receber WHERE tenant_id = $1 ORDER BY 1`, [A])).rows.map(r => r.d), ['NF 2', null], 'ficam só a conta recebida aqui (NF 2) e a lançada aqui');

console.log('--- (j) Isolamento ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', B);
eq((await json(await rotaComparar.GET(pedir('GET', `/api/mudanca/lotes/${P}/paralelo`), p(P)))).status, 404, 'outra agência não compara o mês desta');
eq((await json(await rotaHistorico.GET(pedir('GET', '/api/mudanca/historico?tipo=notas')))).corpo.registros, [], 'outra agência não vê os registros desta');
eq((await json(await rotaParalelo.GET(pedir('GET', '/api/mudanca/paralelo')))).corpo.comparacoes, [], 'nem as comparações');
globalThis.__SESSAO_DE_TESTE__ = sessao('OPERADOR');
eq((await json(await rotaParalelo.POST(pedir('POST', '/api/mudanca/paralelo', { mes: '2026-11' })))).status, 403, 'só administrador compara o mês');
globalThis.__SESSAO_DE_TESTE__ = null;

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
