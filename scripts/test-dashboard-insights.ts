/**
 * As observações automáticas e os fatores de saúde.
 *
 * POR QUE CADA REGRA É TESTADA NOS DOIS LADOS. "Insight automático" é o lugar
 * mais fácil de um sistema inventar: uma frase bem escrita sobre um cálculo que
 * ninguém conferiu, e o dono decide em cima dela. O teste que importa não é o
 * que prova que a frase aparece — é o que prova que ela NÃO aparece quando a
 * base não sustenta.
 */
import {
  calcularFatoresDeSaude, classificarSaude, gerarInsights,
  CONCENTRACAO_DE_RISCO_PCT, INADIMPLENCIA_GRAVE_PCT, MARGEM_SAUDAVEL_PCT,
} from '../src/lib/dashboard-insights.ts';
import type { DashboardFinanceiro } from '../src/lib/dashboard-financeiro.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Uma agência saudável. Cada teste muda só o que quer provar. */
function base(): DashboardFinanceiro {
  return {
    periodo: { de: '2026-09-01', ate: '2026-09-30', hoje: '2026-09-15', deAnterior: '2026-08-01', ateAnterior: '2026-08-31' },
    caixa: {
      saldo: 90000, saldoInicialDasContas: 10000,
      entradas: { atual: 50000, anterior: 48000, variacao: 4.17 },
      saidas: { atual: 30000, anterior: 29000, variacao: 3.45 },
      resultado: { atual: 20000, anterior: 19000, variacao: 5.26 },
      repasses: 20000,
      despesasProprias: { atual: 10000, anterior: 9800, variacao: 2.04 },
    },
    posicao: {
      receber: { emAberto: 40000, vencido: 0, venceHoje: 0, aVencer: 40000, contas: 8, contasVencidas: 0 },
      pagar: { emAberto: 15000, vencido: 0, venceHoje: 0, aVencer: 15000, contas: 4, contasVencidas: 0 },
    },
    aging: { receber: [], pagar: [] },
    serie: [],
    projecao: [
      { dias: 7, data: '2026-09-22', entradas: 8000, saidas: 4000, saldoProjetado: 94000 },
      { dias: 90, data: '2026-12-14', entradas: 40000, saidas: 15000, saldoProjetado: 115000 },
    ],
    receitaPorOrigem: [{ id: 'VENDA', nome: 'Do cliente', valor: 48000, contas: 10 }],
    despesaPorCategoria: [],
    fornecedores: [
      { id: 'a', nome: 'CVC', valor: 10000, contas: 3 },
      { id: 'b', nome: 'Azul', valor: 10000, contas: 3 },
      { id: 'c', nome: 'Latam', valor: 10000, contas: 3 },
    ],
    margemPorFornecedor: [],
    clientes: [],
    agenda: [],
    descasamento: [],
    vendas: { volume: 200000, receitaAgencia: 40000, custo: 160000, quantidade: 10, margemPct: 20, ticketVolume: 20000, ticketReceita: 4000, semLastro: { quantidade: 0, volume: 0 } },
    atencao: {
      pagarVencido: { valor: 0, contas: 0 }, receberVencido: { valor: 0, contas: 0 },
      venceHoje: { receber: 0, pagar: 0 }, semFornecedor: 0, semVencimento: 0,
      naoCategorizadas: { valor: 0, contas: 0 },
    },
    cobertura: { meses: 9, despesaMensal: 10000 },
  };
}
const ids = (d: DashboardFinanceiro) => gerarInsights(d, brl).map(i => i.id);
const acha = (d: DashboardFinanceiro, id: string) => gerarInsights(d, brl).find(i => i.id === id) ?? null;

// ══════════════════════════════════════════════════════════════════════
console.log('--- a agência saudável não recebe alarme ---');
{
  const insights = gerarInsights(base(), brl);
  eq(insights.some(i => i.tom === 'critico'), false, 'nada crítico numa agência em ordem');
  eq(ids(base()).includes('pagar-vencido'), false, 'sem conta vencida, sem frase de conta vencida');
  eq(ids(base()).includes('caixa-negativo'), false, 'sem projeção negativa, sem alarme de caixa');
  eq(ids(base()).includes('descasamento'), false, 'sem descasamento, sem frase');
  eq(ids(base()).includes('concentracao'), false, 'três fornecedores iguais não concentram');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- toda frase carrega o número que a sustenta ---');
{
  const d = base();
  d.posicao.pagar = { ...d.posicao.pagar, vencido: 8000, contasVencidas: 2 };
  for (const i of gerarInsights(d, brl)) {
    // Um insight sem evidência é opinião. As poucas exceções são frases que já
    // contêm o número no texto.
    const temNumero = Boolean(i.evidencia) || /\d/.test(i.texto);
    eq(temNumero, true, `"${i.id}" dá para conferir`);
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- base zero não vira +100% ---');
{
  const d = base();
  // É o caso real: primeiro mês de operação. variacaoPct devolve null, e a
  // frase de crescimento simplesmente não nasce.
  d.caixa.entradas = { atual: 50000, anterior: 0, variacao: null };
  d.caixa.despesasProprias = { atual: 10000, anterior: 0, variacao: null };
  eq(ids(d).includes('entradas-variaram'), false, 'crescer de zero não vira frase de crescimento');
  eq(ids(d).includes('despesa-subiu'), false, 'despesa que nasce do zero não vira alarme de aumento');
}
{
  const d = base();
  d.caixa.entradas = { atual: 60000, anterior: 48000, variacao: 25 };
  const i = acha(d, 'entradas-variaram');
  eq(i?.tom, 'positivo', 'crescimento de 25% aparece como positivo');
  eq(i?.texto.includes('25%'), true, 'com o número na frase');
}
{
  const d = base();
  d.caixa.entradas = { atual: 30000, anterior: 48000, variacao: -37.5 };
  const i = acha(d, 'entradas-variaram');
  eq(i?.tom, 'atencao', 'queda vira atenção');
  eq(i?.texto.includes('caíram'), true, 'e a frase diz "caíram", não "cresceram -37%"');
}
{
  const d = base();
  d.caixa.entradas = { atual: 50400, anterior: 50000, variacao: 0.8 };
  eq(ids(d).includes('entradas-variaram'), false, 'variação de menos de 10% não merece frase');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- caixa projetado negativo é o alarme mais alto ---');
{
  const d = base();
  d.projecao[0] = { dias: 7, data: '2026-09-22', entradas: 2000, saidas: 40000, saldoProjetado: -12000 };
  const insights = gerarInsights(d, brl);
  eq(insights[0].id, 'caixa-negativo', 'vem primeiro na lista');
  eq(insights[0].tom, 'critico', 'e é crítico');
  eq(insights[0].texto.includes('7 dias'), true, 'diz em quantos dias');
  eq(insights[0].evidencia?.includes('22/09'), true, 'e em que data');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- inadimplência muda de tom conforme a fatia ---');
{
  const d = base();
  d.posicao.receber = { emAberto: 40000, vencido: 2000, venceHoje: 0, aVencer: 38000, contas: 8, contasVencidas: 1 };
  eq(acha(d, 'receber-vencido')?.tom, 'atencao', '5% vencido é atenção');
}
{
  const d = base();
  d.posicao.receber = { emAberto: 40000, vencido: 12000, venceHoje: 0, aVencer: 28000, contas: 8, contasVencidas: 5 };
  eq(acha(d, 'receber-vencido')?.tom, 'critico', `acima de ${INADIMPLENCIA_GRAVE_PCT}% vira crítico`);
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- concentração de fornecedor ---');
{
  const d = base();
  d.fornecedores = [
    { id: 'a', nome: 'CVC', valor: 50000, contas: 8 },
    { id: 'b', nome: 'Azul', valor: 10000, contas: 2 },
  ];
  const i = acha(d, 'concentracao');
  eq(i !== null, true, `${CONCENTRACAO_DE_RISCO_PCT}% ou mais num fornecedor vira observação`);
  eq(i?.texto.includes('CVC'), true, 'com o nome de quem concentra');
}
{
  const d = base();
  d.fornecedores = [];
  eq(ids(d).includes('concentracao'), false, 'sem fornecedor, sem divisão por zero e sem frase');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- margem apertada ---');
{
  const d = base();
  d.vendas = { ...d.vendas, margemPct: 8 };
  eq(acha(d, 'margem-apertada') !== null, true, `abaixo de ${MARGEM_SAUDAVEL_PCT}% vira observação`);
}
{
  const d = base();
  d.vendas = { ...d.vendas, margemPct: null, quantidade: 0, volume: 0, receitaAgencia: 0 };
  eq(ids(d).includes('margem-apertada'), false, 'sem venda no período, nada a dizer sobre margem');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o aperto de turismo ---');
{
  const d = base();
  d.descasamento = [
    { vendaId: 'v1', numero: '1045', cliente: 'X', primeiroPagamento: '2026-09-18', primeiroRecebimento: '2026-10-10', diasDeGap: 22, valorAdiantado: 8000 },
    { vendaId: 'v2', numero: '1046', cliente: 'Y', primeiroPagamento: '2026-09-19', primeiroRecebimento: '2026-10-01', diasDeGap: 12, valorAdiantado: 3000 },
  ];
  const i = acha(d, 'descasamento');
  eq(i?.evidencia?.includes('11.000'), true, 'soma o que a agência está bancando');
  eq(i?.evidencia?.includes('22 dias'), true, 'e nomeia o pior caso');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- a lista é ordenada por gravidade ---');
{
  const d = base();
  d.projecao[0] = { dias: 7, data: '2026-09-22', entradas: 0, saidas: 40000, saldoProjetado: -5000 };
  d.posicao.pagar = { ...d.posicao.pagar, vencido: 3000, contasVencidas: 1 };
  d.atencao.semVencimento = 2;
  const pesos = gerarInsights(d, brl).map(i => i.peso);
  eq(pesos.every((p, k) => k === 0 || pesos[k - 1] >= p), true, 'o mais grave vem primeiro');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- fatores de saúde ---');
{
  const f = Object.fromEntries(calcularFatoresDeSaude(base()).map(x => [x.id, x.faixa]));
  eq(f, { folego: 'bom', projecao: 'bom', inadimplencia: 'bom', margem: 'bom', compromissos: 'bom' }, 'a agência saudável dá bom em tudo');
  eq(classificarSaude(calcularFatoresDeSaude(base())), 'bom', 'e a classificação geral é boa');
}
{
  const d = base();
  d.cobertura = { meses: 0.4, despesaMensal: 10000 };
  const fatores = calcularFatoresDeSaude(d);
  eq(fatores.find(f => f.id === 'folego')?.faixa, 'risco', 'menos de um mês de fôlego é risco');
  // A regra é visível: um fator em risco derruba a classificação inteira, e é
  // isso que a tela escreve.
  eq(classificarSaude(fatores), 'risco', 'o pior fator manda na classificação');
}
{
  const d = base();
  d.vendas = { ...d.vendas, margemPct: 12 };
  eq(classificarSaude(calcularFatoresDeSaude(d)), 'atencao', 'um fator em atenção e nenhum em risco dá atenção');
}
{
  // Agência recém-cadastrada: nada aconteceu ainda.
  const d = base();
  d.cobertura = { meses: null, despesaMensal: 0 };
  d.projecao = [];
  d.posicao.receber = { emAberto: 0, vencido: 0, venceHoje: 0, aVencer: 0, contas: 0, contasVencidas: 0 };
  d.posicao.pagar = { emAberto: 0, vencido: 0, venceHoje: 0, aVencer: 0, contas: 0, contasVencidas: 0 };
  d.vendas = { ...d.vendas, margemPct: null, quantidade: 0 };
  const fatores = calcularFatoresDeSaude(d);
  const semBase = fatores.filter(f => f.faixa === 'sem-base');
  eq(semBase.length, 4, 'quatro fatores dizem que não têm base');
  // "Não sei" e "zero" são coisas diferentes: a marca não pode cair em zero,
  // porque zero na régua lê como "o pior possível".
  eq(semBase.every(f => f.posicao === null), true, 'fator sem base não desenha marca');
  eq(fatores.find(f => f.id === 'compromissos')?.faixa, 'bom', 'nenhuma conta vencida continua sendo bom');
  eq(classificarSaude(fatores), 'bom', 'com um fator com base e ele bom, a classificação é boa');
  eq(classificarSaude([]), 'sem-base', 'sem fator nenhum, a classificação se declara sem base');
}
{
  // O caso que separa "atrasado" de "quebrado": o vencido é maior que o caixa.
  const d = base();
  d.caixa.saldo = 2000;
  d.posicao.pagar = { ...d.posicao.pagar, vencido: 8000, contasVencidas: 3 };
  eq(calcularFatoresDeSaude(d).find(f => f.id === 'compromissos')?.faixa, 'risco', 'vencido maior que o caixa é risco');
}
{
  const d = base();
  d.caixa.saldo = 50000;
  d.posicao.pagar = { ...d.posicao.pagar, vencido: 8000, contasVencidas: 3 };
  eq(calcularFatoresDeSaude(d).find(f => f.id === 'compromissos')?.faixa, 'atencao', 'vencido que o caixa cobre é atenção');
}
{
  // A régua nunca sai do intervalo, senão a marca desenha fora do trilho.
  const d = base();
  d.cobertura = { meses: 400, despesaMensal: 10 };
  d.vendas = { ...d.vendas, margemPct: 300 };
  const fatores = calcularFatoresDeSaude(d);
  eq(fatores.every(f => f.posicao === null || (f.posicao >= 0 && f.posicao <= 1)), true, 'a posição na régua fica entre 0 e 1');
}

console.log(`\n${total - falhas}/${total} testes dos insights passaram`);
if (falhas > 0) process.exit(1);
