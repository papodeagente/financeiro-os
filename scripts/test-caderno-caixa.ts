/**
 * Caderno de fluxo de caixa (src/lib/caderno-caixa.ts).
 *
 * O que não pode quebrar:
 *   1) O saldo da linha de hoje é o "Saldo atual" da tela (calcularSaldoBancario),
 *      taxa das plataformas incluída. Se divergir, o caderno mente sobre o banco.
 *   2) O saldo final de um período é o saldo inicial do seguinte, em todos os
 *      tipos de período. Se não fechar, virar a página some com dinheiro.
 *   3) As linhas somam o período, em qualquer agrupamento.
 *   4) Conta vencida e não paga é esperada HOJE: não infla o passado nem some.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-caderno-caixa.ts
 */
import {
  agrupamentoPadrao, agrupamentosDoPeriodo, competenciasDaFolha, dataPorExtenso, lancamentosDoCaixa,
  montarCaderno, ordenarLancamentos, periodoQueContem, periodoVizinho,
  type Agrupamento, type TipoDePeriodo,
} from '../src/lib/caderno-caixa.ts';
import { calcularSaldoBancario } from '../src/lib/saldo-bancario.ts';
import { round2, somaPor } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const HOJE = '2026-10-07';

// ── períodos ──────────────────────────────────────────────────────────────
console.log('--- o período que contém hoje ---');
const p = (t: TipoDePeriodo, d = HOJE) => periodoQueContem(t, d);
eq([p('mes').inicio, p('mes').fim, p('mes').rotulo], ['2026-10-01', '2026-10-31', 'Outubro de 2026'], 'mês');
eq([p('bimestre').inicio, p('bimestre').fim, p('bimestre').rotulo, p('bimestre').meses], ['2026-09-01', '2026-10-31', '5º bimestre de 2026', 'set a out'], 'bimestre do calendário');
eq([p('trimestre').inicio, p('trimestre').fim, p('trimestre').rotulo], ['2026-10-01', '2026-12-31', '4º trimestre de 2026'], 'trimestre');
eq([p('semestre').inicio, p('semestre').fim, p('semestre').rotulo], ['2026-07-01', '2026-12-31', '2º semestre de 2026'], 'semestre');
eq([p('ano').inicio, p('ano').fim, p('ano').rotulo], ['2026-01-01', '2026-12-31', '2026'], 'ano');
eq(p('mes', '2028-02-10').fim, '2028-02-29', 'fevereiro bissexto');
eq(p('mes', '2026-02-10').fim, '2026-02-28', 'fevereiro comum');

console.log('--- andar para trás e para a frente ---');
eq(periodoVizinho(p('mes', '2026-01-15'), -1).rotulo, 'Dezembro de 2025', 'janeiro volta para dezembro do ano anterior');
eq(periodoVizinho(p('trimestre'), 1).rotulo, '1º trimestre de 2027', '4º trimestre avança para o 1º do ano seguinte');
eq(periodoVizinho(p('bimestre', '2026-02-01'), -1).rotulo, '6º bimestre de 2025', '1º bimestre volta para o 6º');
eq(periodoVizinho(p('semestre'), -1).inicio, '2026-01-01', 'semestre anterior');
eq(periodoVizinho(p('ano'), 2).rotulo, '2028', 'dois anos à frente');
eq(periodoVizinho(p('mes', '2026-01-31'), 1).fim, '2026-02-28', '31 de janeiro + 1 mês não pula fevereiro');

// ── base de contas ────────────────────────────────────────────────────────
const cr = (id: string, extra: Record<string, unknown>) => ({
  id, cliente_nome: `Cliente ${id}`, descricao: `Venda ${id}`, valor_final: 0, valor_recebido: 0, taxa: 0,
  status: 'PENDENTE', data_vencimento: '', data_recebimento: null, ...extra,
}) as never;
const cp = (id: string, extra: Record<string, unknown>) => ({
  id, fornecedor_nome: `Fornecedor ${id}`, descricao: `Compra ${id}`, valor_final: 0, valor_pago: 0,
  status: 'PENDENTE', data_vencimento: '', data_pagamento: null, ...extra,
}) as never;

const contas = [{ saldo_inicial: 10000 }, { saldo_inicial: 2500.5 }] as never[];
const receber = [
  // recebida em setembro, com taxa de plataforma
  cr('r1', { status: 'RECEBIDO', valor_final: 247, valor_recebido: 247, taxa: 24.45, taxa_plataforma: 'Hotmart', plataforma_origem: 'hotmart', descricao: 'EnturOS CRM · hotmart', data_vencimento: '2026-09-10', data_recebimento: '2026-09-12' }),
  // parcial: 300 entraram hoje, 700 vencem dia 20
  cr('r2', { status: 'PARCIAL', valor_final: 1000, valor_recebido: 300, data_vencimento: '2026-10-20', data_recebimento: '2026-10-07' }),
  // vencida em 02/10 e não paga
  cr('r3', { status: 'PENDENTE', valor_final: 500, data_vencimento: '2026-10-02' }),
  // vencida em setembro e não paga
  cr('r4', { status: 'PENDENTE', valor_final: 800, data_vencimento: '2026-09-25' }),
  // futura, em novembro
  cr('r5', { status: 'PENDENTE', valor_final: 1200, data_vencimento: '2026-11-05' }),
  // cancelada: não existe para o caixa
  cr('r6', { status: 'CANCELADO', valor_final: 9999, valor_recebido: 9999, data_vencimento: '2026-10-03', data_recebimento: '2026-10-03' }),
  // status fora do enum: nem o saldo atual nem o caderno contam a baixa
  cr('r7', { status: 'recebido', valor_final: 50, valor_recebido: 50, data_vencimento: '2026-10-01', data_recebimento: '2026-10-01' }),
  // recebida sem data nenhuma: mexeu no banco, não sabemos quando
  cr('r8', { status: 'RECEBIDO', valor_final: 100, valor_recebido: 100 }),
];
const pagar = [
  cp('p1', { status: 'PAGO', valor_final: 2000, valor_pago: 2000, data_vencimento: '2026-10-05', data_pagamento: '2026-10-05' }),
  cp('p2', { status: 'PENDENTE', valor_final: 3000, data_vencimento: '2026-10-15' }),
  cp('p3', { status: 'PENDENTE', valor_final: 150, data_vencimento: '2026-10-01' }),
  cp('p4', { status: 'PARCIAL', valor_final: 900, valor_pago: 400, data_vencimento: '2026-12-10', data_pagamento: '2026-10-06' }),
];
const folha = [{ competencia: '2026-10', descricao: 'Folha de 2026-10 · 3 pessoas', valor: 4500, data_pagamento: '2026-11-05' }];
const lanc = lancamentosDoCaixa({ receber, pagar, folha, hoje: HOJE });
const achar = (id: string) => lanc.find(l => l.id === id);

console.log('--- os lançamentos ---');
eq(achar('cr-r1-baixa')?.valor, 222.55, 'entrada realizada vale o que caiu no banco (247 - 24,45)');
eq(achar('cr-r1-baixa')?.taxa, 24.45, 'e guarda a taxa para mostrar');
eq([achar('cr-r1-baixa')?.plataforma, achar('cr-r1-baixa')?.descricao], ['Hotmart', 'EnturOS CRM'], 'plataforma vira etiqueta e sai da descrição');
eq([achar('cr-r2-baixa')?.valor, achar('cr-r2-aberto')?.valor, achar('cr-r2-aberto')?.data], [300, 700, '2026-10-20'], 'parcial vira o que entrou + o que falta, no vencimento');
eq([achar('cr-r3-aberto')?.data, achar('cr-r3-aberto')?.situacao, achar('cr-r3-aberto')?.vencimento], [HOJE, 'atrasado', '2026-10-02'], 'vencida e não paga é esperada hoje, marcada como atrasada');
eq(lanc.some(l => l.id.startsWith('cr-r6')), false, 'cancelada não entra');
eq(achar('cr-r7-baixa'), undefined, 'status fora do enum não conta como recebido');
eq(lanc.some(l => l.id.startsWith('cr-r7')), false, '... nem como aberta (recebido = valor): fica fora, como no saldo atual');
eq(achar('cr-r8-baixa')?.data, '', 'recebida sem data fica sem data');
eq([achar('folha-2026-10')?.valor, achar('folha-2026-10')?.situacao, achar('folha-2026-10')?.tipo], [4500, 'previsto', 'saida'], 'folha é saída prevista');

// ── o invariante do banco ─────────────────────────────────────────────────
console.log('--- a linha de hoje é o saldo atual ---');
const saldoAtual = calcularSaldoBancario(contas as never, receber as never, pagar as never);
for (const tipo of ['mes', 'bimestre', 'trimestre', 'semestre', 'ano'] as TipoDePeriodo[]) {
  // Só realizados: o saldo atual não sabe de previsão.
  const soFatos = lanc.filter(l => l.situacao === 'realizado');
  const c = montarCaderno({ lancamentos: soFatos, contas: contas as never, periodo: p(tipo), agrupamento: 'dia', hoje: HOJE });
  eq(c.saldoDeHoje, saldoAtual, `${tipo}: saldo de hoje = saldo atual (${saldoAtual})`);
}

// ── a página vira sem perder centavo ──────────────────────────────────────
console.log('--- o fim de um período é o começo do seguinte ---');
let fecham = 0, conferidos = 0;
for (const tipo of ['mes', 'bimestre', 'trimestre', 'semestre', 'ano'] as TipoDePeriodo[]) {
  let atual = periodoQueContem(tipo, '2026-01-15');
  for (let i = 0; i < 14; i++) {
    const seguinte = periodoVizinho(atual, 1);
    const a = montarCaderno({ lancamentos: lanc, contas: contas as never, periodo: atual, agrupamento: 'dia', hoje: HOJE });
    const b = montarCaderno({ lancamentos: lanc, contas: contas as never, periodo: seguinte, agrupamento: 'dia', hoje: HOJE });
    conferidos++;
    if (a.saldoFinal === b.saldoInicial && b.periodo.inicio === addUmDia(a.periodo.fim)) fecham++;
    else console.log(`        não fechou: ${a.periodo.rotulo} → ${b.periodo.rotulo}: ${a.saldoFinal} × ${b.saldoInicial}`);
    atual = seguinte;
  }
}
function addUmDia(d: string): string {
  const [a, m, dia] = d.split('-').map(Number);
  const x = new Date(a, m - 1, dia + 1, 12);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
eq(fecham, conferidos, `as ${conferidos} viradas de página fecham e não deixam dia de fora`);

console.log('--- as linhas somam o período em qualquer agrupamento ---');
let somam = 0, casos = 0;
for (const tipo of ['mes', 'bimestre', 'trimestre', 'semestre', 'ano'] as TipoDePeriodo[]) {
  for (const ag of ['dia', 'semana', 'mes'] as Agrupamento[]) {
    const c = montarCaderno({ lancamentos: lanc, contas: contas as never, periodo: p(tipo), agrupamento: ag, hoje: HOJE });
    casos++;
    const ok = somaPor(c.linhas, l => l.entradas) === c.entradas
      && somaPor(c.linhas, l => l.saidas) === c.saidas
      && (c.linhas.length === 0 || c.linhas[c.linhas.length - 1].saldo === c.saldoFinal)
      && c.curva[c.curva.length - 1].saldo === c.saldoFinal
      && c.curva[0].data === c.periodo.inicio && c.curva[c.curva.length - 1].data === c.periodo.fim;
    if (ok) somam++;
    else console.log(`        não somou: ${tipo} por ${ag}`);
  }
}
eq(somam, casos, `linhas, saldo final e curva batem nos ${casos} casos`);

// ── outubro, o mês de hoje ────────────────────────────────────────────────
console.log('--- outubro dia a dia ---');
const out = montarCaderno({ lancamentos: lanc, contas: contas as never, periodo: p('mes'), agrupamento: 'dia', hoje: HOJE });
// 10000 + 2500,50 + 222,55 (r1 em set) + 100 (r8 sem data) = 12823,05
eq(out.saldoInicial, 12823.05, 'saldo de 1º/10 = contas + o que já tinha acontecido');
eq(out.linhas.map(l => l.inicio), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-15', '2026-10-20'], 'só os dias com movimento, mais hoje');
const hoje = out.linhas.find(l => l.contemHoje)!;
// hoje: +300 (r2) +500 (r3 atrasada) +800 (r4 atrasada de setembro) -150 (p3 atrasada)
eq([hoje.entradas, hoje.saidas], [1600, 150], 'hoje recebe as atrasadas de qualquer mês');
eq(ordenarLancamentos(hoje.lancamentos).map(l => l.situacao)[0], 'realizado', 'no dia, o que já aconteceu vem antes do previsto');
eq(out.linhas.find(l => l.inicio === '2026-10-15')?.futura, true, 'dia depois de hoje é linha futura');
eq(out.jaEntrou, 300, 'já entrou em outubro: só a baixa de hoje');
eq(out.jaSaiu, 2400, 'já saiu: 2000 pagos dia 5 + 400 da parcial dia 6');
eq(out.vencidasForaDoPeriodo.quantidade, 0, 'em outubro nada vencido ficou fora (todas estão em hoje)');

console.log('--- outubro por semana ---');
const outSem = montarCaderno({ lancamentos: lanc, contas: contas as never, periodo: p('mes'), agrupamento: 'semana', hoje: HOJE });
eq(outSem.linhas.map(l => l.rotulo), ['1 a 3 out', '4 a 10 out', '11 a 17 out', '18 a 24 out', '25 a 31 out'], 'semanas de domingo a sábado, cortadas no mês');

console.log('--- setembro, mês que já passou ---');
const set = montarCaderno({ lancamentos: lanc, contas: contas as never, periodo: periodoQueContem('mes', '2026-09-01'), agrupamento: 'dia', hoje: HOJE });
eq([set.entradas, set.saidas], [222.55, 0], 'só fatos: a r4 vencida não aparece em setembro');
eq(set.vencidasForaDoPeriodo, { quantidade: 1, valor: 800 }, 'mas o caderno avisa que ela venceu ali e está em hoje');

console.log('--- novembro, mês que ainda vem ---');
const nov = montarCaderno({ lancamentos: lanc, contas: contas as never, periodo: periodoQueContem('mes', '2026-11-01'), agrupamento: 'dia', hoje: HOJE });
eq(nov.saldoInicial, out.saldoFinal, 'abre com o fim previsto de outubro');
eq([nov.entradas, nov.saidas], [1200, 4500], 'r5 entra dia 5 e a folha sai dia 5');
eq(nov.saldoDeHoje, null, 'hoje não está em novembro');

console.log('--- saldo negativo ---');
const apertado = montarCaderno({ lancamentos: lanc, contas: [{ saldo_inicial: 0 }] as never, periodo: p('mes'), agrupamento: 'dia', hoje: HOJE });
eq(apertado.primeiroDiaNegativo, '2026-10-05', 'aponta o primeiro dia em que o saldo fica negativo');

console.log('--- folha ---');
eq(competenciasDaFolha(p('mes'), HOJE), ['2026-09', '2026-10'], 'mês atual: a folha de setembro (paga em outubro) e a de outubro');
eq(competenciasDaFolha(p('ano'), HOJE), ['2026-09', '2026-10', '2026-11', '2026-12'], 'ano: de setembro até dezembro');
eq(competenciasDaFolha(periodoQueContem('mes', '2026-08-01'), HOJE), [], 'mês passado não prevê folha');

console.log('--- textos ---');
eq(dataPorExtenso('2026-10-07'), 'Quarta-feira, 7 de outubro', 'data por extenso');
eq(agrupamentoPadrao('mes'), 'dia', 'mês abre dia a dia');
eq(agrupamentoPadrao('ano'), 'mes', 'ano abre por mês');
eq(agrupamentosDoPeriodo('mes'), ['dia', 'semana'], 'mês não oferece "por mês"');
eq(round2(0.1 + 0.2), 0.3, 'sanidade do arredondamento');

console.log(`\n${total - falhas}/${total} testes do caderno de caixa passaram`);
if (falhas > 0) process.exit(1);
