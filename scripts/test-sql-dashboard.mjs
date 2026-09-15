/**
 * Prova que as expressões SQL do dashboard dizem EXATAMENTE o mesmo que o
 * TypeScript canônico de resultado-financeiro.ts.
 *
 * POR QUE ESTE TESTE É DIFERENCIAL. Mover a agregação para o SQL resolve a
 * performance e cria um risco pior: uma segunda definição de dinheiro,
 * divergente da que já é lei no sistema. Asserção com valor esperado escrito à
 * mão não pega isso — ela só prova que o SQL concorda comigo, não que concorda
 * com o resto do sistema.
 *
 * Então aqui a MESMA linha passa pelos dois caminhos e os resultados são
 * comparados. Se alguém mudar valorRealizado e esquecer o SQL (ou o contrário),
 * este teste quebra, que é a única coisa que impede o dashboard de mostrar um
 * número e o DRE outro para o mesmo mês.
 *
 * Roda com: node --no-warnings scripts/test-sql-dashboard.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

register('./ts-resolve-hook.mjs', import.meta.url);
const lib = async n => import(pathToFileURL(path.resolve(import.meta.dirname, `../src/lib/${n}.ts`)).href);

const { valorRealizado, valorEmAberto, estaCancelada } = await lib('resultado-financeiro');
const { realizado, emAberto, numerico, numeroDoBanco, EH_REPASSE, ORIGEM_RECEBER } = await lib('dashboard-sql');

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_receber (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
    venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '', status TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE contas_pagar (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
    fornecedor_id TEXT DEFAULT '', status TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

// ══════════════════════════════════════════════════════════════════════
// A matriz de casos. Cada linha já derrubou um número real em algum lugar
// deste sistema, e é por isso que ela está aqui.
// ══════════════════════════════════════════════════════════════════════
const CASOS = [
  { nome: 'pendente: previsão não é dinheiro',        status: 'PENDENTE',  valor_final: 1000,   baixa: null },
  { nome: 'pendente com campo de baixa sujo',          status: 'PENDENTE',  valor_final: 1000,   baixa: 400 },
  { nome: 'parcial guarda o ACUMULADO baixado',        status: 'PARCIAL',   valor_final: 1000,   baixa: 400 },
  { nome: 'parcial quase quitada',                     status: 'PARCIAL',   valor_final: 1000,   baixa: 999.99 },
  { nome: 'parcial de centavo',                        status: 'PARCIAL',   valor_final: 1000,   baixa: 0.01 },
  { nome: 'quitada com o campo preenchido',            status: 'QUITADO',   valor_final: 1000,   baixa: 1000 },
  { nome: 'quitada com desconto (baixou menos)',       status: 'QUITADO',   valor_final: 1000,   baixa: 950 },
  { nome: 'quitada com juros (baixou mais)',           status: 'QUITADO',   valor_final: 1000,   baixa: 1080 },
  { nome: 'quitada legada, campo de baixa nulo',       status: 'QUITADO',   valor_final: 1000,   baixa: null },
  { nome: 'quitada com baixa ZERO cai no cheio',       status: 'QUITADO',   valor_final: 1000,   baixa: 0 },
  { nome: 'cancelada não existe para número',          status: 'CANCELADO', valor_final: 1000,   baixa: 1000 },
  { nome: 'valor com centavos quebrados',              status: 'PARCIAL',   valor_final: 333.33, baixa: 111.11 },
  { nome: 'valor_final texto não derruba a query',     status: 'PENDENTE',  valor_final: 'mil',  baixa: null },
  { nome: 'baixa texto não derruba a query',           status: 'PARCIAL',   valor_final: 1000,   baixa: 'quatrocentos' },
  { nome: 'valor_final ausente',                       status: 'PENDENTE',  valor_final: null,   baixa: null },
  { nome: 'baixa maior que o total não vira negativo', status: 'PARCIAL',   valor_final: 100,    baixa: 250 },
  { nome: 'status desconhecido não vira realizado',    status: 'AGUARDANDO', valor_final: 1000,  baixa: 700 },
  { nome: 'status vazio',                              status: '',          valor_final: 1000,   baixa: 700 },
];

for (const lado of ['receber', 'pagar']) {
  const tabela = lado === 'receber' ? 'contas_receber' : 'contas_pagar';
  const campoBaixa = lado === 'receber' ? 'valor_recebido' : 'valor_pago';
  const quitado = lado === 'receber' ? 'RECEBIDO' : 'PAGO';

  console.log(`\n--- ${lado}: o SQL diz o mesmo que valorRealizado() ---`);

  for (const [i, caso] of CASOS.entries()) {
    const status = caso.status === 'QUITADO' ? quitado : caso.status;
    const doc = { status, valor_final: caso.valor_final, [campoBaixa]: caso.baixa };
    const id = `${lado}-${i}`;
    await pg.query(`INSERT INTO ${tabela} (id, tenant_id, status, data) VALUES ($1,$2,$3,$4)`,
      [id, 't1', status, JSON.stringify(doc)]);

    const { rows } = await pg.query(
      `SELECT ${realizado(lado)} AS realizado, ${emAberto(lado)} AS em_aberto
         FROM ${tabela} WHERE id = $1`, [id]);

    // O mesmo documento, pelo caminho canônico em TypeScript.
    const esperadoRealizado = valorRealizado(doc, campoBaixa);
    const esperadoEmAberto = valorEmAberto(doc, campoBaixa);

    eq(numeroDoBanco(rows[0].realizado), esperadoRealizado, `${lado} realizado — ${caso.nome}`);
    eq(numeroDoBanco(rows[0].em_aberto), esperadoEmAberto, `${lado} em aberto — ${caso.nome}`);
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o total agregado bate com a soma linha a linha ---');
{
  // Não basta cada linha bater: a SOMA em SQL tem que bater com somaPor() em
  // JS, que arredonda o acumulado a cada passo. É onde o erro de centavo mora.
  const { soma: somaTS } = await lib('money');
  const { rows: todas } = await pg.query(`SELECT data FROM contas_receber WHERE tenant_id = 't1'`);
  const porTS = somaTS(todas.map(r => valorRealizado(r.data, 'valor_recebido')));
  const { rows: agregado } = await pg.query(
    `SELECT ROUND(SUM(${realizado('receber')}), 2) AS total FROM contas_receber WHERE tenant_id = 't1'`);
  eq(numeroDoBanco(agregado[0].total), porTS, 'soma do realizado a receber: SQL = somaPor()');

  const cancel = todas.filter(r => estaCancelada(r.data)).length;
  eq(cancel > 0, true, 'a matriz inclui cancelada, senão o teste não provaria nada');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- repasse ao fornecedor não é despesa ---');
{
  await pg.query(`DELETE FROM contas_pagar`);
  const novo = (id, doc) => pg.query(`INSERT INTO contas_pagar (id, tenant_id, data) VALUES ($1,'t2',$2)`, [id, JSON.stringify(doc)]);
  // O custo da viagem, gerado pela própria venda: já saiu dentro da margem.
  await novo('p1', { status: 'PAGO', valor_final: 16500, valor_pago: 16500, auto_gerado: true, origem: 'VENDA' });
  // Despesa de verdade da agência.
  await novo('p2', { status: 'PAGO', valor_final: 3000, valor_pago: 3000, auto_gerado: false, origem: 'DESPESA_FIXA' });
  // Conta criada à mão sobre uma venda: não é repasse automático.
  await novo('p3', { status: 'PAGO', valor_final: 500, valor_pago: 500, origem: 'VENDA' });

  const q = async cond => {
    const { rows } = await pg.query(
      `SELECT COALESCE(ROUND(SUM(${realizado('pagar')}), 2), 0) AS t FROM contas_pagar WHERE tenant_id='t2' AND ${cond}`);
    return numeroDoBanco(rows[0].t);
  };
  eq(await q(`NOT ${EH_REPASSE}`), 3500, 'despesa exclui o repasse: 3.000 + 500, nunca os 16.500');
  eq(await q(`TRUE`), 20000, 'saída de CAIXA inclui o repasse: o dinheiro saiu mesmo');
  eq(await q(EH_REPASSE), 16500, 'o repasse é isolável para aparecer como repasse');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- origem da receita: venda e comissão não se somam ---');
{
  await pg.query(`DELETE FROM contas_receber`);
  const novo = (id, doc) => pg.query(`INSERT INTO contas_receber (id, tenant_id, data) VALUES ($1,'t3',$2)`, [id, JSON.stringify(doc)]);
  await novo('r1', { status: 'RECEBIDO', valor_final: 20000, valor_recebido: 20000, origem: 'VENDA' });
  await novo('r2', { status: 'RECEBIDO', valor_final: 1200, valor_recebido: 1200, origem: 'COMISSAO_FORNECEDOR' });
  await novo('r3', { status: 'RECEBIDO', valor_final: 300, valor_recebido: 300 }); // sem origem
  await novo('r4', { status: 'RECEBIDO', valor_final: 150, valor_recebido: 150, origem: '' }); // origem vazia

  const { rows } = await pg.query(
    `SELECT ${ORIGEM_RECEBER} AS origem, ROUND(SUM(${realizado('receber')}), 2) AS t
       FROM contas_receber WHERE tenant_id='t3' GROUP BY 1 ORDER BY 1`);
  const mapa = Object.fromEntries(rows.map(r => [r.origem, numeroDoBanco(r.t)]));
  eq(mapa, { COMISSAO_FORNECEDOR: 1200, VENDA: 20450 }, 'origem ausente e vazia contam como VENDA');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- isolamento de tenant ---');
{
  await pg.query(`INSERT INTO contas_receber (id, tenant_id, data) VALUES ('x1','OUTRA',$1)`,
    [JSON.stringify({ status: 'RECEBIDO', valor_final: 999999, valor_recebido: 999999 })]);
  const { rows } = await pg.query(
    `SELECT COALESCE(ROUND(SUM(${realizado('receber')}), 2), 0) AS t FROM contas_receber WHERE tenant_id = $1`, ['t3']);
  eq(numeroDoBanco(rows[0].t), 21650, 'a conta da outra agência não entra na soma');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- o conversor não confunde ponto decimal com milhar ---');
{
  // O driver devolve NUMERIC como '8000.0000'. O parser pt-BR leria isso como
  // oitenta mil. Já derrubou o investimento no simulador de funis.
  eq(numeroDoBanco('8000.0000'), 8000, 'string decimal SQL vira o número certo');
  eq(numeroDoBanco('1234.56'), 1234.56, 'centavos preservados');
  eq(numeroDoBanco(null), 0, 'nulo é zero');
  eq(numeroDoBanco('abc'), 0, 'lixo é zero, não NaN na tela');
  eq(numeroDoBanco(-500), -500, 'negativo passa: resultado do mês pode ser negativo');
}

console.log(`\n${total - falhas}/${total} testes do SQL do dashboard passaram`);
process.exit(falhas > 0 ? 1 : 0);
