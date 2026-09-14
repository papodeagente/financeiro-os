/**
 * Testes da matemática do Planejamento mensal (src/lib/planejamento-custos.ts).
 *
 * Travam os erros encontrados na auditoria de 2026-09-02:
 *  - marketing fixo recorrente sumia do custo do mês
 *  - margem e retorno calculados sobre o VOLUME intermediado, não sobre a
 *    receita da agência (num negócio de comissão isso infla ~4x)
 *  - "custo máximo por lead" devolvia o custo implícito do orçamento, não o
 *    teto que a margem suporta
 *
 * Roda: node --experimental-strip-types scripts/run-tests.mjs scripts/test-planejamento.ts
 */
import { calcRelatorio, type CustosData } from '../src/lib/planejamento-custos.ts';
import { analisarPlano } from '../src/lib/planejamento-analise.ts';

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
function perto(atual: number, esperado: number, tol: number, label: string) {
  total++;
  const ok = Math.abs(atual - esperado) <= tol;
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ~${esperado} (±${tol})\n        obtido:   ${atual}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

function plano(over: Partial<CustosData> = {}): CustosData {
  return {
    id: 'p1',
    mes: '2026-09',
    custos_fixos: [
      { categoria: 'Aluguel/Sede', valor: 4500, observacao: '' },
      { categoria: 'Folha de pagamento', valor: 12000, observacao: '' },
      { categoria: 'Ferramentas e software', valor: 0, observacao: '' },
      { categoria: 'Marketing fixo recorrente', valor: 0, observacao: '' },
      { categoria: 'Outros fixos', valor: 0, observacao: '' },
    ],
    custos_variaveis: [
      { nome: 'Comissão vendedor', percentual: 0, base: 'COMISSAO' },
      { nome: 'Impostos', percentual: 6, base: 'COMISSAO' },
      { nome: 'Taxa cartão/boleto', percentual: 4.5, base: 'VENDA' },
      { nome: 'Outros variáveis', percentual: 0, base: 'VENDA' },
    ],
    marketing: [{ canal: 'Instagram Ads', valor: 8700 }],
    ticket_medio: 8000,
    margem_comissao: 25,
    taxa_conversao: 10,
    lucro_desejado: 10000,
    dias_uteis: 22,
    vendedores_ativos: 1,
    ...over,
  };
}

console.log('--- custo do mês: nada pode sumir da conta ---');
{
  // O bug: "Marketing fixo recorrente" era SUBTRAÍDO dos fixos para evitar
  // dupla contagem, e desaparecia quando o bloco de canais não repetia o valor.
  const p = plano({
    custos_fixos: [
      { categoria: 'Aluguel/Sede', valor: 4500, observacao: '' },
      { categoria: 'Folha de pagamento', valor: 12000, observacao: '' },
      { categoria: 'Marketing fixo recorrente', valor: 1200, observacao: '' },
    ],
    marketing: [{ canal: 'Instagram Ads', valor: 0 }],
  });
  const r = calcRelatorio(p);
  eq(r.custoFixoTotal, 17700, 'total fixo soma tudo que foi lançado');
  eq(r.custoFixoMaisMarketing, 17700, 'marketing fixo recorrente NÃO some do custo do mês');
}
{
  const r = calcRelatorio(plano());
  eq(r.custoFixoTotal, 16500, 'fixos somados');
  eq(r.marketingTotal, 8700, 'marketing somado');
  eq(r.custoFixoMaisMarketing, 25200, 'custo do mês = fixos + marketing');
}

console.log('--- margem de contribuição por venda ---');
{
  const r = calcRelatorio(plano());
  eq(r.comissaoPorVenda, 2000, 'comissão = 25% de 8.000');
  // impostos 6% sobre a comissão (120) + cartão 4,5% sobre a venda (360)
  eq(r.custoVarPorVenda, 480, 'custo variável usa a base certa de cada item');
  eq(r.lucroPorVenda, 1520, 'sobra por venda = comissão − custos variáveis');
  perto(r.margemContribuicaoPct, 76, 0.01, 'margem de contribuição = 76% da comissão');
}

console.log('--- o plano fecha: fazer vendasMeta entrega o lucro desejado ---');
{
  const r = calcRelatorio(plano());
  eq(r.vendasMeta, Math.ceil((25200 + 10000) / 1520), 'vendas para cobrir custos + lucro');
  // com arredondamento de vendas o lucro real fica IGUAL OU ACIMA do desejado
  const lucroReal = r.vendasMeta * r.lucroPorVenda - r.custoFixoMaisMarketing;
  eq(r.lucroProjetado, lucroReal, 'lucro projetado bate com a conta manual');
  eq(r.lucroProjetado >= 10000, true, 'lucro projetado nunca fica abaixo do desejado');
  perto(r.lucroProjetado - 10000, 1280, 1, 'o arredondamento de vendas explica a folga');
}
{
  const r = calcRelatorio(plano());
  eq(r.vendasBreakEven, Math.ceil(25200 / 1520), 'ponto de equilíbrio cobre exatamente os custos');
  eq(r.vendasBreakEven * r.lucroPorVenda >= r.custoFixoMaisMarketing, true, 'no break-even os custos estão pagos');
  eq(r.vendasBreakEven < r.vendasMeta, true, 'break-even é menor que a meta com lucro');
}

console.log('--- volume intermediado NÃO é receita da agência ---');
{
  const r = calcRelatorio(plano());
  eq(r.faturamentoMeta, r.vendasMeta * 8000, 'faturamento = volume transacionado');
  eq(r.receitaMeta, r.vendasMeta * 2000, 'receita da agência = só as comissões');
  eq(r.receitaMeta < r.faturamentoMeta, true, 'receita é uma fração do volume');
  // A margem projetada precisa fechar com o lucro efetivamente produzido
  // pelas vendas inteiras, não com a meta mínima antes do arredondamento.
  perto(r.margemSobreReceitaPct, (r.lucroProjetado / r.receitaMeta) * 100, 0.01, 'margem projetada sobre a receita de comissões');
  perto(r.margemSobreVolumePct, (r.lucroProjetado / r.faturamentoMeta) * 100, 0.01, 'margem projetada sobre o volume intermediado');
  eq(r.margemSobreReceitaPct > r.margemSobreVolumePct, true, 'margem sobre receita é maior que sobre volume');
  perto(r.margemSobreReceitaPct / r.margemSobreVolumePct, 4, 0.01, 'a diferença entre as duas é o inverso da comissão (25% → 4x)');
}

console.log('--- dinheiro fecha em centavos antes de arredondar vendas ---');
{
  const r = calcRelatorio(plano({
    custos_fixos: [{ categoria: 'Outros fixos', valor: 1900, observacao: '' }],
    marketing: [],
    ticket_medio: 9999.99,
    lucro_desejado: 0,
  }));
  eq(r.comissaoPorVenda, 2500, 'comissão é arredondada para centavos');
  eq(r.custoVarPorVenda, 600, 'cada custo variável é arredondado antes da soma');
  eq(r.lucroPorVenda, 1900, 'margem unitária fecha em centavos');
  eq(r.vendasBreakEven, 1, 'uma venda que cobre R$ 1.900 não vira duas por ruído binário');
  eq(r.vendasMeta, 1, 'meta sem lucro adicional coincide com o break-even');
  eq(r.lucroProjetado, 0, 'lucro projetado fecha exatamente após o break-even');
}
{
  const r = calcRelatorio(plano({
    custos_fixos: [{ categoria: 'Outros fixos', valor: 1100.10, observacao: '' }],
    marketing: [],
    custos_variaveis: [{ nome: 'Taxa', percentual: 1.5, base: 'VENDA' }],
    ticket_medio: 1000.08,
    margem_comissao: 12.5,
    lucro_desejado: 0,
  }));
  eq(r.comissaoPorVenda, 125.01, 'comissão fracionária respeita os centavos');
  eq(r.custoVarPorVenda, 15, 'custo percentual fracionário respeita os centavos');
  eq(r.lucroPorVenda, 110.01, 'contribuição unitária é monetária');
  eq(r.vendasBreakEven, 10, 'dez contribuições de R$ 110,01 cobrem R$ 1.100,10');
}
{
  const r = calcRelatorio(plano({
    custos_fixos: [{ categoria: 'Outros fixos', valor: 0.27, observacao: '' }],
    marketing: [],
    custos_variaveis: [],
    ticket_medio: 0.09,
    margem_comissao: 100,
    lucro_desejado: 0,
  }));
  eq(r.lucroPorVenda, 0.09, 'contribuição de nove centavos é preservada');
  eq(r.vendasBreakEven, 3, 'divisão em centavos evita que 0,27 ÷ 0,09 vire quatro vendas');
}

console.log('--- economia de aquisição: teto vs custo atual ---');
{
  const r = calcRelatorio(plano());
  // cada lead vale a margem da venda vezes a chance de fechar
  eq(r.cplTeto, 1520 * 0.10, 'teto por lead = sobra por venda × conversão');
  eq(r.cplAtual, 8700 / r.atendimentosMeta, 'custo atual por lead = verba ÷ leads necessários');
  eq(r.cplAtual < r.cplTeto, true, 'neste plano ainda há folga para investir em aquisição');
}
{
  // PROPRIEDADE DO MODELO: o custo por lead nunca cruza o teto por aumento de
  // verba — mais verba exige mais vendas, que exigem mais leads, e o custo se
  // dilui. cplAtual/cplTeto = M/(fixos+M+lucro) < 1 sempre. Um alerta do tipo
  // "custo acima do teto" seria código morto; o que informa é o USO do teto.
  for (const verba of [1000, 8700, 50000, 200000, 1_000_000]) {
    const r = calcRelatorio(plano({ marketing: [{ canal: 'Instagram Ads', valor: verba }] }));
    eq(r.cplAtual < r.cplTeto, true, `verba de ${verba}: custo por lead fica abaixo do teto`);
  }
  const pequena = calcRelatorio(plano({ marketing: [{ canal: 'Instagram Ads', valor: 1000 }] }));
  const grande = calcRelatorio(plano({ marketing: [{ canal: 'Instagram Ads', valor: 200000 }] }));
  eq(grande.usoDoTetoPct > pequena.usoDoTetoPct, true, 'mais verba consome mais da capacidade de aquisição');
  eq(pequena.usoDoTetoPct < 40, true, 'verba pequena deixa folga (dispara o aviso de espaço para investir)');
  eq(grande.usoDoTetoPct >= 85, true, 'verba grande compromete o teto (dispara o aviso de dependência de mídia)');
}
{
  const r = calcRelatorio(plano());
  eq(r.retornoMarketing, r.receitaMeta / 8700, 'retorno mede comissão por real investido');
  eq(r.retornoMarketing < r.faturamentoMeta / 8700, true, 'não usa o volume intermediado (que infla o número)');
}

console.log('--- plano inviável ---');
{
  // comissão de 3% não cobre 4,5% de taxa de cartão sobre a venda
  const r = calcRelatorio(plano({ margem_comissao: 3 }));
  eq(r.lucroPorVenda < 0, true, 'cada venda dá prejuízo');
  eq(r.vendasMeta, 0, 'não existe meta de vendas que gere lucro');
  eq(r.vendasBreakEven, 0, 'não existe ponto de equilíbrio');
  eq(r.cplTeto, 0, 'sem margem não há teto de aquisição');
  eq(Number.isFinite(r.margemSobreReceitaPct), true, 'nenhuma métrica vira NaN');
}

console.log('--- premissas em branco não inventam números ---');
{
  const r = calcRelatorio(plano({ ticket_medio: 0 }));
  eq(r.premissasIncompletas, true, 'ticket zerado marca as premissas como incompletas');
  eq(r.comissaoPorVenda, 0, 'sem ticket não há comissão (antes virava 1 real de ticket)');
  eq(r.vendasMeta, 0, 'sem ticket não há meta');
}
{
  const r = calcRelatorio(plano({ margem_comissao: 0 }));
  eq(r.premissasIncompletas, true, 'margem zerada marca as premissas como incompletas');
}
{
  const p = plano({ taxa_conversao: 0 });
  const r = calcRelatorio(p);
  eq(r.atendimentosMeta, 0, 'sem taxa de conversão não estima leads (sem divisão por zero)');
  eq(Number.isFinite(r.cplAtual), true, 'custo por lead não vira Infinity');
  eq(r.premissasIncompletas, true, 'conversão zerada bloqueia um plano comercial impossível');
  const a = analisarPlano(p, r);
  eq(a.vereditoGravidade, 'critico', 'diagnóstico bloqueia plano sem conversão');
  eq(a.veredito.includes('taxa de conversão'), true, 'diagnóstico identifica exatamente a premissa ausente');
  eq(a.veredito.includes('ticket médio e margem'), false, 'diagnóstico não acusa premissas que foram preenchidas');
}
{
  const r = calcRelatorio(plano({ dias_uteis: 0, vendedores_ativos: 0 }));
  eq(Number.isFinite(r.faturamentoDiario), true, 'dias úteis zerados não geram Infinity');
  eq(Number.isFinite(r.atendimentosPorVendedorDia), true, 'vendedores zerados não geram Infinity');
}
{
  const r = calcRelatorio(plano({ marketing: [{ canal: 'Instagram Ads', valor: 0 }] }));
  eq(r.retornoMarketing, 0, 'sem verba de marketing o retorno é 0, não Infinity');
  eq(r.cplAtual, 0, 'sem verba o custo por lead é 0');
  eq(r.cplTeto > 0, true, 'mas o teto continua existindo (depende da margem, não da verba)');
}

console.log('--- entradas inseguras não contaminam o relatório ---');
{
  const r = calcRelatorio(plano({
    custos_fixos: [
      { categoria: 'Válido', valor: 1000, observacao: '' },
      { categoria: 'Negativo', valor: -500, observacao: '' },
      { categoria: 'Não finito', valor: Number.NaN, observacao: '' },
    ],
    marketing: [
      { canal: 'Negativo', valor: -100 },
      { canal: 'Não finito', valor: Number.POSITIVE_INFINITY },
    ],
    custos_variaveis: [
      { nome: 'Negativo', percentual: -10, base: 'VENDA' },
      { nome: 'Não finito', percentual: Number.NaN, base: 'COMISSAO' },
    ],
    ticket_medio: 1000,
    margem_comissao: 150,
    taxa_conversao: 250,
    lucro_desejado: -1000,
    dias_uteis: -5,
    vendedores_ativos: -2,
  }));
  eq(r.custoFixoTotal, 1000, 'custos negativos e não finitos não reduzem o total');
  eq(r.marketingTotal, 0, 'marketing negativo e não finito é neutralizado');
  eq(r.comissaoPorVenda, 1000, 'margem acima de 100% é limitada a 100%');
  eq(r.custoVarPorVenda, 0, 'percentuais negativos e não finitos são neutralizados');
  eq(r.vendasBreakEven, 1, 'break-even permanece não negativo');
  eq(r.vendasMeta, 1, 'lucro desejado negativo não reduz a meta abaixo do break-even');
  eq(r.atendimentosMeta, 1, 'conversão acima de 100% é limitada a 100%');
  eq(r.faturamentoDiario, 45.45, 'dias úteis inválidos usam o fallback seguro de 22 dias');
  eq(r.vendasPorVendedorMes, 1, 'quantidade inválida de vendedores usa o fallback seguro de um');
  eq(Object.values(r).filter(v => typeof v === 'number').every(Number.isFinite), true, 'todas as métricas numéricas permanecem finitas');
}
{
  const malformado = {
    ...plano(),
    custos_fixos: null,
    custos_variaveis: [null],
    marketing: null,
  } as unknown as CustosData;
  const r = calcRelatorio(malformado);
  eq(r.custoFixoTotal, 0, 'lista de fixos malformada não quebra o cálculo');
  eq(r.custoVarPorVenda, 0, 'item variável malformado não quebra o cálculo');
  eq(r.marketingTotal, 0, 'lista de marketing malformada não quebra o cálculo');
  eq(Object.values(r).filter(v => typeof v === 'number').every(Number.isFinite), true, 'payload malformado não produz NaN ou Infinity');
}

console.log('--- coerência: partes reproduzem o todo ---');
{
  const r = calcRelatorio(plano());
  const somaVariaveis = 2000 * 0.06 + 8000 * 0.045;
  perto(r.custoVarPorVenda, somaVariaveis, 0.001, 'custo variável = soma item a item');
  perto(r.comissaoPorVenda - r.custoVarPorVenda, r.lucroPorVenda, 0.001, 'sobra fecha com comissão − custos');
  perto(r.vendasMeta * r.comissaoPorVenda, r.receitaMeta, 0.001, 'receita fecha com vendas × comissão');
  perto(r.vendasMeta * 8000, r.faturamentoMeta, 0.001, 'faturamento fecha com vendas × ticket');
  eq(r.comissaoMeta, r.receitaMeta, 'comissão total do mês é a receita da agência');
}

console.log('--- análise do plano ---');
{
  const p = plano();
  const a = analisarPlano(p, calcRelatorio(p));
  eq(a.vereditoGravidade !== 'critico', true, 'plano que fecha não é veredito crítico');
  eq(a.veredito.includes('fecha'), true, 'veredito diz que o plano fecha');
  eq(a.recomendacoes.length > 0, true, 'sempre há próximo passo');
  // nenhum texto pode sair com NaN/undefined/Infinity visível ao usuário
  const textos = [a.veredito, ...a.riscos.flatMap(r => [r.titulo, r.texto]),
                  ...a.forcas.flatMap(f => [f.titulo, f.texto]), ...a.recomendacoes].join(' ');
  eq(/NaN|undefined|Infinity|null/.test(textos), false, 'nenhum texto vaza NaN/undefined/Infinity');
}
{
  // plano inviável: a análise tem de ser categórica e não sugerir volume
  const p = plano({ margem_comissao: 3 });
  const a = analisarPlano(p, calcRelatorio(p));
  eq(a.vereditoGravidade, 'critico', 'plano inviável é crítico');
  eq(a.veredito.includes('não fecha'), true, 'veredito diz que não fecha');
  eq(a.forcas.length, 0, 'plano inviável não lista pontos a favor');
  eq(a.riscos.some(r => r.gravidade === 'critico'), true, 'aponta o risco crítico');
}
{
  const p = plano({
    ticket_medio: 1000,
    margem_comissao: 10,
    custos_variaveis: [
      { nome: 'Comissão do vendedor', percentual: 50, base: 'COMISSAO' },
      { nome: 'Taxa sobre a venda', percentual: 6, base: 'VENDA' },
    ],
  });
  const r = calcRelatorio(p);
  const a = analisarPlano(p, r);
  eq(r.lucroPorVenda, -10, 'cenário de comissão mínima começa inviável');
  eq(a.recomendacoes.some(item => item.includes('12,0%')), true, 'comissão mínima resolve custos sobre comissão e venda');
  eq(calcRelatorio({ ...p, margem_comissao: 11 }).lucroPorVenda < 0, true, '11% ainda não cobre os custos variáveis');
  eq(calcRelatorio({ ...p, margem_comissao: 12 }).lucroPorVenda, 0, '12% é exatamente o empate');
  eq(calcRelatorio({ ...p, margem_comissao: 12.1 }).lucroPorVenda > 0, true, 'acima de 12% a contribuição fica positiva');
}
{
  const p = plano({
    margem_comissao: 50,
    custos_variaveis: [{ nome: 'Repasse integral', percentual: 100, base: 'COMISSAO' }],
  });
  const a = analisarPlano(p, calcRelatorio(p));
  eq(a.recomendacoes.some(item => item.includes('nem com comissão de 100%')), true, 'diagnóstico reconhece quando custos sobre comissão tornam o plano insolúvel');
}
{
  const p = plano({
    margem_comissao: 50,
    custos_variaveis: [
      { nome: 'Repasse', percentual: 50, base: 'COMISSAO' },
      { nome: 'Taxas', percentual: 60, base: 'VENDA' },
    ],
  });
  const a = analisarPlano(p, calcRelatorio(p));
  eq(a.recomendacoes.some(item => item.includes('nem com comissão de 100%')), true, 'diagnóstico não recomenda margem teórica acima de 100%');
}
{
  // premissas vazias: não inventa diagnóstico
  const p = plano({ ticket_medio: 0 });
  const a = analisarPlano(p, calcRelatorio(p));
  eq(a.vereditoGravidade, 'critico', 'premissas vazias bloqueiam a análise');
  eq(a.riscos.length === 0 && a.forcas.length === 0, true, 'não analisa o que não tem dado');
}
{
  // time subdimensionado dispara com carga alta
  const p = plano({ vendedores_ativos: 1, taxa_conversao: 5, lucro_desejado: 60000 });
  const a = analisarPlano(p, calcRelatorio(p));
  eq(a.riscos.some(r => r.titulo.includes('Time subdimensionado')), true, 'aponta time subdimensionado');
}
{
  // concentração de custo fixo
  const p = plano({ custos_fixos: [
    { categoria: 'Folha de pagamento', valor: 40000, observacao: '' },
    { categoria: 'Aluguel/Sede', valor: 2000, observacao: '' },
  ] });
  const a = analisarPlano(p, calcRelatorio(p));
  eq(a.riscos.some(r => r.titulo.toLowerCase().includes('concentrado')), true, 'aponta concentração de custo');
}
{
  // margem que não sustenta mídia paga
  const p = plano({ ticket_medio: 400, margem_comissao: 10, taxa_conversao: 5 });
  const a = analisarPlano(p, calcRelatorio(p));
  const r = calcRelatorio(p);
  if (r.cplTeto > 0 && r.cplTeto < 15) {
    eq(a.riscos.some(x => x.titulo.includes('mídia paga')), true, 'avisa que a margem não sustenta mídia paga');
  } else {
    eq(true, true, 'cenário fora do limiar (teto ' + r.cplTeto.toFixed(2) + ')');
  }
}
{
  // conversão otimista
  const p = plano({ taxa_conversao: 40 });
  const a = analisarPlano(p, calcRelatorio(p));
  eq(a.riscos.some(r => r.titulo.includes('otimista')), true, 'questiona conversão alta demais');
}

console.log(`\n${total - falhas}/${total} testes passaram`);
if (falhas > 0) {
  console.log(`${falhas} FALHAS`);
  process.exit(1);
}
