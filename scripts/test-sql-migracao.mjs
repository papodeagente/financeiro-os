/**
 * Mudança de sistema (E4, 05/11/2026) contra um Postgres real (PGlite),
 * pelas ROTAS de verdade (/api/mudanca/*) e pelo código de produção.
 *
 * Planilhas montadas em memória com o SheetJS, no formato das listas do
 * sistema anterior. O que se prova:
 *   (a) lote e arquivos: idempotência, um lote aberto por agência, só administrador;
 *   (b) mapeamento sugerido, confirmado e trocado pela tela;
 *   (c) ensaio NÃO grava nada no financeiro e explica cada linha;
 *   (d) aplicar: assinatura, nada sai (régua/avisos/cobrança seguradas), lote_id e origem em
 *       cada registro, identidade (CPF, e-mail só com o mesmo nome, vínculo com o existente),
 *       saldos de abertura no razão, linha de total ignorada, Latin-1, serial do Excel;
 *   (e) provas por conta, pessoa e mês × categoria, cada diferença explicada; PDF;
 *   (f) concluir libera as saídas; o mesmo mês em outra mudança não duplica (pela fila);
 *   (g) desfazer apaga só o que ninguém mudou, estorna os saldos, e lista o que ficou.
 *
 * Uso: node --no-warnings scripts/test-sql-migracao.mjs
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
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE tenants (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb);
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
process.env.JWT_SECRET = 'segredo-de-teste-migracao';

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { MIGRACAO_SCHEMA_SQL } = await import('../src/lib/migracao/schema.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(MIGRACAO_SCHEMA_SQL);
await pg.exec(MIGRACAO_SCHEMA_SQL); // idempotente
await pg.exec(RAZAO_SCHEMA_SQL);

const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { mudancaSegurandoSaidas } = await import('../src/lib/migracao/estado.ts');
const { avisarVencimentos } = await import('../src/lib/avisos-vencimento-servidor.ts');
const srv = await import('../src/lib/migracao/servidor.ts');
const fila = await import('../src/lib/agendador/fila.ts');

const A = 'agencia-a';
const B = 'agencia-b';
const sessao = (perfil, t = A) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: t, tenantSlug: t });

// ---------------------------------------------------------------------------
// O que a agência já tem antes da mudança.
const conta = (id, t, nome, saldo, extra = {}) => query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ($1, $2, $3, $4::jsonb)`,
  [id, t, nome, JSON.stringify({ id, nome, tipo: 'CORRENTE', banco: '341', agencia: '0001', conta: '12345-6', saldo_inicial: saldo, saldo_atual: saldo, ...extra })]);
await conta('cb-itau', A, 'Itaú', 0);
await conta('cb-brad', A, 'Bradesco', 500, { banco: '237', conta: '999-1' });
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, tipo, data) VALUES ('cli-pedro', $1, 'Pedro Lima', '', 'PF', $2::jsonb)`,
  [A, JSON.stringify({ id: 'cli-pedro', tipo: 'PF', nome_completo: 'Pedro Lima', email: 'pedro@x.com' })]);
const cat = (id, codigo, nome, tipo, pai = null) => query(`INSERT INTO plano_contas (id, tenant_id, codigo, descricao, tipo, data) VALUES ($1, $2, $3, '', $4, $5::jsonb)`,
  [id, A, codigo, tipo, JSON.stringify({ id, codigo, nome, tipo, categoria_pai_id: pai, ativo: true })]);
await cat('pc-1', '1', 'RECEITAS', 'RECEITA');
await cat('pc-2', '2', 'DESPESAS', 'DESPESA');
await cat('pc-21', '2.1', 'Custos', 'DESPESA', 'pc-2');
await cat('pc-2101', '2.1.01', 'Hospedagem', 'DESPESA', 'pc-21');
await emTransacao(exec => abrirRazaoNoExecutor(exec, A));

// ---------------------------------------------------------------------------
// Planilhas no formato das listas do sistema anterior.
function xlsx(linhas, bookType = 'xlsx') {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planilha1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }));
}
const latin1 = s => new Uint8Array(Buffer.from(s, 'latin1'));

const arqContas = xlsx([
  ['Descrição', 'Tipo', 'Banco', 'Agência', 'Conta', 'Saldo'],
  ['Itaú', 'Conta Corrente', '341', '0001', '12345-6', '1.000,00'],
  ['Caixa Loja', 'Conta Caixa', '', '', '', '250,00'],
  ['Bradesco', 'Conta Corrente', '237', '', '999-1', '900,00'],
  ['', '', '', '', '', '2.150,00'],
]);
const arqSaldos = latin1('Conta;Saldo;Data\r\nCaixa Loja;250,00;05/11/2026\r\nNubank;10,00;05/11/2026\r\n');
const arqCategorias = xlsx([
  ['Descrição', 'Grupo', 'Tipo'],
  ['Pacotes', 'Receitas de Viagem', 'Receita'],
  ['Hospedagem', 'Custos', 'Despesa'],
]);
const arqPessoas = xlsx([
  ['Nome', 'Razão social', 'CPF', 'CNPJ', 'E-mail', 'Telefone'],
  ['Maria Souza', '', '123.456.789-09', '', 'casal@x.com', '(11) 98888-1111'],
  ['João Souza', '', '', '', 'casal@x.com', ''],
  ['Pedro Lima', '', '', '', 'pedro@x.com', ''],
  ['Hotel Sol', 'Hotel Sol Ltda', '', '12.345.678/0001-95', 'reservas@sol.com', ''],
]);
// Grade de Contas a Pagar/Receber com título e período antes do cabeçalho, datas
// como serial do Excel e a linha de total do rodapé.
const SERIAL = d => Math.round((Date.UTC(...d.split('-').map((x, i) => i === 1 ? Number(x) - 1 : Number(x))) - Date.UTC(1899, 11, 30)) / 86400000);
const arqTitulos = xlsx([
  ['Contas a Pagar/Receber'],
  ['Período: 01/11/2026 a 30/11/2026'],
  ['Número', 'Empresa', 'Pessoa', 'Razão social', 'CPF/CNPJ', 'Conta', 'Documento', 'Descrição', 'Emissão', 'Vencimento', 'Liquidação', 'Movimento', 'Valor', 'Valor Final', 'Categoria', 'Grupo', 'Centro de custo', 'Parcelas', 'Venda Nº'],
  ['101', 'Matriz', 'Maria Souza', '', '123.456.789-09', 'Itaú', 'NF 10', 'Pacote Lisboa', SERIAL('2026-11-01'), SERIAL('2026-11-10'), '', 'Receber', 1200, 1200, 'Pacotes', 'Receitas de Viagem', 'Lazer', '1/3', '555'],
  ['102', 'Matriz', 'Hotel Sol', 'Hotel Sol Ltda', '12.345.678/0001-95', 'Itaú', 'FAT 9', 'Diárias', SERIAL('2026-11-02'), SERIAL('2026-11-15'), '', 'Pagar', 800.5, 800.5, 'Hospedagem', 'Custos', '', '', ''],
  ['103', 'Matriz', 'Joana Prado', '', '', 'Conta Antiga', '', 'Seguro', SERIAL('2026-11-03'), SERIAL('2026-11-20'), '', 'Receber', 300, 300, '', '', '', '', ''],
  ['104', 'Matriz', 'Maria Souza', '', '', 'Itaú', 'NF 7', 'Pago já', SERIAL('2026-10-01'), SERIAL('2026-10-10'), SERIAL('2026-10-10'), 'Receber', 50, 50, 'Pacotes', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', 2350.5, '', '', '', '', ''],
]);
// O mesmo mês exportado de novo, em CSV Latin-1: a Maria repete; a Conceição é nova.
const arqTitulosCsv = latin1(
  'Pessoa;CPF/CNPJ;Documento;Vencimento;Movimento;Valor Final;Categoria;Grupo;Parcelas\r\n'
  + 'Maria Souza;123.456.789-09;NF 10;10/11/2026;Receber;1.200,00;Pacotes;Receitas de Viagem;1/3\r\n'
  + 'Conceição Turismo;;BOL 3;05/12/2026;Pagar;99,90;Repasses;Custos;\r\n'
  + 'Total;;;;;1.299,90;;;\r\n');
const arqCortado = xlsx([['Pessoa', 'Vencimento', 'Valor Final', 'Movimento'], ['Zé', '01/12/2026', '10,00', 'Pagar'], ['Essa consulta retornou muitos registros. Serão exibidos os 1 primeiros.', '', '', '']]);

// ---------------------------------------------------------------------------
const rotaLotes = await import('../src/app/api/mudanca/lotes/route.ts');
const rotaLote = await import('../src/app/api/mudanca/lotes/[id]/route.ts');
const rotaArquivos = await import('../src/app/api/mudanca/lotes/[id]/arquivos/route.ts');
const rotaArquivo = await import('../src/app/api/mudanca/lotes/[id]/arquivos/[arquivoId]/route.ts');
const rotaMapa = await import('../src/app/api/mudanca/lotes/[id]/mapeamento/route.ts');
const rotaEnsaio = await import('../src/app/api/mudanca/lotes/[id]/ensaio/route.ts');
const rotaAplicar = await import('../src/app/api/mudanca/lotes/[id]/aplicar/route.ts');
const rotaProgresso = await import('../src/app/api/mudanca/lotes/[id]/progresso/route.ts');
const rotaProvas = await import('../src/app/api/mudanca/lotes/[id]/provas/route.ts');
const rotaPdf = await import('../src/app/api/mudanca/lotes/[id]/provas/pdf/route.ts');
const rotaDesfazer = await import('../src/app/api/mudanca/lotes/[id]/desfazer/route.ts');
const rotaConcluir = await import('../src/app/api/mudanca/lotes/[id]/concluir/route.ts');
const rotaDicionario = await import('../src/app/api/mudanca/dicionario/route.ts');

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
const conta1 = async (sql, args = []) => Number((await query(sql, args)).rows[0]?.n ?? 0);

console.log('--- (a) Lote, permissão e idempotência ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('OPERADOR');
eq((await json(await rotaLotes.POST(pedir('POST', '/api/mudanca/lotes', { data_corte: '2026-11-05' })))).status, 403, 'só administrador começa a mudança');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
const dic = await json(await rotaDicionario.GET());
eq([dic.status, dic.corpo.listas.map(l => l.id).slice(0, 6)], [200, ['contas', 'categorias', 'centros_custo', 'pessoas', 'titulos', 'saldos']], 'dicionário das listas para o passo 1 (a v1 primeiro; o histórico da E7 depois)');
const c1 = await json(await rotaLotes.POST(pedir('POST', '/api/mudanca/lotes', { data_corte: '05/11/2026' }, { 'Idempotency-Key': 'criar-1' })));
const c1b = await json(await rotaLotes.POST(pedir('POST', '/api/mudanca/lotes', { data_corte: '05/11/2026' }, { 'Idempotency-Key': 'criar-1' })));
const L = c1.corpo.id;
eq([c1.status, c1.corpo.situacao, c1.corpo.data_corte, c1b.corpo.id === L, c1.corpo.versao], [200, 'rascunho', '2026-11-05', true, 1], 'cria o lote (data brasileira aceita); mesma chave = mesmo lote');
const c2 = await json(await rotaLotes.POST(pedir('POST', '/api/mudanca/lotes', { data_corte: '2026-11-05' }, { 'Idempotency-Key': 'criar-2' })));
eq([c2.status, c2.corpo.codigo], [409, 'LOTE_ABERTO'], 'um lote aberto por agência');

console.log('--- Arquivos ---');
const fC = await soltar(L, 'contas.xlsx', arqContas);
const fS = await soltar(L, 'saldos.csv', arqSaldos);
const fK = await soltar(L, 'categorias.xlsx', arqCategorias);
const fP = await soltar(L, 'pessoas.xlsx', arqPessoas);
const fT = await soltar(L, 'novembro.xlsx', arqTitulos);
const fT2 = await soltar(L, 'novembro-de-novo.csv', arqTitulosCsv);
const fX = await soltar(L, 'cortado.xlsx', arqCortado);
eq([fC.corpo.tipo_lista, fS.corpo.tipo_lista, fK.corpo.tipo_lista, fP.corpo.tipo_lista, fT.corpo.tipo_lista, fT2.corpo.tipo_lista],
  ['contas', 'saldos', 'categorias', 'pessoas', 'titulos', 'titulos'], 'cada arquivo reconhecido pela lista');
eq([fT.corpo.linhas, fT.corpo.periodo, fT.corpo.avisos.map(a => a.codigo)], [4, { de: '2026-10-10', ate: '2026-11-20' }, ['linha_de_total']], 'títulos: 4 linhas, período pelo vencimento (serial do Excel), total do rodapé');
eq([fS.corpo.formato, fS.corpo.avisos.map(a => a.codigo), fT2.corpo.avisos.map(a => a.codigo)], ['csv', [], ['linha_de_total', 'codificacao_latin1']], 'CSV: só avisa Latin-1 quando há acento fora do UTF-8');
eq(fX.corpo.avisos.some(a => a.codigo === 'lista_cortada'), true, 'lista cortada avisada');
const rep = await soltar(L, 'contas-copia.xlsx', arqContas);
eq([rep.status, rep.corpo.codigo], [409, 'ARQUIVO_REPETIDO'], 'o mesmo arquivo duas vezes no lote é recusado');

console.log('--- (b) Mapeamento ---');
const mapa = await json(await rotaMapa.GET(pedir('GET', `/api/mudanca/lotes/${L}/mapeamento`), p(L)));
const mT = mapa.corpo.arquivos.find(a => a.arquivo_id === fT.corpo.id);
const colVenc = mT.colunas.find(c => c.cabecalho === 'Vencimento');
eq([colVenc.campo, colVenc.sugerido, colVenc.confianca, mT.campos.find(c => c.campo === 'vencimento').obrigatorio], ['vencimento', 'vencimento', 'certa', true], 'sugestão com confiança e campos da lista');
eq(mT.colunas.find(c => c.cabecalho === 'Pessoa').exemplos, ['Maria Souza', 'Hotel Sol', 'Joana Prado'], 'exemplos das primeiras linhas');
// Ensaio antes de confirmar: aplicar fica bloqueado.
let ens = await json(await rotaEnsaio.POST(pedir('POST', `/api/mudanca/lotes/${L}/ensaio`), p(L)));
eq([ens.status, ens.corpo.situacao, ens.corpo.ensaio.pode_aplicar, ens.corpo.ensaio.problemas.map(x => x.codigo).includes('MAPEAMENTO_NAO_CONFIRMADO')],
  [200, 'ensaiado', false, true], 'ensaio roda com a sugestão, mas aplicar espera a confirmação');
const semVenc = await json(await rotaMapa.PUT(pedir('PUT', `/api/mudanca/lotes/${L}/mapeamento`, {
  arquivo_id: fT.corpo.id, tipo_lista: 'titulos', colunas: mT.colunas.map(c => ({ indice: c.indice, campo: c.campo === 'vencimento' ? null : c.campo })),
}), p(L)));
eq([semVenc.status, semVenc.corpo.mapeamento_confirmado, semVenc.corpo.faltando], [200, false, ['Vencimento']], 'salvar sem um obrigatório não confirma');
for (const a of mapa.corpo.arquivos) {
  if (a.arquivo_id === fX.corpo.id) continue;
  const r = await json(await rotaMapa.PUT(pedir('PUT', `/api/mudanca/lotes/${L}/mapeamento`, {
    arquivo_id: a.arquivo_id, tipo_lista: a.tipo_lista, colunas: a.colunas.map(c => ({ indice: c.indice, campo: c.campo })),
  }), p(L)));
  if (!r.corpo.mapeamento_confirmado) console.log('não confirmou', a.arquivo_nome, r.corpo);
}
let lote = (await json(await rotaLote.GET(pedir('GET', `/api/mudanca/lotes/${L}`), p(L)))).corpo;
eq([lote.situacao, lote.versao > lote.versao_do_ensaio], ['rascunho', true], 'mexer no mapeamento invalida o ensaio (versão sobe)');

console.log('--- (c) Ensaio ---');
ens = await json(await rotaEnsaio.POST(pedir('POST', `/api/mudanca/lotes/${L}/ensaio`), p(L)));
eq(ens.corpo.ensaio.problemas.map(x => x.codigo).sort(), ['LISTA_CORTADA', 'MAPEAMENTO_NAO_CONFIRMADO'], 'arquivo cortado bloqueia a aplicação');
const del = await json(await rotaArquivo.DELETE(pedir('DELETE', `/api/mudanca/lotes/${L}/arquivos/${fX.corpo.id}`), p(L, { arquivoId: fX.corpo.id })));
eq([del.status, del.corpo.arquivos.length], [200, 6], 'remover o arquivo cortado devolve o lote');
ens = await json(await rotaEnsaio.POST(pedir('POST', `/api/mudanca/lotes/${L}/ensaio`), p(L)));
eq([ens.corpo.situacao, ens.corpo.ensaio.pode_aplicar, ens.corpo.ensaio.problemas], ['ensaiado', true, []], 'ensaio limpo');
eq([await conta1(`SELECT COUNT(*)::int AS n FROM contas_receber`), await conta1(`SELECT COUNT(*)::int AS n FROM clientes`), await conta1(`SELECT COUNT(*)::int AS n FROM contas_bancarias`)],
  [0, 1, 2], 'ensaio NÃO grava nada no financeiro');
const res = Object.fromEntries(ens.corpo.resumo_do_ensaio.map(r => [r.tipo_lista, [r.criar, r.vincular, r.recusar]]));
eq(res, { contas: [1, 2, 0], categorias: [1, 1, 0], pessoas: [3, 1, 0], titulos: [4, 0, 2], saldos: [1, 0, 1] },
  'resumo por lista: criar, vincular, recusar');
eq([ens.corpo.ensaio.titulos.receber, ens.corpo.ensaio.titulos.pagar], [{ quantidade: 2, valor: 1500 }, { quantidade: 2, valor: 900.4 }], 'totais dos títulos em reais');
const recus = await json(await rotaEnsaio.GET(pedir('GET', `/api/mudanca/lotes/${L}/ensaio?resultado=recusar`), p(L)));
eq(recus.corpo.linhas.map(l => [l.tipo_lista, l.linha, l.codigo]).sort(),
  [['saldos', 3, 'conta_nao_encontrada'], ['titulos', 2, 'duplicado_no_arquivo'], ['titulos', 7, 'liquidado']].sort(), 'cada recusa com o motivo');
const brad = (await json(await rotaEnsaio.GET(pedir('GET', `/api/mudanca/lotes/${L}/ensaio?tipo_lista=contas&busca=Bradesco`), p(L)))).corpo.linhas[0];
eq([brad.resultado, brad.avisos[0]?.includes('já tem movimento')], ['vincular', true], 'conta com movimento aqui: vincula e avisa que o saldo não muda');
const joao = (await json(await rotaEnsaio.GET(pedir('GET', `/api/mudanca/lotes/${L}/ensaio?busca=Jo%C3%A3o`), p(L)))).corpo.linhas[0];
eq([joao.resultado, joao.avisos.some(a => a.includes('mesmo e-mail'))], ['criar', true], 'mesmo e-mail com nome diferente: pessoa separada, com aviso');
const joana = (await json(await rotaEnsaio.GET(pedir('GET', `/api/mudanca/lotes/${L}/ensaio?busca=Joana`), p(L)))).corpo.linhas[0];
eq([joana.resultado, joana.avisos.some(a => a.includes('não estava cadastrado')), joana.avisos.some(a => a.includes('Conta Antiga'))], ['criar', true, true], 'título com pessoa nova e conta desconhecida');

console.log('--- (d) Aplicar ---');
const ruim = await json(await rotaAplicar.POST(pedir('POST', `/api/mudanca/lotes/${L}/aplicar`, { assinatura: 'velha' }, { 'Idempotency-Key': 'ap-0' }), p(L)));
eq([ruim.status, ruim.corpo.codigo], [409, 'ASSINATURA_VENCIDA'], 'assinatura de outro ensaio: 409');
const ass = (await json(await rotaEnsaio.GET(pedir('GET', `/api/mudanca/lotes/${L}/ensaio`), p(L)))).corpo.assinatura;
const ap = await json(await rotaAplicar.POST(pedir('POST', `/api/mudanca/lotes/${L}/aplicar`, { assinatura: ass }, { 'Idempotency-Key': 'ap-1' }), p(L)));
const ap2 = await json(await rotaAplicar.POST(pedir('POST', `/api/mudanca/lotes/${L}/aplicar`, { assinatura: ass }, { 'Idempotency-Key': 'ap-1' }), p(L)));
eq([ap.status, ap.corpo.situacao, ap2.status, ap2.corpo.situacao], [200, 'aplicado', 200, 'aplicado'], 'aplica (pequeno: termina na hora); mesma chave = mesma resposta');
const prog = (await json(await rotaProgresso.GET(pedir('GET', `/api/mudanca/lotes/${L}/progresso`), p(L)))).corpo;
eq([prog.situacao, prog.feitos === prog.total, prog.etapas.map(e => [e.tipo_lista, e.situacao])],
  ['aplicado', true, [['contas', 'feito'], ['categorias', 'feito'], ['pessoas', 'feito'], ['titulos', 'feito'], ['saldos', 'feito']]], 'progresso por etapa');

const cr = (await query(`SELECT data FROM contas_receber WHERE tenant_id = $1 ORDER BY data->>'data_vencimento'`, [A])).rows.map(r => r.data);
const cp = (await query(`SELECT data FROM contas_pagar WHERE tenant_id = $1 ORDER BY data->>'data_vencimento'`, [A])).rows.map(r => r.data);
eq([cr.map(c => [c.cliente_nome, c.valor_final, c.data_vencimento, c.status, c.parcela_numero, c.total_parcelas]), cp.map(c => [c.fornecedor_nome, c.valor_final, c.data_vencimento])],
  [[['Maria Souza', 1200, '2026-11-10', 'PENDENTE', 1, 3], ['Joana Prado', 300, '2026-11-20', 'PENDENTE', 1, 1]], [['Hotel Sol', 800.5, '2026-11-15'], ['Conceição Turismo', 99.9, '2026-12-05']]],
  'títulos em aberto criados (Latin-1 e serial do Excel lidos certo)');
eq([cr[0].origem_migracao.lote_id === L, cr[0].origem_migracao.arquivo, cr[0].origem_migracao.linha, cr[0].observacoes.includes('Venda Nº 555'), cr[0].conta_bancaria_id], [true, 'novembro.xlsx', 4, true, 'cb-itau'],
  'cada registro guarda o lote e a origem (arquivo, linha); conta prevista ligada');
const clientes = (await query(`SELECT id, nome, cpf_cnpj FROM clientes WHERE tenant_id = $1 ORDER BY nome`, [A])).rows;
eq(clientes.map(c => [c.nome, c.cpf_cnpj]), [['Joana Prado', ''], ['João Souza', ''], ['Maria Souza', '12345678909'], ['Pedro Lima', '']], 'clientes: Pedro ligado ao que existia, João separado da Maria');
const forn = (await query(`SELECT nome_fantasia, cnpj FROM fornecedores_crm WHERE tenant_id = $1 ORDER BY nome_fantasia`, [A])).rows;
eq(forn.map(f => [f.nome_fantasia, f.cnpj]), [['Conceição Turismo', ''], ['Hotel Sol', '12345678000195']], 'fornecedores pelo uso nos títulos a pagar');
const hosp = cp[0].categoria_id;
const pac = (await query(`SELECT id, codigo, data->>'categoria_pai_id' AS pai FROM plano_contas WHERE tenant_id = $1 AND data->>'nome' = 'Pacotes'`, [A])).rows[0];
eq([hosp, cr[0].categoria_id === pac.id, pac.codigo], ['pc-2101', true, '1.1.01'], 'Hospedagem ligada à existente; Pacotes nova debaixo do grupo novo');
const contasDepois = Object.fromEntries((await query(`SELECT data FROM contas_bancarias WHERE tenant_id = $1`, [A])).rows.map(r => [r.data.nome, [r.data.saldo_atual, r.data.saldo_inicial]]));
eq(contasDepois, { 'Itaú': [1000, 1000], Bradesco: [500, 500], 'Caixa Loja': [250, 250] }, 'saldos de abertura: Itaú (sem movimento) e Caixa Loja; Bradesco não muda');
const razao = Object.fromEntries((await query(`SELECT c.data->>'nome' AS nome, r.saldo_centavos AS s FROM razao_saldo_bancario r JOIN contas_bancarias c ON c.id = r.conta_bancaria_id WHERE r.tenant_id = $1`, [A])).rows.map(r => [r.nome, Number(r.s)]));
eq(razao, { 'Itaú': 100000, Bradesco: 50000, 'Caixa Loja': 25000 }, 'razão recebe o lançamento de abertura');

console.log('--- Nada sai enquanto a mudança não termina ---');
eq([typeof (await mudancaSegurandoSaidas(pool, A)), await mudancaSegurandoSaidas(pool, B)], ['string', null], 'agência em mudança segura as saídas; as outras seguem');
const av = await avisarVencimentos(pool, A, new Date('2026-11-21T12:00:00Z'));
eq([av.avisos, av.motivo?.startsWith('nada sai')], [0, true], 'avisos de vencimento seguros até concluir');

console.log('--- (e) Provas ---');
const pr = await json(await rotaProvas.GET(pedir('GET', `/api/mudanca/lotes/${L}/provas`), p(L)));
const pc = Object.fromEntries(pr.corpo.contas.map(c => [c.conta, [c.anterior, c.enturos, c.diferenca, c.explicacoes.map(e => e.codigo)]]));
eq(pc, { 'Itaú': [1000, 1000, 0, []], 'Caixa Loja': [250, 250, 0, []], Bradesco: [900, 500, 400, ['conta_com_movimento']], Nubank: [10, 0, 10, ['conta_nao_encontrada']] },
  'por conta: sistema anterior × EnturOS, cada diferença com motivo');
const maria = pr.corpo.pessoas.find(x => x.pessoa.startsWith('Maria'));
eq([maria.receber_anterior, maria.receber_enturos, maria.diferenca, maria.explicacoes.map(e => [e.linhas, e.valor])], [2400, 1200, 1200, [[1, 1200]]], 'por pessoa: a linha repetida explica a diferença');
const nov = pr.corpo.meses.find(m => m.tipo === 'receber' && m.mes === '2026-11' && m.categoria === 'Pacotes');
eq([nov.anterior, nov.enturos, nov.diferenca], [2400, 1200, 1200], 'por mês × categoria');
eq([pr.corpo.diferencas_sem_explicacao, pr.corpo.arquivos.find(a => a.nome === 'novembro.xlsx').confere, pr.corpo.arquivos.find(a => a.nome === 'contas.xlsx').confere],
  [0, true, true], 'nenhuma diferença sem motivo; somas das planilhas batem com o rodapé');
eq(pr.corpo.fora.map(f => f.codigo), ['liquidado'], 'o já liquidado fica fora da conta, listado');
const pdf = await rotaPdf.GET(pedir('GET', `/api/mudanca/lotes/${L}/provas/pdf`), p(L));
const bytes = new Uint8Array(await pdf.arrayBuffer());
eq([pdf.status, pdf.headers.get('Content-Type'), new TextDecoder().decode(bytes.slice(0, 5))], [200, 'application/pdf', '%PDF-'], 'PDF "Prova da mudança"');

console.log('--- (f) Concluir e segunda mudança pela fila ---');
const pvC = await json(await rotaConcluir.POST(pedir('POST', `/api/mudanca/lotes/${L}/concluir`, { modo: 'previa' }), p(L)));
eq([pvC.corpo.liga.length > 0, pvC.corpo.avisos.some(a => a.includes('ficaram de fora')), typeof pvC.corpo.assinatura], [true, true, 'string'], 'prévia do concluir: o que liga e o que ver');
const gC = await json(await rotaConcluir.POST(pedir('POST', `/api/mudanca/lotes/${L}/concluir`, { modo: 'gravar', assinatura: pvC.corpo.assinatura }, { 'Idempotency-Key': 'cc-1' }), p(L)));
eq([gC.status, gC.corpo.situacao, await mudancaSegurandoSaidas(pool, A)], [200, 'concluido', null], 'concluir libera as saídas');

const c3 = await json(await rotaLotes.POST(pedir('POST', '/api/mudanca/lotes', { data_corte: '2026-11-05' }, { 'Idempotency-Key': 'criar-3' })));
const L2 = c3.corpo.id;
const g1 = await soltar(L2, 'novembro.xlsx', arqTitulos);
const mg = (await json(await rotaMapa.GET(pedir('GET', `/api/mudanca/lotes/${L2}/mapeamento`), p(L2)))).corpo.arquivos[0];
await rotaMapa.PUT(pedir('PUT', `/api/mudanca/lotes/${L2}/mapeamento`, { arquivo_id: mg.arquivo_id, tipo_lista: mg.tipo_lista, colunas: mg.colunas.map(c => ({ indice: c.indice, campo: c.campo })) }), p(L2));
const e2 = await json(await rotaEnsaio.POST(pedir('POST', `/api/mudanca/lotes/${L2}/ensaio`), p(L2)));
eq([g1.status, e2.corpo.resumo_do_ensaio], [200, [{ tipo_lista: 'titulos', criar: 0, vincular: 0, recusar: 4 }]], 'o mesmo mês em outra mudança não duplica');
const r2 = (await json(await rotaEnsaio.GET(pedir('GET', `/api/mudanca/lotes/${L2}/ensaio?resultado=recusar`), p(L2)))).corpo.linhas.map(l => l.codigo).sort();
eq(r2, ['ja_importado', 'ja_importado', 'ja_importado', 'liquidado'], 'motivo: já trazido por outra mudança');
// Um título novo pela fila do agendador (o processador que tarefas.ts vai registrar).
await query(`UPDATE migracao_lotes SET status = 'desfeito' WHERE id = $1`, [L2]);
const L3 = (await json(await rotaLotes.POST(pedir('POST', '/api/mudanca/lotes', { data_corte: '2026-11-05' })))).corpo.id;
await soltar(L3, 'dezembro.csv', latin1('Pessoa;Vencimento;Movimento;Valor Final\r\nAna Fila;10/12/2026;Receber;70,00\r\nBeto Fila;11/12/2026;Receber;30,00\r\n'));
const m3 = (await json(await rotaMapa.GET(pedir('GET', `/api/mudanca/lotes/${L3}/mapeamento`), p(L3)))).corpo.arquivos[0];
await rotaMapa.PUT(pedir('PUT', `/api/mudanca/lotes/${L3}/mapeamento`, { arquivo_id: m3.arquivo_id, tipo_lista: m3.tipo_lista, colunas: m3.colunas.map(c => ({ indice: c.indice, campo: c.campo })) }), p(L3));
await rotaEnsaio.POST(pedir('POST', `/api/mudanca/lotes/${L3}/ensaio`), p(L3));
const lote3 = await srv.lerLote(pool, A, L3);
await emTransacao(exec => srv.iniciarAplicacao(exec, A, L3, lote3.assinatura));
eq((await srv.lerLote(pool, A, L3)).status, 'aplicando', 'aplicação na fila');
fila.registrarProcessador(srv.TIPO_TAREFA_MIGRACAO, srv.processarTarefaMigracao);
const rodada = await fila.processarFila(pool, { orcamentoMs: 5000 });
eq([rodada.processadas, (await srv.lerLote(pool, A, L3)).status, await conta1(`SELECT COUNT(*)::int AS n FROM contas_receber WHERE data->'origem_migracao'->>'lote_id' = $1`, [L3])],
  [2, 'aplicado', 2], 'o processador da fila aplica o lote (e encerra a tarefa que sobrou do primeiro lote)');
await emTransacao(exec => srv.concluirLote(exec, A, L3));

console.log('--- (g) Desfazer ---');
// Depois da mudança: a Joana recebeu, a Maria ganhou uma conta nova fora da mudança, e o
// Hotel Sol teve o valor editado.
const joanaId = (await query(`SELECT id FROM contas_receber WHERE data->>'cliente_nome' = 'Joana Prado'`)).rows[0].id;
await query(`UPDATE contas_receber SET data = data || '{"status":"RECEBIDO","valor_recebido":300}'::jsonb WHERE id = $1`, [joanaId]);
const mariaId = clientes.find(c => c.nome === 'Maria Souza').id;
await query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ('cr-nova', $1, $2, 'PENDENTE', $3::jsonb)`, [A, mariaId, JSON.stringify({ id: 'cr-nova', cliente_id: mariaId, valor_final: 10, status: 'PENDENTE' })]);
await query(`UPDATE contas_pagar SET data = data || '{"valor_final":810}'::jsonb WHERE data->>'fornecedor_nome' = 'Hotel Sol'`);
const pvD = await json(await rotaDesfazer.POST(pedir('POST', `/api/mudanca/lotes/${L}/desfazer`, { modo: 'previa' }), p(L)));
const ficam = pvD.corpo.ficam.map(f => [f.tipo_lista, f.motivo]).sort();
eq(ficam, [
  ['pessoas', 'Usado em lançamentos ou vendas que não são desta mudança.'],
  ['pessoas', 'Usado em lançamentos ou vendas que não são desta mudança.'],
  ['pessoas', 'Usado em lançamentos ou vendas que não são desta mudança.'],
  ['titulos', 'Foi alterado depois da mudança.'],
  ['titulos', 'Recebeu baixa depois da mudança.'],
].sort(), 'prévia: o que fica e por quê (baixa, edição, uso fora da mudança)');
const apagarPrevia = Object.fromEntries(pvD.corpo.apagar.map(a => [a.tipo_lista, a.quantidade]));
eq(apagarPrevia, { titulos: 2, pessoas: 2, centros_custo: 1, categorias: 3, contas: 1, saldos: 2 }, 'prévia: o que sai, inclusive os dois saldos de abertura');
// Algo muda entre a prévia e a confirmação: a assinatura vence.
await query(`UPDATE contas_receber SET data = data || '{"observacoes":"mexi"}'::jsonb WHERE data->>'cliente_nome' = 'Maria Souza' AND id <> 'cr-nova'`);
const vencida = await json(await rotaDesfazer.POST(pedir('POST', `/api/mudanca/lotes/${L}/desfazer`, { modo: 'gravar', assinatura: pvD.corpo.assinatura }, { 'Idempotency-Key': 'df-1' }), p(L)));
eq([vencida.status, vencida.corpo.codigo], [409, 'ASSINATURA_VENCIDA'], 'algo mudou desde a prévia: 409');
const pvD2 = await json(await rotaDesfazer.POST(pedir('POST', `/api/mudanca/lotes/${L}/desfazer`, { modo: 'previa' }), p(L)));
const gD = await json(await rotaDesfazer.POST(pedir('POST', `/api/mudanca/lotes/${L}/desfazer`, { modo: 'gravar', assinatura: pvD2.corpo.assinatura }, { 'Idempotency-Key': 'df-2' }), p(L)));
const gD2 = await json(await rotaDesfazer.POST(pedir('POST', `/api/mudanca/lotes/${L}/desfazer`, { modo: 'gravar', assinatura: pvD2.corpo.assinatura }, { 'Idempotency-Key': 'df-2' }), p(L)));
eq(gD.corpo.ficaram.filter(f => f.tipo_lista !== 'pessoas' && f.tipo_lista !== 'titulos').map(f => [f.tipo_lista, f.motivo]).sort(), [
  ['categorias', 'Tem categorias abaixo dela que ficam.'], ['categorias', 'Usada em lançamentos que não são desta mudança.'],
  ['centros_custo', 'Usado em lançamentos que não são desta mudança.']].sort(), 'o título mexido segura a categoria, o grupo e o centro dele');
eq([gD.status, gD.corpo.lote.situacao, gD.corpo.ficaram.length, gD.corpo.lote.nao_desfeitos.length, gD2.corpo.apagados === gD.corpo.apagados], [200, 'desfeito', 9, 9, true],
  'desfaz; o que ficou volta em nao_desfeitos; repetir a chave dá a mesma resposta');
const sobrou = Object.fromEntries((await query(`SELECT data FROM contas_bancarias WHERE tenant_id = $1`, [A])).rows.map(r => [r.data.nome, [r.data.saldo_atual, r.data.saldo_inicial]]));
eq(sobrou, { 'Itaú': [0, 0], Bradesco: [500, 500] }, 'saldos de abertura estornados; a conta criada saiu; o Bradesco não mudou');
const razao2 = Object.fromEntries((await query(`SELECT conta_bancaria_id AS c, saldo_centavos AS s FROM razao_saldo_bancario WHERE tenant_id = $1 AND conta_bancaria_id IN ('cb-itau','cb-brad')`, [A])).rows.map(r => [r.c, Number(r.s)]));
eq(razao2, { 'cb-itau': 0, 'cb-brad': 50000 }, 'o razão recebe o estorno (nada some em silêncio)');
eq([await conta1(`SELECT COUNT(*)::int AS n FROM contas_receber WHERE data->'origem_migracao'->>'lote_id' = $1`, [L]), await conta1(`SELECT COUNT(*)::int AS n FROM clientes WHERE id = 'cli-pedro'`),
  await conta1(`SELECT COUNT(*)::int AS n FROM plano_contas WHERE id = 'pc-2101'`)],
  [2, 1, 1], 'ficam os títulos mexidos; o que já existia (Pedro, Hospedagem) nunca sai');

globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', B);
eq((await json(await rotaLote.GET(pedir('GET', `/api/mudanca/lotes/${L}`), p(L)))).status, 404, 'outra agência não enxerga o lote');
globalThis.__SESSAO_DE_TESTE__ = null;

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
