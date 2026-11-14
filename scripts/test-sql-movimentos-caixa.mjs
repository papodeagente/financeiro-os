/**
 * Movimentos de caixa (Extrato de conta e Movimentações, 05/11/2026) contra
 * um Postgres real (PGlite), rodando o código DE PRODUÇÃO.
 *
 * Prova:
 *  1. A SOMA BATE: saldo inicial + Σ movimentos (sem as linhas de taxa) =
 *     reconstruirSaldos, conta por conta, e = o saldo que o "Recalcular
 *     saldos" de produção grava. Com as linhas de taxa = "Em caixa hoje"
 *     (calcularSaldoBancario). O espelho em TypeScript gera as mesmas linhas.
 *  2. SALDO LINHA A LINHA, uma conta e várias, com saldo anterior do período.
 *  3. PAGINAÇÃO no servidor: as páginas juntas são a lista inteira.
 *  4. FILTROS, agrupamento, isolamento por agência, exportação segura.
 *  5. DIFERENÇA gravado × reconstruído aparece, nunca é ajustada em silêncio.
 *
 * Uso: node --no-warnings scripts/test-sql-movimentos-caixa.mjs
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

const TABELAS = `
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE clientes (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE fornecedores_crm (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '',
    categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE vendas_crm (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
`;

const pg = new PGlite();
await pg.exec(TABELAS);
const query = async (text, values) => {
  const r = await pg.query(text, values);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
await pg.exec(RAZAO_SCHEMA_SQL);
const { lerFiltro, lerMovimentos, lerParaExportar, csvDosMovimentos, movimentosEspelho, FiltroInvalido } = await import('../src/lib/movimentos-caixa.ts');
const { reconstruirSaldos } = await import('../src/lib/razao.ts');
const { valorMovimentado, calcularSaldoBancario } = await import('../src/lib/saldo-bancario.ts');
const { recalcularSaldosCaixa } = await import('../src/lib/caixa-helpers.ts');

const HOJE = '2026-11-05';
const conta = (id, t, data) => query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1,$2,$3)`, [id, t, JSON.stringify({ id, ...data })]);
const receber = (id, t, data) => query(`INSERT INTO contas_receber (id, tenant_id, status, cliente_id, data) VALUES ($1,$2,$3,$4,$5)`,
  [id, t, data.status ?? 'PENDENTE', data.cliente_id ?? '', JSON.stringify({ id, ...data })]);
const pagar = (id, t, data) => query(`INSERT INTO contas_pagar (id, tenant_id, status, fornecedor_id, data) VALUES ($1,$2,$3,$4,$5)`,
  [id, t, data.status ?? 'PENDENTE', data.fornecedor_id ?? '', JSON.stringify({ id, ...data })]);
const transf = (id, t, data) => query(`INSERT INTO transferencias (id, tenant_id, data) VALUES ($1,$2,$3)`, [id, t, JSON.stringify({ id, ...data })]);

// ---------------------------------------------------------------------------
// Agência t1: três contas (uma é a Caixa Geral) e uma baixa numa conta apagada.
await conta('b1', 't1', { nome: 'Inter', saldo_inicial: 1000, saldo_atual: 1000 });
await conta('b2', 't1', { nome: 'Itaú', saldo_inicial: 500, saldo_atual: 999.99 }); // gravado errado de propósito
await conta('cg', 't1', { nome: 'Caixa Geral', saldo_inicial: 0, saldo_atual: 0 });
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data) VALUES ('c1','t1','Ana','123.456.789-00','{}')`);
await query(`INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, data) VALUES ('f1','t1','Operadora X','12.345.678/0001-90','{}')`);
await query(`INSERT INTO vendas_crm (id, tenant_id, data) VALUES ('v1','t1','{"numero":"V-0042"}')`);

await receber('cr1', 't1', { status: 'RECEBIDO', valor_final: 300, valor_recebido: 300, conta_bancaria_id: 'b1', data_recebimento: '2026-10-05',
  cliente_id: 'c1', cliente_nome: 'Ana', descricao: 'Pacote Gramado', venda_id: 'v1', forma_recebimento: 'PIX', parcela_numero: 1, total_parcelas: 3 });
await receber('cr2', 't1', { status: 'PARCIAL', valor_final: 250, valor_recebido: 100, conta_bancaria_id: 'b1', data_recebimento: '2026-10-10',
  cliente_nome: 'Bruno', descricao: 'Parcial', forma_recebimento: 'TED' });
await receber('cr3', 't1', { status: 'RECEBIDO', valor_final: 200, valor_recebido: 0, conta_bancaria_id: null, data_recebimento: '2026-10-12',
  cliente_nome: 'Carla', descricao: '=HYPERLINK("x")', forma_recebimento: 'DINHEIRO' });
await receber('cr4', 't1', { status: 'PENDENTE', valor_final: 999, conta_bancaria_id: 'b1', data_vencimento: '2026-10-20' });
await receber('cr5', 't1', { status: 'CANCELADO', valor_final: 80, valor_recebido: 80, conta_bancaria_id: 'b1', data_recebimento: '2026-10-21' });
await receber('cr6', 't1', { status: 'RECEBIDO', valor_final: 1000, valor_recebido: 1000, taxa: 30, taxa_plataforma: 'Stone', conta_bancaria_id: 'b2',
  data_recebimento: '2026-11-02', cliente_nome: 'Daniel', descricao: 'Cartão na maquininha', forma_recebimento: 'CARTAO' });
await receber('cr7', 't1', { status: 'RECEBIDO', valor_final: 100, valor_recebido: 95, conta_bancaria_id: 'b2', data_recebimento: '2026-11-03',
  cliente_nome: 'Eva', descricao: 'Curso · Hotmart', plataforma_origem: 'hotmart', plataforma_cartao_final: '4242', forma_recebimento: 'CARTAO' });
await receber('cr8', 't1', { status: 'RECEBIDO', valor_final: 70, valor_recebido: 70, conta_bancaria_id: 'apagada', data_recebimento: '2026-10-01' });
await receber('cr9', 't1', { status: 'RECEBIDO', valor_final: 50, valor_recebido: 50, conta_bancaria_id: 'b1', data_recebimento: '', data_vencimento: '' });
await pagar('cp1', 't1', { status: 'PAGO', valor_final: 120, valor_pago: 120, conta_bancaria_id: 'b1', data_pagamento: '2026-10-07',
  fornecedor_id: 'f1', fornecedor_nome: 'Operadora X', descricao: 'Repasse', forma_pagamento: 'PIX', moeda: 'USD', cambio: 5.4 });
await pagar('cp2', 't1', { status: 'PARCIAL', valor_final: 90, valor_pago: 40, conta_bancaria_id: 'b2', data_pagamento: '2026-11-04',
  fornecedor_nome: 'Aluguel', descricao: 'Aluguel', forma_pagamento: 'BOLETO' });
await pagar('cp3', 't1', { status: 'PAGO', valor_final: 15, valor_pago: 15, conta_bancaria_id: '', data_pagamento: '2026-10-12', descricao: 'Café' });
await pagar('cp4', 't1', { status: 'PENDENTE', valor_final: 500, conta_bancaria_id: 'b1', data_vencimento: '2026-11-30' });
await transf('t1', 't1', { status: 'EFETIVADA', valor: 200, conta_origem_id: 'b1', conta_origem_nome: 'Inter', conta_destino_id: 'b2', conta_destino_nome: 'Itaú', data: '2026-10-15' });
await transf('t2', 't1', { status: 'PENDENTE', valor: 300, conta_origem_id: 'b1', conta_destino_id: 'b2', data: '2026-10-16' });
await transf('t3', 't1', { status: 'EFETIVADA', valor: 0, conta_origem_id: 'b1', conta_destino_id: 'b2', data: '2026-10-17' });
// Outra agência: nada dela pode aparecer.
await conta('z1', 't2', { nome: 'Outra', saldo_inicial: 7, saldo_atual: 7 });
await receber('zr1', 't2', { status: 'RECEBIDO', valor_final: 9, valor_recebido: 9, conta_bancaria_id: 'b1', data_recebimento: '2026-10-05' });

const filtro = (q = '') => lerFiltro(new URLSearchParams(q), HOJE);
const ler = (q) => lerMovimentos(pool, 't1', filtro(q));
const dados = async (t) => {
  const c = (await query(`SELECT id, data FROM contas_bancarias WHERE tenant_id = $1`, [t])).rows;
  const r = (await query(`SELECT data FROM contas_receber WHERE tenant_id = $1`, [t])).rows.map(x => x.data);
  const p = (await query(`SELECT data FROM contas_pagar WHERE tenant_id = $1`, [t])).rows.map(x => x.data);
  const tr = (await query(`SELECT data FROM transferencias WHERE tenant_id = $1`, [t])).rows.map(x => x.data);
  return { c, r, p, tr };
};

console.log('--- 1. A soma bate com reconstruirSaldos e com o "Em caixa hoje" ---');
const d = await dados('t1');
const rec = reconstruirSaldos({
  contas: d.c.map(x => ({ id: x.id, data: x.data })),
  receber: d.r.filter(x => ['RECEBIDO', 'PARCIAL'].includes(x.status)),
  pagar: d.p.filter(x => ['PAGO', 'PARCIAL'].includes(x.status)),
  transferencias: d.tr.filter(x => x.status === 'EFETIVADA'),
  caixaGeralId: 'cg',
  valorMovimentado: (x, campo) => valorMovimentado(x, campo),
});
const tudo = await ler('de=2000-01-01&ate=2100-12-31&por_pagina=500');
for (const c of tudo.contas) eq(c.saldo_reconstruido, rec.saldos[c.id], `reconstruído = reconstruirSaldos (${c.id})`);
eq(rec.saldos, { b1: 1130, b2: 1755, cg: 185 }, 'números de referência (b1: 1000+300+100+50−120−200; b2: 500+1000+95−40+200; cg: 200−15)');
eq(tudo.contas.map(c => [c.id, c.taxas]), [['cg', 0], ['b1', 0], ['b2', 30]], 'taxa retida aparece só na conta da baixa (Caixa Geral, Inter, Itaú por nome)');
eq(tudo.contas.find(c => c.id === 'b2').saldo_final, 1725, 'com a linha de taxa, o saldo da Itaú é o que caiu no banco (1755 − 30)');
const semOrfa = d.r.filter(x => x.conta_bancaria_id !== 'apagada');
eq(round(tudo.saldo_final), calcularSaldoBancario(d.c.map(x => x.data), semOrfa, d.p),
  'Σ saldos finais com taxa = "Em caixa hoje" (calcularSaldoBancario), tirando a baixa na conta apagada');
eq(tudo.linhas.some(l => l.registro_id === 'cr8'), false, 'baixa numa conta que não existe mais fica fora (como no reconstruído)');
eq(tudo.linhas.some(l => ['cr4', 'cr5', 'cp4', 't2', 't3'].some(id => l.registro_id === id)), false, 'pendente, cancelada, transferência pendente ou zerada: fora');
eq(tudo.linhas.some(l => l.registro_id === 'zr1' || l.conta_id === 'z1'), false, 'isolamento: nada da outra agência');

const espelho = movimentosEspelho({ contas: d.c.map(x => ({ id: x.id, data: x.data })), receber: d.r, pagar: d.p, transferencias: d.tr, taxas: true });
eq(tudo.linhas.some(l => l.registro_id === 'cr9'), false, 'baixa sem data não entra em período nenhum (fica no saldo anterior)');
const doSql = tudo.linhas.map(l => [l.chave, l.conta_id, l.data, Math.round(l.valor * 100)]).sort((a, b) => a[0].localeCompare(b[0]));
eq(doSql, espelho.filter(l => l.data !== '').map(l => [l.chave, l.conta_id, l.data, l.centavos]).sort((a, b) => a[0].localeCompare(b[0])), 'SQL e espelho TypeScript geram as mesmas linhas, centavo por centavo');

const semTaxa = await ler('de=2000-01-01&ate=2100-12-31&taxas=0');
eq(semTaxa.linhas.some(l => l.origem === 'taxa'), false, 'taxas=0: sem as linhas de taxa');
eq(semTaxa.contas.find(c => c.id === 'b2').saldo_final, 1755, 'taxas=0: saldo final = reconstruído');

console.log('--- 2. Gravado × reconstruído: a diferença aparece e o recálculo a fecha ---');
eq(tudo.contas.find(c => c.id === 'b2').diferenca, -755.01, 'Itaú gravado 999,99 × reconstruído 1755: diferença mostrada, nada ajustado');
eq(Number((await query(`SELECT data->>'saldo_atual' AS s FROM contas_bancarias WHERE id='b2'`)).rows[0].s), 999.99, 'a leitura não grava nada');
await recalcularSaldosCaixa('t1');
const depois = await ler('de=2000-01-01&ate=2100-12-31');
eq(depois.contas.map(c => [c.id, c.diferenca]), [['cg', 0], ['b1', 0], ['b2', 0]], 'depois do "Recalcular saldos" de produção: gravado = soma dos movimentos em todas as contas');

console.log('--- 3. Saldo linha a linha: uma conta ---');
const inter = await ler('contas=b1&de=2026-10-01&ate=2026-10-31');
eq(inter.saldo_anterior, 1050, 'saldo anterior de outubro na Inter = inicial 1000 + baixa sem data 50');
let corrido = inter.saldo_anterior;
let linhaOk = true;
for (const l of inter.linhas) { corrido = round(corrido + l.valor); if (l.saldo_conta !== corrido || l.saldo_total !== corrido) linhaOk = false; }
eq(linhaOk, true, 'cada linha: saldo = anterior + valor (conta e total coincidem com uma conta só)');
eq(inter.linhas.map(l => [l.data, l.valor, l.saldo_conta]),
  [['2026-10-05', 300, 1350], ['2026-10-07', -120, 1230], ['2026-10-10', 100, 1330], ['2026-10-15', -200, 1130]], 'linhas de outubro da Inter, na ordem');
eq(inter.saldo_final, 1130, 'saldo final do período = última linha');
eq([inter.totais.entradas, inter.totais.saidas, inter.totais.liquido, inter.total], [400, 320, 80, 4], 'totais do recorte');

console.log('--- 4. Várias contas ---');
const duas = await ler('contas=b1,b2&de=2026-10-01&ate=2026-11-30');
eq(duas.saldo_anterior, 1550, 'saldo anterior somado (1050 + 500)');
let corrTotal = duas.saldo_anterior;
const porConta = { b1: 1050, b2: 500 };
let ok2 = true;
for (const l of duas.linhas) {
  corrTotal = round(corrTotal + l.valor);
  porConta[l.conta_id] = round(porConta[l.conta_id] + l.valor);
  if (l.saldo_total !== corrTotal || l.saldo_conta !== porConta[l.conta_id]) ok2 = false;
}
eq(ok2, true, 'saldo da conta e saldo total corridos linha a linha nas duas contas');
const transfLinhas = duas.linhas.filter(l => l.origem === 'transferencia').map(l => [l.conta_id, l.valor, l.descricao]);
eq(transfLinhas, [['b2', 200, 'Transferência de Inter'], ['b1', -200, 'Transferência para Itaú']], 'transferência: entrada no destino antes da saída na origem, no mesmo dia');
eq(duas.saldo_final, round(1130 + 1725), 'saldo final somado (Inter 1130 + Itaú 1725)');

console.log('--- 5. Paginação no servidor ---');
const inteira = (await ler('de=2000-01-01&ate=2100-12-31&por_pagina=500')).linhas.map(l => l.chave);
const juntas = [];
for (let p = 1; p <= 10; p++) {
  const pg2 = await ler(`de=2000-01-01&ate=2100-12-31&por_pagina=3&pagina=${p}`);
  juntas.push(...pg2.linhas.map(l => l.chave));
  if (p === 1) eq([pg2.total, pg2.total_paginas, pg2.linhas.length], [inteira.length, Math.ceil(inteira.length / 3), 3], 'página 1: total e número de páginas');
  if (p >= pg2.total_paginas) break;
}
eq(juntas, inteira, 'as páginas juntas são exatamente a lista inteira, sem repetir nem pular');
const alem = await ler('de=2000-01-01&ate=2100-12-31&por_pagina=3&pagina=999');
eq(alem.pagina, alem.total_paginas, 'página além do fim volta para a última');
const desc = await ler('contas=b1&de=2026-10-01&ate=2026-10-31&direcao=desc');
eq(desc.linhas.map(l => l.saldo_conta), [1130, 1330, 1230, 1350], 'ordem decrescente: o saldo de cada linha não muda com a ordem');
const porValor = await ler('contas=b1&de=2026-10-01&ate=2026-10-31&ordem=valor');
eq(porValor.linhas.map(l => l.valor), [-200, -120, 100, 300], 'ordenar por valor');

console.log('--- 6. Filtros, enriquecimento e agrupamento ---');
const saidas = await ler('de=2000-01-01&ate=2100-12-31&tipo=saida');
eq(saidas.linhas.every(l => l.valor < 0), true, 'tipo=saida só traz saídas');
const porCpf = await ler('de=2000-01-01&ate=2100-12-31&busca=123.456');
eq(porCpf.linhas.map(l => [l.registro_id, l.cpf_cnpj, l.venda_numero, l.numero]), [['cr1', '123.456.789-00', 'V-0042', '1/3']], 'busca pelo CPF; venda e parcela ligadas');
const porForn = await ler('de=2000-01-01&ate=2100-12-31&pessoa=operadora');
eq(porForn.linhas.map(l => [l.registro_id, l.cpf_cnpj, l.moeda, l.valor_origem, l.cambio]), [['cp1', '12.345.678/0001-90', 'USD', 120, 5.4]], 'pessoa (fornecedor) com CNPJ, moeda e câmbio');
const pix = await ler('de=2000-01-01&ate=2100-12-31&forma=PIX');
eq(pix.linhas.map(l => l.registro_id).sort(), ['cp1', 'cr1'], 'forma de pagamento');
eq(pix.saldo_final, tudo.saldo_final, 'filtro de busca não mexe nos saldos das contas');
const comPercent = await ler('de=2000-01-01&ate=2100-12-31&busca=%25');
eq(comPercent.total, 0, 'busca com % é literal (escapada)');
const hot = await ler('de=2000-01-01&ate=2100-12-31&busca=4242');
eq(hot.linhas.map(l => [l.registro_id, l.valor, l.cartao_cheque, l.plataforma]), [['cr7', 95, '4242', 'hotmart']], 'crédito de plataforma entra pelo líquido, com o cartão');
const agrup = await ler('de=2000-01-01&ate=2100-12-31&agrupar=conta');
eq(agrup.grupos.map(g => [g.chave, g.entradas, g.saidas, g.quantidade]),
  [['Caixa Geral', 200, 15, 2], ['Inter', 400, 320, 4], ['Itaú', 1295, 70, 5]], 'grupos por conta com somas do recorte inteiro (a baixa sem data fica no saldo anterior)');
eq(agrup.linhas.map(l => l.conta_nome).join(',') === [...agrup.linhas.map(l => l.conta_nome)].sort((a, b) => a.localeCompare(b)).join(','), true, 'agrupado: linhas vêm na ordem do grupo');
eq(tudo.formas, ['BOLETO', 'CARTAO', 'DINHEIRO', 'PIX', 'TED', 'Transferência'], 'formas disponíveis para o filtro');

console.log('--- 7. Validação e exportação ---');
const erro = (q) => { try { filtro(q); return null; } catch (e) { return e instanceof FiltroInvalido ? 'invalido' : String(e); } };
eq([erro('de=2026-13-1'), erro('de=2026-11-10&ate=2026-11-01'), erro('ordem=drop'), erro('por_pagina=501'), erro('tipo=x'), erro('agrupar=1;')],
  ['invalido', 'invalido', 'invalido', 'invalido', 'invalido', 'invalido'], 'parâmetros fora de forma são recusados');
eq([filtro('').de, filtro('').ate, filtro('').taxas], ['2026-11-01', HOJE, true], 'padrão: mês corrente até hoje, com taxas');
const exp = await lerParaExportar(pool, 't1', filtro('de=2000-01-01&ate=2100-12-31&busca=HYPERLINK'));
const csv = csvDosMovimentos(exp, 'extrato');
eq(csv.startsWith('﻿"Data";"Conta"'), true, 'CSV com BOM e cabeçalho entre aspas');
eq(csv.includes(`"'=HYPERLINK(""x"")"`), true, 'fórmula neutralizada e aspas escapadas (auditCsvCell)');
eq(csv.includes('"200,00"'), true, 'valor com vírgula decimal, como número');
const csvMov = csvDosMovimentos(exp, 'movimentacoes');
eq(csvMov.split('\r\n')[0], '﻿"Data";"Número";"Venda";"Conta";"Forma de pagamento";"Pessoa";"Documento";"Cheque/Cartão";"Moeda";"Valor origem";"Câmbio";"Movimento";"Valor";"Fechado"', 'colunas das Movimentações (com Fechado, E7 frente D)');
eq(csv.split('\r\n')[0].endsWith('"Saldo";"Fechado"'), true, 'extrato: a coluna Fechado no fim do CSV (E7, frente D)');

function round(n) { return Math.round(n * 100) / 100; }
console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
