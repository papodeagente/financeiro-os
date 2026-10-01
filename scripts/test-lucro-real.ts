/**
 * Lucro real: faturamento → comissão → lucro, por mês e por venda
 * (src/lib/lucro-real.ts).
 *
 * O que estes testes protegem é o invariante que um contador procura
 * primeiro: a soma dos lucros das vendas é o lucro do mês, no centavo. Rateio
 * que não fecha é a primeira coisa que desacredita o relatório inteiro.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-lucro-real.ts
 */
import { escadaDoMes, custoFixoDoMes, cenariosDeDiluicao } from '../src/lib/lucro-real.ts';
import { round2, soma } from '../src/lib/money.ts';

let falhas = 0;
let total = 0;

function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

// ── Fixtures mínimas, só com os campos que o módulo lê ───────────────────
const venda = (id: string, data: string, final: number, custo: number, extra: Record<string, unknown> = {}) => ({
  id, numero: id.toUpperCase(), data_venda: data, valor_final: final, valor_total_custo: custo,
  status: 'CONCLUIDA', cliente_id: `c-${id}`, vendedor_id: 'vend-1', produtos: [{ descricao: `Pacote ${id}` }],
  ...extra,
}) as any;

const cr = (vendaId: string, taxa: number, data = '2026-09-10') => ({
  id: `cr-${vendaId}-${taxa}`, origem: 'VENDA', venda_id: vendaId, origem_venda_id: vendaId,
  valor_final: 1000, taxa, data_vencimento: data, status: 'RECEBIDO',
}) as any;

const cp = (categoria: string, valor: number, extra: Record<string, unknown> = {}) => ({
  id: `cp-${categoria}-${valor}-${Math.random()}`, categoria_id: categoria, valor_final: valor,
  data_vencimento: '2026-09-15', status: 'PENDENTE', origem: 'DESPESA_FIXA', ...extra,
}) as any;

const plano = [
  { id: 'cat-op', codigo: '2.2', nome: 'Operacionais' },
  { id: 'cat-imp', codigo: '2.3', nome: 'Impostos' },
  { id: 'cat-com', codigo: '2.6', nome: 'Comerciais' },
] as any;

const comissao = (vendaId: string, valor: number, status = 'CALCULADA') => ({
  id: `com-${vendaId}`, venda_id: vendaId, vendedor_id: 'vend-1', vendedor_nome: 'Ana',
  valor_comissao: valor, status, data_venda: '2026-09-01',
}) as any;

const base = () => ({
  mes: '2026-09',
  hoje: '2026-10-01',
  vendas: [
    venda('a', '2026-09-03', 20000, 16500),
    venda('b', '2026-09-12', 10000, 8000),
    venda('c', '2026-09-20', 5000, 4500),
  ],
  contasReceber: [cr('a', 798), cr('b', 399)],
  contasPagar: [cp('cat-op', 2000), cp('cat-op', 1500), cp('cat-imp', 300)],
  planoContas: plano,
  comissoes: [comissao('a', 420), comissao('b', 240)],
  aliquotaIssConfig: 3,
});

// ── A escada do mês ───────────────────────────────────────────────────────
{
  const m = escadaDoMes(base());
  eq(m.faturamento, 35000, 'faturamento = o que os clientes pagaram');
  eq(m.fornecedores, 29000, 'fornecedores = o que só passou pela conta');
  eq(m.comissao, 6000, 'comissão = faturamento − fornecedores');
  eq(m.comissao_pct, 17.14, 'comissão em % do faturamento');
  eq(m.custo_fixo, 3500, 'custo fixo = operacionais do mês (2.2), sem o imposto');
  eq(m.impostos, 300, 'imposto lançado (2.3) entra como imposto, não como fixo');
  eq(m.impostos_estimados, false, 'com imposto lançado, nada é estimado');
  eq(m.comissao_vendedor, 660, 'comissão de vendedor somada da entidade comissoes');
  eq(m.taxa_plataforma, 1197, 'taxa das plataformas somada das contas a receber da venda');
  eq(m.contribuicao, round2(6000 - 660 - 1197 - 300), 'contribuição = comissão − variáveis');
  eq(m.lucro, round2(6000 - 660 - 1197 - 300 - 3500), 'lucro = contribuição − custo fixo');
  eq(m.lucro_pct, round2(m.lucro / 35000 * 100), 'lucro em % do faturamento');
  eq(m.aberto, false, 'setembro fechado em 1º de outubro');
}

// ── O INVARIANTE ──────────────────────────────────────────────────────────
{
  const m = escadaDoMes(base());
  eq(round2(soma(m.vendas.map(v => v.lucro))), m.lucro, 'Σ lucro das vendas = lucro do mês, no centavo');
  eq(round2(soma(m.vendas.map(v => v.custo_fixo_rateado))), m.custo_fixo, 'Σ fixo rateado = custo fixo');
  eq(round2(soma(m.vendas.map(v => v.impostos))), m.impostos, 'Σ imposto rateado = imposto do mês');
  eq(round2(soma(m.vendas.map(v => v.contribuicao))), m.contribuicao, 'Σ contribuição = contribuição do mês');
}

// ── O rateio é por FATURAMENTO ────────────────────────────────────────────
{
  const m = escadaDoMes(base());
  const [a, b, c] = m.vendas;
  eq(a.custo_fixo_rateado, 2000, 'R$ 20.000 de 35.000 carrega 4/7 do fixo');
  eq(b.custo_fixo_rateado, 1000, 'R$ 10.000 carrega 2/7');
  eq(c.custo_fixo_rateado, 500, 'R$ 5.000 carrega 1/7');
  // Imposto segue a COMISSÃO, não o faturamento: a venda de margem fina paga menos.
  eq(a.impostos, 175, 'imposto rateado por comissão: 3.500/6.000 de 300');
  eq(c.impostos, 25, 'venda de margem fina carrega pouco imposto');
}

// ── A escada de UMA venda ─────────────────────────────────────────────────
{
  const m = escadaDoMes(base());
  const a = m.vendas[0];
  eq([a.faturamento, a.fornecedores, a.comissao], [20000, 16500, 3500], 'os três números da venda');
  eq(a.comissao_vendedor, 420, 'comissão do vendedor da própria venda');
  eq(a.taxa_plataforma, 798, 'taxa da plataforma das parcelas da venda');
  eq(a.contribuicao, round2(3500 - 420 - 798 - 175), 'contribuição da venda');
  eq(a.lucro, round2(3500 - 420 - 798 - 175 - 2000), 'lucro aproximado da venda');
  eq(a.lucro_pct, round2(a.lucro / 20000 * 100), '% sobre o que o cliente pagou');
  eq(a.vendedor_nome, 'Ana', 'nome do vendedor vem da comissão');
  eq(a.descricao, 'Pacote a', 'a linha tem o nome do produto');
  eq(m.vendas[2].avisos, ['Sem comissão de vendedor registrada'], 'venda sem comissão é avisada, não zerada em silêncio');
}

// ── Quando eu realmente lucrei ────────────────────────────────────────────
{
  const m = escadaDoMes(base());
  // contribuições: a = 2107, b = 2000−240−399−100 = 1261 → acumulado 3368 < 3500; c = 500−0−0−25 = 475 → 3843 ≥ 3500
  eq(m.vendas.map(v => v.contribuicao), [2107, 1261, 475], 'contribuição por venda, na ordem do mês');
  eq(m.equilibrio.atingido, true, 'o mês cobriu o fixo');
  eq(m.equilibrio.na_venda, 3, 'foi a TERCEIRA venda que cruzou o fixo');
  eq(m.equilibrio.data, '2026-09-20', 'e foi no dia 20');
  eq(m.equilibrio.faltam, 0, 'nada falta');
  eq(m.equilibrio.vendas_necessarias, 3, 'com a contribuição média, 3 vendas pagam o fixo');
}

{ // mês que não cobriu o fixo
  const e = base();
  e.contasPagar.push(cp('cat-op', 5000));
  const m = escadaDoMes(e);
  eq(m.equilibrio.atingido, false, 'fixo de 8.500 não foi coberto por 3.843');
  eq(m.equilibrio.na_venda, null, 'nenhuma venda cruzou');
  eq(m.equilibrio.faltam, round2(8500 - 3843), 'quanto falta é dito em reais');
  eq(m.equilibrio.vendas_necessarias, 7, 'e em vendas: ceil(8500 / 1281)');
  eq(m.lucro < 0, true, 'o mês deu prejuízo');
}

// ── A DILUIÇÃO: quanto mais venda, menor o fixo por venda ─────────────────
{
  const cen = cenariosDeDiluicao(3500, 3, 1281);
  eq(cen.map(c => c.vendas), [3, 6, 8, 9, 13], 'cenários a partir do atual, em ordem crescente');
  eq(cen[0].custo_fixo_por_venda, 1166.67, 'com 3 vendas, R$ 1.166,67 de fixo cada');
  eq(cen[2].custo_fixo_por_venda, 437.5, 'com 8 vendas, R$ 437,50');
  const porVenda = cen.map(c => c.custo_fixo_por_venda);
  const ordenado = [...cen].sort((a, b) => a.vendas - b.vendas).map(c => c.custo_fixo_por_venda);
  eq(ordenado.every((v, i) => i === 0 || v <= ordenado[i - 1]), true, 'o fixo por venda só cai com mais vendas');
  eq(porVenda.length, 5, 'cinco cenários distintos');
  eq(cen[0].lucro_por_venda, round2(1281 - 1166.67), 'lucro por venda = contribuição média − fixo por venda');
}

// ── Mês aberto: o rateio é provisório, e a tela precisa saber ─────────────
{
  const e = base(); e.hoje = '2026-09-25';
  const m = escadaDoMes(e);
  eq(m.aberto, true, 'setembro está aberto no dia 25');
  eq(m.avisos.some(a => a.includes('Mês aberto')), true, 'o aviso de rateio provisório aparece');
}

// ── Sem imposto lançado: estimativa pela alíquota, avisada ────────────────
{
  const e = base(); e.contasPagar = [cp('cat-op', 3500)];
  const m = escadaDoMes(e);
  eq(m.impostos_estimados, true, 'sem lançamento, o imposto é estimado');
  eq(m.impostos, 180, '3% sobre a comissão de 6.000');
  eq(m.vendas[0].impostos, 105, '3% de 3.500 na primeira venda');
  eq(m.vendas[0].avisos.includes('Imposto estimado'), true, 'a venda avisa que o imposto é estimativa');
  eq(round2(soma(m.vendas.map(v => v.lucro))), m.lucro, 'o invariante continua valendo com estimativa');
}

{ // sem imposto lançado E sem alíquota: zero, sem estimativa fantasma
  const e = base(); e.contasPagar = [cp('cat-op', 3500)]; e.aliquotaIssConfig = null;
  const m = escadaDoMes(e);
  eq([m.impostos, m.impostos_estimados], [0, false], 'nada é inventado sem alíquota');
}

// ── O que NÃO entra ───────────────────────────────────────────────────────
{
  const e = base();
  e.vendas.push(venda('x', '2026-09-28', 9999, 1, { status: 'CANCELADO' }));
  e.vendas.push(venda('y', '2026-10-02', 9999, 1));
  e.comissoes.push(comissao('a', 9999, 'CANCELADA'));
  e.contasReceber.push({ ...cr('a', 9999), status: 'CANCELADO' });
  e.contasPagar.push(cp('cat-op', 9999, { auto_gerado: true, origem: 'VENDA' }));
  e.contasPagar.push(cp('cat-op', 9999, { status: 'CANCELADO' }));
  e.contasPagar.push(cp('cat-com', 9999, { descricao: 'Comissão de setembro - Ana' }));
  const m = escadaDoMes(e);
  eq(m.n_vendas, 3, 'venda cancelada e venda de outro mês ficam fora');
  eq(m.comissao_vendedor, 660, 'comissão CANCELADA não soma');
  eq(m.taxa_plataforma, 1197, 'conta a receber cancelada não soma taxa');
  eq(m.custo_fixo, 3500, 'repasse de venda, conta cancelada e comissão de vendedor como CP ficam fora do fixo');
}

// ── Custo fixo: a régua ───────────────────────────────────────────────────
{
  const r = custoFixoDoMes(
    [cp('cat-op', 100), cp('cat-com', 50), cp('cat-imp', 30), cp('sem-categoria', 20)],
    plano, '2026-09',
  );
  eq(r.total, 170, 'operacionais + comerciais + não categorizadas = fixo');
  eq(r.impostos, 30, 'imposto separado');
}

// ── Mês sem venda ─────────────────────────────────────────────────────────
{
  const e = base(); e.vendas = [];
  const m = escadaDoMes(e);
  eq(m.lucro, -3800, 'sem venda, o lucro é −(fixo + imposto lançado)');
  eq(m.vendas, [], 'lista vazia');
  eq(m.equilibrio.atingido, false, 'nada cobriu nada');
  eq(m.equilibrio.vendas_necessarias, null, 'sem contribuição média não há como projetar');
  eq(m.avisos.some(a => a.includes('Sem venda')), true, 'avisa que o fixo inteiro é prejuízo');
}

// ── Resíduo do rateio não some nem se duplica ─────────────────────────────
{
  const e = base();
  e.vendas = [venda('a', '2026-09-01', 100, 50), venda('b', '2026-09-02', 100, 50), venda('c', '2026-09-03', 100, 50)];
  e.contasPagar = [cp('cat-op', 100)];
  e.contasReceber = []; e.comissoes = [];
  const m = escadaDoMes(e);
  eq(m.vendas.map(v => v.custo_fixo_rateado), [33.34, 33.33, 33.33], 'R$ 100 em três: o centavo vai para o maior (empate: primeiro)');
  eq(round2(soma(m.vendas.map(v => v.custo_fixo_rateado))), 100, 'e a soma fecha');
}

console.log(`\n${total - falhas}/${total} testes do lucro real passaram`);
if (falhas > 0) process.exit(1);
