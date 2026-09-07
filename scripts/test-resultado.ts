/**
 * Testes da FONTE ÚNICA DA VERDADE dos indicadores financeiros
 * (src/lib/resultado-financeiro.ts).
 *
 * Cada bloco trava um invariante que, quebrado, muda um número na tela do
 * dono da agência. Os cenários seguem a auditoria de 2026-09-06.
 *
 * Roda com: node --experimental-strip-types scripts/test-resultado.ts
 */
import {
  calcularResultado,
  calcularInadimplencia,
  calcularCaixaLivre,
  valorRealizado,
  valorEmAberto,
  faixaDeAtraso,
  diasEntre,
  type ContaReceberMin,
  type ContaPagarMin,
} from '../src/lib/resultado-financeiro.ts';

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

const HOJE = '2026-09-06';

function cr(over: Partial<ContaReceberMin> = {}): ContaReceberMin {
  return {
    id: 'cr' + Math.random().toString(36).slice(2, 7),
    origem: 'VENDA',
    status: 'PENDENTE',
    valor_final: 1000,
    valor_recebido: null,
    data_vencimento: '2026-10-01',
    cliente_nome: 'Cliente',
    ...over,
  };
}

function cp(over: Partial<ContaPagarMin> = {}): ContaPagarMin {
  return {
    id: 'cp' + Math.random().toString(36).slice(2, 7),
    origem: 'VENDA',
    status: 'PENDENTE',
    valor_final: 800,
    valor_pago: null,
    data_vencimento: '2026-10-15',
    fornecedor_nome: 'Operadora',
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o caso central: R$ 20.000 vendidos NÃO são receita ---');
// Viagem de R$ 20.000. Fornecedores: hotel 8.000, aéreo 6.000,
// receptivo 2.000, seguro 500. Receita da agência: R$ 3.500.
{
  const r = calcularResultado({
    hoje: HOJE,
    contas_receber: [cr({ valor_final: 20000 })],
    contas_pagar: [
      cp({ valor_final: 8000, fornecedor_nome: 'Hotel' }),
      cp({ valor_final: 6000, fornecedor_nome: 'Aérea' }),
      cp({ valor_final: 2000, fornecedor_nome: 'Receptivo' }),
      cp({ valor_final: 500, fornecedor_nome: 'Seguro' }),
    ],
  });
  eq(r.volume_vendido, 20000, 'volume vendido é o que o cliente contratou');
  eq(r.custo_previsto, 16500, 'custo previsto soma os quatro fornecedores');
  eq(r.receita_agencia, 3500, 'receita da agência é a margem, não o volume');
  eq(r.margem_prevista, 3500, 'margem prevista igual à receita da agência');
  eq(r.margem_percentual, 17.5, 'margem percentual sobre o volume líquido');
  eq(r.recebido, 0, 'nada recebido ainda');
  eq(r.margem_realizada, 0, 'margem realizada zero sem caixa movimentado');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- baixa PARCIAL entra em todos os totais ---');
{
  // Parcela de 5.000 com 3.000 recebidos: saldo 2.000.
  const conta = cr({ valor_final: 5000, valor_recebido: 3000, status: 'PARCIAL' });
  eq(valorRealizado(conta, 'valor_recebido'), 3000, 'parcial realiza o acumulado');
  eq(valorEmAberto(conta, 'valor_recebido'), 2000, 'parcial deixa o saldo em aberto');

  const r = calcularResultado({ hoje: HOJE, contas_receber: [conta], contas_pagar: [] });
  eq(r.recebido, 3000, 'recebido conta o parcial (antes zerava)');
  eq(r.a_receber, 2000, 'a receber é só o saldo');
  eq(r.percentual_recebido, 60, 'percentual recebido considera o parcial');
}

{
  // Pagamento parcial a fornecedor.
  const conta = cp({ valor_final: 800, valor_pago: 300, status: 'PARCIAL' });
  const r = calcularResultado({ hoje: HOJE, contas_receber: [], contas_pagar: [conta] });
  eq(r.custo_pago, 300, 'custo pago conta o parcial');
  eq(r.custo_pendente, 500, 'custo pendente é o saldo');
  eq(r.custo_previsto, 800, 'custo previsto continua o total');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- conta quitada sem valor de baixa cai no valor_final ---');
{
  const conta = cr({ valor_final: 1500, valor_recebido: null, status: 'RECEBIDO' });
  eq(valorRealizado(conta, 'valor_recebido'), 1500, 'quitada sem campo usa o valor_final');
  eq(valorEmAberto(conta, 'valor_recebido'), 0, 'quitada não deixa saldo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- conta CANCELADA não entra em nada ---');
{
  const r = calcularResultado({
    hoje: HOJE,
    contas_receber: [cr({ valor_final: 1000 }), cr({ valor_final: 9999, status: 'CANCELADO' })],
    contas_pagar: [cp({ valor_final: 400 }), cp({ valor_final: 5555, status: 'CANCELADO' })],
  });
  eq(r.volume_liquido, 1000, 'cancelada fora do volume');
  eq(r.custo_previsto, 400, 'cancelada fora do custo');
  eq(r.margem_prevista, 600, 'margem ignora canceladas');
}
{
  // Cancelada que tinha baixa registrada não pode contar como caixa.
  const conta = cr({ valor_final: 1000, valor_recebido: 1000, status: 'CANCELADO' });
  eq(valorRealizado(conta, 'valor_recebido'), 0, 'cancelada não movimenta caixa');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- comissão de fornecedor é receita pura, não volume ---');
{
  // Cliente paga direto ao fornecedor; agência ganha comissão de 700.
  const r = calcularResultado({
    hoje: HOJE,
    contas_receber: [cr({ origem: 'COMISSAO_FORNECEDOR', valor_final: 700 })],
    contas_pagar: [],
  });
  eq(r.volume_vendido, 0, 'comissão não infla o volume vendido');
  eq(r.comissoes_a_receber, 700, 'comissão contabilizada à parte');
  eq(r.margem_prevista, 700, 'comissão entra inteira na margem');
  eq(r.a_receber, 700, 'comissão em aberto entra no a receber');
}
{
  // Venda mista: item próprio de 10.000 (custo 8.000) + comissão de 500.
  const r = calcularResultado({
    hoje: HOJE,
    contas_receber: [
      cr({ valor_final: 10000 }),
      cr({ origem: 'COMISSAO_FORNECEDOR', valor_final: 500 }),
    ],
    contas_pagar: [cp({ valor_final: 8000 })],
  });
  eq(r.volume_liquido, 10000, 'volume só do que passa pela agência');
  eq(r.margem_prevista, 2500, 'margem soma comissão e desconta custo');
  eq(r.margem_percentual, 25, 'percentual sobre o volume do cliente');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- previsto x realizado: custo que subiu depois da venda ---');
{
  // Vendido 20.000, custo previsto 16.500. Hotel veio 800 mais caro.
  const antes = calcularResultado({
    hoje: HOJE,
    contas_receber: [cr({ valor_final: 20000 })],
    contas_pagar: [cp({ valor_final: 10000 })],
  });
  eq(antes.margem_prevista, 10000, 'margem prevista no momento da venda');
  eq(antes.margem_baseline, null, 'sem baseline gravada, o campo é nulo');
  eq(antes.desvio_margem, null, 'sem baseline não se afirma desvio');

  // O hotel veio R$ 800 mais caro. A conta a pagar foi reescrita, então a
  // margem_prevista de hoje já embute o custo novo. Só a baseline travada
  // na venda revela que a margem encolheu.
  const depois = calcularResultado({
    hoje: HOJE,
    contas_receber: [cr({ valor_final: 20000, valor_recebido: 20000, status: 'RECEBIDO' })],
    contas_pagar: [cp({ valor_final: 10800, valor_pago: 10800, status: 'PAGO' })],
    baseline: { margem: 10000, custo: 10000 },
  });
  eq(depois.margem_prevista, 9200, 'margem prevista acompanha o custo atual');
  eq(depois.margem_realizada, 9200, 'margem realizada bate com o caixa');
  eq(depois.desvio_margem, -800, 'desvio contra a margem travada na venda');
  eq(depois.desvio_custo, 800, 'custo estourou o orçado em R$ 800');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- taxas de pagamento aparecem no resultado ---');
{
  // Venda de 10.000 no cartão com R$ 350 de taxa da adquirente.
  const r = calcularResultado({
    hoje: HOJE,
    contas_receber: [cr({ valor_final: 10000, taxa: 350 })],
    contas_pagar: [cp({ valor_final: 7000 })],
  });
  eq(r.taxas, 350, 'taxa registrada e somada');
  eq(r.margem_prevista, 3000, 'margem bruta antes da taxa');
  eq(r.resultado_final, 2650, 'resultado final desconta a taxa');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- vencidos e próximos vencimentos ---');
{
  const r = calcularResultado({
    hoje: HOJE,
    contas_receber: [
      cr({ valor_final: 1000, data_vencimento: '2026-08-01' }),            // vencida
      cr({ valor_final: 2000, data_vencimento: '2026-08-20', valor_recebido: 500, status: 'PARCIAL' }),
      cr({ valor_final: 3000, data_vencimento: '2026-11-10' }),            // futura
    ],
    contas_pagar: [cp({ valor_final: 900, data_vencimento: '2026-09-20' })],
  });
  eq(r.parcelas_vencidas, 2, 'duas parcelas em atraso');
  eq(r.vencido_a_receber, 2500, 'vencido conta só o saldo da parcial');
  eq(r.proxima_parcela?.data, '2026-11-10', 'próxima parcela é a futura mais perto');
  eq(r.proxima_parcela?.valor, 3000, 'valor da próxima parcela');
  eq(r.proximo_pagamento?.data, '2026-09-20', 'próximo pagamento ao fornecedor');
}
{
  // Sem futuras, a próxima é a mais antiga em atraso (é o que precisa de ação).
  const r = calcularResultado({
    hoje: HOJE,
    contas_receber: [
      cr({ valor_final: 500, data_vencimento: '2026-08-01' }),
      cr({ valor_final: 700, data_vencimento: '2026-07-01' }),
    ],
  });
  eq(r.proxima_parcela?.data, '2026-07-01', 'sem futuras, aponta a mais atrasada');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- precisão: 300 parcelas de 1 centavo ---');
{
  const contas = Array.from({ length: 300 }, () =>
    cr({ valor_final: 0.01, valor_recebido: 0.01, status: 'RECEBIDO' }));
  const r = calcularResultado({ hoje: HOJE, contas_receber: contas });
  eq(r.recebido, 3, '300 x R$ 0,01 dá exatamente R$ 3,00');
  eq(r.volume_liquido, 3, 'volume também fecha exato');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- divisão protegida: venda sem volume não estampa NaN ---');
{
  const r = calcularResultado({ hoje: HOJE, contas_receber: [], contas_pagar: [] });
  eq(r.margem_percentual, 0, 'margem percentual com volume zero é 0');
  eq(r.percentual_recebido, 0, 'percentual recebido sem contas é 0');
  eq(Number.isFinite(r.margem_percentual), true, 'nunca Infinity');
}
{
  // Custo lançado sem receita: margem negativa, percentual protegido.
  const r = calcularResultado({ hoje: HOJE, contas_pagar: [cp({ valor_final: 500 })] });
  eq(r.margem_prevista, -500, 'margem negativa é exibida como negativa');
  eq(r.margem_percentual, 0, 'sem base de volume, percentual fica 0');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- datas civis: nenhum deslocamento de fuso ---');
{
  eq(diasEntre('2026-09-06', '2026-09-06'), 0, 'mesmo dia dá zero');
  eq(diasEntre('2026-09-06', '2026-09-01'), 5, 'cinco dias de atraso');
  eq(diasEntre('2026-03-01', '2026-02-28'), 1, 'vira de mês sem erro');
  // Faixa de horário de verão no hemisfério sul.
  eq(diasEntre('2026-10-19', '2026-10-17'), 2, 'atravessa mudança de horário');
  eq(faixaDeAtraso('2026-09-06', HOJE), 'VENCE_HOJE', 'vence hoje');
  eq(faixaDeAtraso('2026-09-05', HOJE), 'ATE_3', 'um dia de atraso');
  eq(faixaDeAtraso('2026-09-03', HOJE), 'ATE_3', 'três dias de atraso');
  eq(faixaDeAtraso('2026-09-02', HOJE), 'ATE_7', 'quatro dias de atraso');
  eq(faixaDeAtraso('2026-08-30', HOJE), 'ATE_7', 'sete dias de atraso');
  eq(faixaDeAtraso('2026-08-29', HOJE), 'ATE_15', 'oito dias de atraso');
  eq(faixaDeAtraso('2026-08-07', HOJE), 'ATE_30', 'trinta dias de atraso');
  eq(faixaDeAtraso('2026-08-06', HOJE), 'ACIMA_30', 'trinta e um dias de atraso');
  eq(faixaDeAtraso('2026-09-07', HOJE), null, 'ainda vai vencer, não é atraso');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- inadimplência por faixa ---');
{
  const linhas = calcularInadimplencia([
    cr({ valor_final: 1000, data_vencimento: '2026-09-06', cliente_nome: 'Ana' }),
    cr({ valor_final: 2000, data_vencimento: '2026-09-04', cliente_nome: 'Bruno' }),
    cr({ valor_final: 5000, data_vencimento: '2026-08-20', valor_recebido: 3000, status: 'PARCIAL', cliente_nome: 'Carla' }),
    cr({ valor_final: 900, data_vencimento: '2026-12-01', cliente_nome: 'Futuro' }),
    cr({ valor_final: 400, data_vencimento: '2026-01-01', status: 'CANCELADO', cliente_nome: 'Cancelada' }),
    cr({ valor_final: 800, data_vencimento: '2026-05-01', valor_recebido: 800, status: 'RECEBIDO', cliente_nome: 'Quitada' }),
  ], HOJE);
  const porFaixa = Object.fromEntries(linhas.map(l => [l.faixa, { q: l.quantidade, v: l.valor }]));
  eq(porFaixa.VENCE_HOJE, { q: 1, v: 1000 }, 'vence hoje');
  eq(porFaixa.ATE_3, { q: 1, v: 2000 }, 'um a três dias');
  eq(porFaixa.ATE_30, { q: 1, v: 2000 }, 'parcial entra pelo saldo, não pelo total');
  eq(porFaixa.ACIMA_30, { q: 0, v: 0 }, 'quitada e cancelada não são inadimplência');
  eq(linhas.find(l => l.faixa === 'ATE_30')?.clientes, ['Carla'], 'cliente identificado na faixa');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- caixa livre: saldo bancário não é lucro ---');
{
  // O exemplo do briefing: 200.000 em conta, 130.000 de fornecedores,
  // 10.000 de tributos, 5.000 de comissões. Livre: 55.000.
  const c = calcularCaixaLivre({
    saldo_atual: 200000,
    contas_pagar: [cp({ valor_final: 130000, data_vencimento: '2026-09-30' })],
    comissoes_a_pagar: 5000,
    tributos: 10000,
    hoje: HOJE,
  });
  eq(c.comprometido_fornecedores, 130000, 'compromisso com fornecedores');
  eq(c.total_comprometido, 145000, 'total comprometido');
  eq(c.caixa_livre, 55000, 'caixa livre estimado');
}
{
  // Compromisso fora do horizonte não entra; dentro, entra.
  const contas = [
    cp({ valor_final: 1000, data_vencimento: '2026-09-20' }),
    cp({ valor_final: 9000, data_vencimento: '2027-03-01' }),
  ];
  const trintaDias = calcularCaixaLivre({ saldo_atual: 5000, contas_pagar: contas, horizonte_dias: 30, hoje: HOJE });
  eq(trintaDias.comprometido_fornecedores, 1000, 'horizonte de 30 dias pega só o que vence perto');
  eq(trintaDias.caixa_livre, 4000, 'caixa livre em 30 dias');

  const semLimite = calcularCaixaLivre({ saldo_atual: 5000, contas_pagar: contas, hoje: HOJE });
  eq(semLimite.comprometido_fornecedores, 10000, 'sem horizonte, todo compromisso conta');
  eq(semLimite.caixa_livre, -5000, 'caixa livre negativo é exibido, não escondido');
}
{
  // Pagamento parcial já feito reduz o compromisso restante.
  const c = calcularCaixaLivre({
    saldo_atual: 10000,
    contas_pagar: [cp({ valor_final: 4000, valor_pago: 1500, status: 'PARCIAL' })],
    hoje: HOJE,
  });
  eq(c.comprometido_fornecedores, 2500, 'compromisso é o saldo, não o total');
}
{
  // Entradas previstas não somam ao caixa livre, ficam à parte.
  const c = calcularCaixaLivre({
    saldo_atual: 1000,
    contas_pagar: [cp({ valor_final: 3000, data_vencimento: '2026-09-10' })],
    contas_receber: [cr({ valor_final: 4000, data_vencimento: '2026-09-09' })],
    hoje: HOJE,
  });
  eq(c.caixa_livre, -2000, 'caixa livre olha só o dinheiro que já existe');
  eq(c.entradas_previstas, 4000, 'entradas previstas informadas à parte');
  eq(c.caixa_livre_com_entradas, 2000, 'cenário com as entradas confirmadas');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- venda parcelada com recebimento parcial ---');
{
  // 12.000 em 3 parcelas: primeira quitada, segunda pela metade, terceira aberta.
  const r = calcularResultado({
    hoje: HOJE,
    contas_receber: [
      cr({ valor_final: 4000, valor_recebido: 4000, status: 'RECEBIDO', data_vencimento: '2026-07-06', parcela_numero: 1 }),
      cr({ valor_final: 4000, valor_recebido: 2000, status: 'PARCIAL', data_vencimento: '2026-08-06', parcela_numero: 2 }),
      cr({ valor_final: 4000, data_vencimento: '2026-10-06', parcela_numero: 3 }),
    ],
    contas_pagar: [cp({ valor_final: 9000, valor_pago: 9000, status: 'PAGO' })],
  });
  eq(r.volume_liquido, 12000, 'volume soma as três parcelas');
  eq(r.recebido, 6000, 'recebido soma quitada mais parcial');
  eq(r.a_receber, 6000, 'a receber é o saldo das duas em aberto');
  eq(r.percentual_recebido, 50, 'metade recebida');
  eq(r.parcelas_vencidas, 1, 'só a parcela 2 está vencida em aberto');
  eq(r.vencido_a_receber, 2000, 'vencido é o saldo da parcela 2');
  eq(r.margem_prevista, 3000, 'margem prevista da venda');
  eq(r.margem_realizada, -3000, 'pagou tudo ao fornecedor antes de receber tudo');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes de resultado financeiro passaram`);
if (falhas > 0) process.exit(1);
