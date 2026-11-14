/**
 * DRE (src/lib/resultado-dre.ts), 05/11/2026.
 *
 * PORTEIRO: a conta saiu da tela /financeiro-ag/dre para a lib. No regime de
 * competência ela tem de dar EXATAMENTE as linhas de antes. `dreAntiga` abaixo
 * é a cópia fiel do buildDRE que morava na tela; os dois são comparados linha
 * a linha, e os números também ficam fixados à mão.
 *
 * Depois: regime de caixa (venda paga em dois meses, despesa paga noutro mês,
 * parcial), clique no número (lançamentos somam a linha) e orçado.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-demonstrativo-resultado.ts
 */
import {
  comissaoNaoCapturadaPorConta, mesAnterior, montarDRE, orcadoPorLinha, type LinhaDRE,
} from '../src/lib/resultado-dre.ts';
import { apenasVendasComLastro, vendasComLancamento } from '../src/lib/venda-lancamentos.ts';
import { divSegura, mesDe, num, round2, soma, somaPor } from '../src/lib/money.ts';
import type { ContaPagar, ContaReceber, PlanoContas, VendaCRM } from '../src/lib/crm-types.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

// ── Cópia fiel da regra que morava em src/app/financeiro-ag/dre/page.tsx ────
interface DRELine { codigo: string; nome: string; valor: number; tipo: 'header' | 'item' | 'subtotal' | 'total'; indent: number }
const PCT = (v: number) => `${v.toFixed(1)}%`;
function dreAntiga(month: string, contasReceber: ContaReceber[], contasPagar: ContaPagar[], vendasComLastro: VendaCRM[], planoContas: PlanoContas[], comissaoNaoCapturada: Map<string, number>): DRELine[] {
  if (!month) return [];
  const vivo = (s: string | undefined) => String(s ?? '') !== 'CANCELADO';
  const monthReceber = contasReceber.filter(cr => mesDe(cr.data_vencimento) === month && vivo(cr.status));
  const monthPagar = contasPagar.filter(cp => mesDe(cp.data_vencimento) === month && vivo(cp.status));
  const monthVendas = vendasComLastro.filter(v => mesDe(v.data_venda) === month && v.status !== 'CANCELADO');
  const volumeIntermediado = somaPor(monthVendas, v => v.valor_final);
  const comissaoVendas = somaPor(monthVendas, v => Math.max(round2(num(v.valor_final) - num(v.valor_total_custo)), 0));
  const receitaComissoes = somaPor(monthReceber.filter(cr => cr.origem === 'COMISSAO_FORNECEDOR'), cr => round2(num(comissaoNaoCapturada.get(cr.id) ?? num(cr.valor_final))));
  const receitaFee = somaPor(monthReceber.filter(cr => cr.origem === 'FEE'), cr => cr.valor_final);
  const receitaOutras = somaPor(monthReceber.filter(cr => cr.origem === 'OUTROS'), cr => cr.valor_final);
  const receitaBruta = soma([comissaoVendas, receitaComissoes, receitaFee, receitaOutras]);
  const ehRepasseDeVenda = (cp: ContaPagar) => !!cp.auto_gerado && cp.origem === 'VENDA';
  const idsDoPrefixo = (prefixo: string) => planoContas.filter(p => p.codigo?.startsWith(prefixo)).map(p => p.id);
  function sumByCategory(prefix: string): number {
    const catIds = new Set(idsDoPrefixo(prefix));
    return somaPor(monthPagar.filter(cp => catIds.has(cp.categoria_id)), cp => cp.valor_final);
  }
  const despOperacionais = sumByCategory('2.2');
  const despComerciais = sumByCategory('2.6');
  const despTaxas = sumByCategory('2.3');
  const taxasDePlataforma = somaPor(monthReceber, cr => Math.max(0, num(cr.taxa)));
  const despFinanceiras = round2(sumByCategory('2.4') + taxasDePlataforma);
  const despOutras = sumByCategory('2.5');
  const idsCMV = new Set(idsDoPrefixo('2.1'));
  const despCMV = somaPor(monthPagar.filter(cp => idsCMV.has(cp.categoria_id) && !ehRepasseDeVenda(cp)), cp => cp.valor_final);
  const PREFIXOS_DRE = ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6'];
  const idsConhecidos = new Set(PREFIXOS_DRE.flatMap(idsDoPrefixo));
  const uncategorized = somaPor(monthPagar.filter(cp => !idsConhecidos.has(cp.categoria_id) && !ehRepasseDeVenda(cp)), cp => cp.valor_final);
  const totalDespesas = soma([despOperacionais, despComerciais, despTaxas, despFinanceiras, despOutras, despCMV, uncategorized]);
  const outrasDespesas = soma([despOutras, despCMV, uncategorized]);
  const receitaLiquida = round2(receitaBruta - despTaxas);
  const resultadoOperacional = round2(receitaLiquida - despOperacionais - despComerciais);
  const lucroLiquido = round2(receitaBruta - totalDespesas);
  const margemLiquida = round2(divSegura(lucroLiquido, receitaBruta) * 100);
  const margemSobreVolume = round2(divSegura(receitaBruta, volumeIntermediado) * 100);
  const lines: DRELine[] = [];
  if (volumeIntermediado > 0) {
    lines.push({ codigo: '', nome: 'VOLUME INTERMEDIADO (informativo)', valor: volumeIntermediado, tipo: 'header', indent: 0 });
    lines.push({ codigo: '0.1', nome: 'Total transacionado (passagens, hotéis, etc.)', valor: volumeIntermediado, tipo: 'item', indent: 1 });
  }
  lines.push(
    { codigo: '', nome: 'RECEITA BRUTA (comissão + serviços)', valor: receitaBruta, tipo: 'header', indent: 0 },
    { codigo: '1.1', nome: 'Comissão sobre vendas', valor: comissaoVendas, tipo: 'item', indent: 1 },
    { codigo: '1.2', nome: 'Comissões de fornecedores', valor: receitaComissoes, tipo: 'item', indent: 1 },
    { codigo: '1.3', nome: 'Fee de serviço', valor: receitaFee, tipo: 'item', indent: 1 },
    { codigo: '1.5', nome: 'Outras receitas', valor: receitaOutras, tipo: 'item', indent: 1 },
    { codigo: '', nome: '(-) IMPOSTOS SOBRE A RECEITA', valor: -despTaxas, tipo: 'header', indent: 0 },
    { codigo: '2.3', nome: 'ISS, PIS, COFINS e outros', valor: despTaxas, tipo: 'item', indent: 1 },
    { codigo: '', nome: 'RECEITA LÍQUIDA', valor: receitaLiquida, tipo: 'subtotal', indent: 0 },
    { codigo: '', nome: '(-) DESPESAS OPERACIONAIS', valor: -(despOperacionais + despComerciais), tipo: 'header', indent: 0 },
    { codigo: '2.2', nome: 'Despesas operacionais (aluguel, salários, etc.)', valor: despOperacionais, tipo: 'item', indent: 1 },
    { codigo: '2.6', nome: 'Despesas comerciais (marketing, comissão vendedor)', valor: despComerciais, tipo: 'item', indent: 1 },
    { codigo: '', nome: 'RESULTADO OPERACIONAL', valor: resultadoOperacional, tipo: 'subtotal', indent: 0 },
    { codigo: '', nome: '(-) DESPESAS FINANCEIRAS', valor: -despFinanceiras, tipo: 'header', indent: 0 },
    { codigo: '2.4', nome: 'Juros, tarifas bancárias', valor: round2(despFinanceiras - taxasDePlataforma), tipo: 'item', indent: 1 },
    ...(taxasDePlataforma > 0 ? [{ codigo: '2.4', nome: 'Taxas de plataformas de pagamento', valor: taxasDePlataforma, tipo: 'item' as const, indent: 1 }] : []),
  );
  if (outrasDespesas !== 0) {
    lines.push({ codigo: '', nome: '(-) OUTRAS DESPESAS', valor: -outrasDespesas, tipo: 'header', indent: 0 });
    if (despOutras !== 0) lines.push({ codigo: '2.5', nome: 'Outras despesas', valor: despOutras, tipo: 'item', indent: 1 });
    if (despCMV !== 0) lines.push({ codigo: '2.1', nome: 'Custos diretos (CMV)', valor: despCMV, tipo: 'item', indent: 1 });
    if (uncategorized !== 0) lines.push({ codigo: '', nome: 'Não categorizadas', valor: uncategorized, tipo: 'item', indent: 1 });
  }
  lines.push(
    { codigo: '', nome: 'LUCRO LÍQUIDO', valor: lucroLiquido, tipo: 'total', indent: 0 },
    { codigo: '', nome: `Margem líquida (sobre receita): ${PCT(margemLiquida)}`, valor: margemLiquida, tipo: 'item', indent: 0 },
    { codigo: '', nome: `Margem sobre volume intermediado: ${PCT(margemSobreVolume)}`, valor: margemSobreVolume, tipo: 'item', indent: 0 },
  );
  return lines;
}

// ── Massa de teste ──────────────────────────────────────────────────────────
const plano = (id: string, codigo: string, nome: string): PlanoContas =>
  ({ id, codigo, nome, tipo: 'DESPESA', categoria_pai_id: null, natureza_custo: null, is_custo_comercial: false, ativo: true });
const planoContas: PlanoContas[] = [
  plano('p21', '2.1', 'CMV'), plano('p22', '2.2', 'Operacionais'), plano('p2201', '2.2.01', 'Aluguel'),
  plano('p23', '2.3', 'Impostos'), plano('p24', '2.4', 'Financeiras'), plano('p25', '2.5', 'Outras'), plano('p26', '2.6', 'Comerciais'),
];
const venda = (id: string, data_venda: string, valor_final: number, valor_total_custo: number, status = 'FECHADA') =>
  ({ id, numero: id.toUpperCase(), data_venda, valor_final, valor_total_custo, status }) as unknown as VendaCRM;
const cr = (o: Partial<ContaReceber> & { id: string }) => ({ origem: 'VENDA', status: 'PENDENTE', cliente_nome: 'Cliente', descricao: o.id, taxa: 0, ...o }) as ContaReceber;
const cp = (o: Partial<ContaPagar> & { id: string }) => ({ origem: 'OUTROS', status: 'PENDENTE', fornecedor_nome: 'Fornecedor', descricao: o.id, categoria_id: '', ...o }) as ContaPagar;

const vendas = [
  venda('v1', '2026-10-05', 1000, 800),
  venda('v2', '2026-10-10', 500, 500),
  venda('v3', '2026-10-12', 1000, 900, 'CANCELADO'),
];
const receber: ContaReceber[] = [
  cr({ id: 'cr1', venda_id: 'v1', valor_final: 600, data_vencimento: '2026-10-05', status: 'RECEBIDO', valor_recebido: 600, data_recebimento: '2026-10-05', taxa: 12 }),
  cr({ id: 'cr2', venda_id: 'v1', valor_final: 400, data_vencimento: '2026-11-05', status: 'RECEBIDO', valor_recebido: 400, data_recebimento: '2026-11-06' }),
  cr({ id: 'cr3', origem: 'COMISSAO_FORNECEDOR', origem_venda_id: 'v1', valor_final: 150, data_vencimento: '2026-10-20' }),
  cr({ id: 'cr4', origem: 'COMISSAO_FORNECEDOR', venda_id: 'v2', valor_final: 80, data_vencimento: '2026-10-25', status: 'RECEBIDO', valor_recebido: 80, data_recebimento: '2026-10-26' }),
  cr({ id: 'cr5', origem: 'FEE', valor_final: 50, data_vencimento: '2026-10-15', status: 'PARCIAL', valor_recebido: 30, data_recebimento: '2026-10-16' }),
  cr({ id: 'cr6', origem: 'OUTROS', valor_final: 20, data_vencimento: '2026-10-01', status: 'CANCELADO' }),
];
const pagar: ContaPagar[] = [
  cp({ id: 'cp1', categoria_id: 'p2201', valor_final: 1000, data_vencimento: '2026-10-10', status: 'PAGO', valor_pago: 1000, data_pagamento: '2026-11-02' }),
  cp({ id: 'cp2', categoria_id: 'p23', valor_final: 60, data_vencimento: '2026-10-20', status: 'PAGO', valor_pago: 60, data_pagamento: '2026-10-20' }),
  cp({ id: 'cp3', categoria_id: 'p21', origem: 'VENDA', auto_gerado: true, origem_venda_id: 'v1', valor_final: 800, data_vencimento: '2026-10-06', status: 'PAGO', valor_pago: 800, data_pagamento: '2026-10-06' }),
  cp({ id: 'cp4', categoria_id: 'p21', valor_final: 40, data_vencimento: '2026-10-07' }),
  cp({ id: 'cp5', categoria_id: '', valor_final: 25, data_vencimento: '2026-10-08', status: 'PAGO', valor_pago: 25, data_pagamento: '2026-10-08' }),
  cp({ id: 'cp6', categoria_id: 'p24', valor_final: 10, data_vencimento: '2026-10-09', status: 'PAGO', valor_pago: 10, data_pagamento: '2026-10-09' }),
  cp({ id: 'cp7', categoria_id: 'p26', valor_final: 100, data_vencimento: '2026-10-30' }),
];

const comLastro = apenasVendasComLastro(vendas, vendasComLancamento(receber, pagar));
const naoCapturada = comissaoNaoCapturadaPorConta(receber, comLastro);
const dre = (mes: string, regime: 'competencia' | 'caixa' = 'competencia') =>
  montarDRE({ receber, pagar, vendasComLastro: comLastro, planoContas, comissaoNaoCapturada: naoCapturada, mes, regime });
const semLancamentos = (l: LinhaDRE[]) => l.map(({ lancamentos: _l, ...r }) => r);
const valor = (l: LinhaDRE[], nome: string) => l.find(x => x.nome === nome)?.valor ?? null;

console.log('--- porteiro: competência é a conta de antes ---');
eq([...naoCapturada.entries()], [['cr3', 0], ['cr4', 80]], 'comissão não capturada: cr3 coberta pela margem da v1, cr4 inteira (v2 sem margem)');
for (const mes of ['2026-09', '2026-10', '2026-11', '2026-12']) {
  eq(semLancamentos(dre(mes)), dreAntiga(mes, receber, pagar, comLastro, planoContas, naoCapturada), `competência ${mes}: linha a linha igual à regra antiga`);
}
const out = dre('2026-10');
eq(valor(out, 'VOLUME INTERMEDIADO (informativo)'), 1500, 'volume: v1 + v2 (cancelada fora)');
eq(valor(out, 'Comissão sobre vendas'), 200, 'margem da v1');
eq(valor(out, 'Comissões de fornecedores'), 80, 'só a comissão não capturada');
eq(valor(out, 'Fee de serviço'), 50, 'fee pelo valor da conta (competência)');
eq(valor(out, 'Outras receitas'), 0, 'cancelada fora');
eq(valor(out, 'RECEITA BRUTA (comissão + serviços)'), 330, 'receita bruta');
eq(valor(out, 'Custos diretos (CMV)'), 40, 'repasse auto-gerado fora do CMV');
eq(valor(out, 'Não categorizadas'), 25, 'sem categoria vira não categorizadas');
eq(valor(out, 'Taxas de plataformas de pagamento'), 12, 'taxa da plataforma');
eq(valor(out, '(-) DESPESAS FINANCEIRAS'), -22, 'financeiras = juros + taxa');
eq(valor(out, 'LUCRO LÍQUIDO'), -917, 'lucro líquido de outubro');
eq(out.find(l => l.nome.startsWith('Margem líquida'))?.nome, 'Margem líquida (sobre receita): -277.9%', 'margem no mesmo formato');

console.log('--- regime de caixa ---');
const caixaOut = dre('2026-10', 'caixa');
eq(valor(caixaOut, 'VOLUME INTERMEDIADO (informativo)'), 600, 'caixa: volume = o que o cliente pagou no mês');
eq(valor(caixaOut, 'Comissão sobre vendas'), 120, 'caixa: 60% da venda paga → 60% da margem');
eq(valor(caixaOut, 'Comissões de fornecedores'), 80, 'caixa: comissão recebida');
eq(valor(caixaOut, 'Fee de serviço'), 30, 'caixa: parcial entra pelo recebido');
eq(valor(caixaOut, 'Despesas operacionais (aluguel, salários, etc.)'), 0, 'caixa: aluguel pago em novembro não está em outubro');
eq(valor(caixaOut, 'Custos diretos (CMV)'), null, 'caixa: repasse pago continua fora');
eq(valor(caixaOut, 'Taxas de plataformas de pagamento'), 12, 'caixa: taxa já retida');
eq(valor(caixaOut, 'LUCRO LÍQUIDO'), 123, 'caixa: lucro de outubro');
const caixaNov = dre('2026-11', 'caixa');
eq(valor(caixaNov, 'Comissão sobre vendas'), 80, 'caixa: os 40% restantes da margem em novembro');
eq(valor(caixaNov, 'Despesas operacionais (aluguel, salários, etc.)'), 1000, 'caixa: aluguel no mês do pagamento');
eq(round2((valor(caixaOut, 'Comissão sobre vendas') ?? 0) + (valor(caixaNov, 'Comissão sobre vendas') ?? 0)), 200, 'caixa: a margem inteira da venda, somando os dois meses');
eq(valor(dre('2026-11'), 'Comissão sobre vendas'), 0, 'competência: novembro não tem venda');

console.log('--- clique no número: os lançamentos somam a linha ---');
for (const [nomeRegime, linhas] of [['competência', out], ['caixa', caixaOut]] as const) {
  for (const l of linhas) {
    if (!l.lancamentos) continue;
    eq(somaPor(l.lancamentos, x => x.valor), Math.abs(l.valor), `${nomeRegime}: ${l.nome}`);
  }
}
eq(out.find(l => l.nome === 'Não categorizadas')?.lancamentos?.map(x => [x.tabela, x.id]), [['contas_pagar', 'cp5']], 'drill: qual conta forma a linha');
eq(out.find(l => l.nome === 'LUCRO LÍQUIDO')?.lancamentos, undefined, 'total não tem lançamento próprio');

console.log('--- orçado e mês anterior ---');
const orc = orcadoPorLinha({ receitaMeta: 500, custoFixoTotal: 300, marketingTotal: 50, lucroProjetado: 120 });
eq([orc.get('RECEITA BRUTA (comissão + serviços)'), orc.get('(-) DESPESAS OPERACIONAIS'), orc.get('LUCRO LÍQUIDO'), orc.get('RECEITA LÍQUIDA')], [500, -350, 120, undefined], 'orçado só nas linhas que o plano mede');
eq(orcadoPorLinha(null).size, 0, 'sem plano, sem orçado');
eq([mesAnterior('2026-01'), mesAnterior('2026-10')], ['2025-12', '2026-09'], 'mês anterior');

console.log(`\n${total - falhas}/${total} testes do DRE passaram`);
if (falhas) process.exit(1);
