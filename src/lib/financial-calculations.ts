import { GrupoViagem } from './types';
import { FinanceiroGrupo, Venda, Parcela, PagamentoFornecedor, FormaPagamento, TipoApto, PAX_PER_APTO, DREAgenciaResult } from './financial-types';
import { calcProposta, PropostaResult } from './calculations';
import { generateId } from './utils';
import {
  addDias,
  dataLocal,
  dividirParcelas,
  divSegura,
  hojeISO,
  num,
  percentual,
  round2,
  soma,
  somaPor,
} from './money';

// Bridge: read PROPOSTA data as ProdutoGrupo
export function getProdutoGrupo(g: GrupoViagem) {
  const p = calcProposta(g);
  const tipos = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;

  const makeRecord = (source: Record<string, number>) =>
    Object.fromEntries(tipos.map(t => [t, source[t] || 0])) as Record<string, number>;

  // Dates
  const allCheckIns = g.periodos.map(p => p.check_in).filter(Boolean) as string[];
  const allCheckOuts = g.periodos.map(p => p.check_out).filter(Boolean) as string[];
  if (g.navio_info.embarque) allCheckIns.push(g.navio_info.embarque);
  if (g.navio_info.desembarque) allCheckOuts.push(g.navio_info.desembarque);

  return {
    grp_id: g.grp_id,
    origem_destino: g.origem_destino,
    qtd_min_pax: g.params.qtd_min_pax,
    qtd_max_pax: g.params.qtd_max_pax,
    cortesias: g.params.cortesia,
    proposta: p,
    precos: {
      avista: makeRecord(p.totalAvista),
      cartao: makeRecord(p.totalCartao),
      boleto: makeRecord(p.totalBoleto),
    },
    parcelas_apto: {
      cartao: makeRecord(p.parcelaAptoCC),
      boleto: makeRecord(p.parcelaAptoBoleto),
    },
    precos_por_pax: {
      avista: makeRecord(p.totalPaxAvista),
      cartao: makeRecord(p.totalPaxCartao),
      boleto: makeRecord(p.totalPaxBoleto),
    },
    custos_por_apto: Object.fromEntries(
      p.lines.map(l => [l.label.toLowerCase(), { sgl: l.sgl, dbl: l.dbl, tpl: l.tpl, qdp: l.qdp, chd: l.chd }])
    ),
    params: g.params,
    datas: {
      primeira_partida: allCheckIns.length > 0 ? allCheckIns.sort()[0] : null,
      ultimo_retorno: allCheckOuts.length > 0 ? allCheckOuts.sort().reverse()[0] : null,
    },
    deadlines: Object.fromEntries(
      Object.entries(g.cambio).map(([k, v]) => [k, v.deadline])
    ),
  };
}

// Get suggested price for a sale
export function getPrecoSugerido(proposta: PropostaResult, tipoApto: TipoApto, forma: FormaPagamento): number {
  const tipo = tipoApto.toLowerCase();
  switch (forma) {
    case 'AVISTA_PIX': return proposta.totalAvista[tipo] || 0;
    case 'CARTAO': return proposta.totalCartao[tipo] || 0;
    case 'BOLETO': return proposta.totalBoleto[tipo] || 0;
  }
}

// Generate installments for a sale
export function gerarParcelas(venda: Venda): Parcela[] {
  const parcelas: Parcela[] = [];
  const dataVenda = venda.data_venda;

  if (venda.forma_pagamento === 'AVISTA_PIX') {
    parcelas.push({
      id: generateId(),
      venda_id: venda.id,
      cliente_nome: venda.cliente_nome,
      numero_parcela: 1,
      total_parcelas: 1,
      data_vencimento: venda.data_venda,
      valor: round2(num(venda.valor_final)),
      status: 'PENDENTE',
      data_recebimento: null,
      valor_recebido: null,
      forma_recebimento: null,
      observacoes: '',
    });
  } else {
    const n = Math.max(1, Math.floor(num(venda.qtd_parcelas)) || 1);
    // Resíduo dos centavos na última parcela — a soma tem que fechar o total.
    const valoresParcela = dividirParcelas(num(venda.valor_final), n);
    const isBoleto = venda.forma_pagamento === 'BOLETO';

    for (let i = 0; i < n; i++) {
      // First boleto: +5 business days (approximate with +7 calendar days)
      const offset = isBoleto ? 7 + (i * 30) : i * 30;

      parcelas.push({
        id: generateId(),
        venda_id: venda.id,
        cliente_nome: venda.cliente_nome,
        numero_parcela: i + 1,
        total_parcelas: n,
        data_vencimento: addDias(dataVenda, offset),
        valor: valoresParcela[i],
        status: 'PENDENTE',
        data_recebimento: null,
        valor_recebido: null,
        forma_recebimento: null,
        observacoes: '',
      });
    }
  }

  return parcelas;
}

// Auto-update overdue installments
export function atualizarParcelasAtrasadas(parcelas: Parcela[]): Parcela[] {
  const hoje = hojeISO();
  return parcelas.map(p => {
    if (p.status === 'PENDENTE' && p.data_vencimento < hoje) {
      return { ...p, status: 'ATRASADO' as const };
    }
    return p;
  });
}

// Sales metrics
export function calcVendasMetrics(fin: FinanceiroGrupo, maxPax: number) {
  const ativas = fin.vendas.filter(v => v.status !== 'CANCELADO');
  const totalAptos = ativas.length;
  const totalPax = ativas.reduce((s, v) => s + v.passageiros.length, 0);
  const totalChdExtras = ativas.reduce((s, v) => s + v.chds_extras.length, 0);
  const receitaBruta = somaPor(ativas, v => v.valor_total_apto);
  const descontos = somaPor(ativas, v => v.desconto_concedido);
  const receitaLiquida = somaPor(ativas, v => v.valor_final);
  const cortesiasUsadas = ativas.filter(v => v.is_cortesia).length;

  const vendasPorTipo: Record<string, number> = { SGL: 0, DBL: 0, TPL: 0, QDP: 0 };
  const vendasPorForma: Record<string, number> = { AVISTA_PIX: 0, CARTAO: 0, BOLETO: 0 };
  for (const v of ativas) {
    vendasPorTipo[v.tipo_apto] = (vendasPorTipo[v.tipo_apto] || 0) + 1;
    vendasPorForma[v.forma_pagamento] = (vendasPorForma[v.forma_pagamento] || 0) + 1;
  }

  return {
    totalAptos,
    totalPax,
    totalChdExtras,
    receitaBruta,
    descontos,
    receitaLiquida,
    ticketMedioApto: divSegura(receitaLiquida, totalAptos),
    ticketMedioPax: divSegura(receitaLiquida, totalPax),
    taxaOcupacao: divSegura(totalPax, maxPax) * 100,
    cortesiasUsadas,
    vendasPorTipo,
    vendasPorForma,
  };
}

// Receivables metrics
export function calcRecebimentosMetrics(parcelas: Parcela[]) {
  const ativas = parcelas.filter(p => p.status !== 'CANCELADO');
  const recebidas = ativas.filter(p => p.status === 'RECEBIDO');
  const pendentes = ativas.filter(p => p.status === 'PENDENTE');
  const atrasadas = ativas.filter(p => p.status === 'ATRASADO');

  const totalRecebido = somaPor(recebidas, p => p.valor_recebido || 0);
  const totalPendente = somaPor(pendentes, p => p.valor);
  const totalAtrasado = somaPor(atrasadas, p => p.valor);
  const totalAReceber = round2(totalPendente + totalAtrasado);

  const em30d = addDias(hojeISO(), 30);
  const previsao30d = somaPor(
    pendentes.filter(p => p.data_vencimento <= em30d),
    p => p.valor,
  );

  return {
    totalRecebido,
    totalPendente,
    totalAtrasado,
    totalAReceber,
    taxaInadimplencia: divSegura(totalAtrasado, totalRecebido + totalAReceber) * 100,
    previsao30d,
  };
}

// Supplier payment metrics
export function calcFornecedoresMetrics(pagamentos: PagamentoFornecedor[]) {
  const ativos = pagamentos.filter(p => p.status !== 'CANCELADO');
  const emBRL = (p: PagamentoFornecedor) =>
    round2(num(p.valor_negociado) * (num(p.cambio_pagamento) || num(p.cambio_cotacao) || 1));
  const custoCotado = somaPor(ativos, p => p.valor_brl_cotado);
  const custoNegociado = somaPor(ativos, emBRL);
  const totalPago = somaPor(ativos, p => p.valor_brl_pago);
  const totalAPagar = round2(custoNegociado - totalPago);
  const totalVencido = somaPor(
    ativos.filter(p => p.status === 'VENCIDO'),
    p => round2(emBRL(p) - num(p.valor_brl_pago)),
  );

  const porCategoria: Record<string, number> = {};
  for (const p of ativos) {
    porCategoria[p.categoria] = round2((porCategoria[p.categoria] || 0) + emBRL(p));
  }

  return {
    custoCotado,
    custoNegociado,
    economiaNegociacao: round2(custoCotado - custoNegociado),
    totalPago,
    totalAPagar,
    totalVencido,
    porCategoria,
  };
}

// Cash flow by month
export interface FluxoMensal {
  mes: string;
  entradasPrevistas: number;
  entradasRealizadas: number;
  saidasPrevistas: number;
  saidasRealizadas: number;
  saldoMensal: number;
  saldoAcumulado: number;
  // Visão da agência (só comissão)
  entradasComissao: number;
  saidasRepasses: number;
  saldoAgencia: number;
  saldoAgenciaAcumulado: number;
}

export function calcFluxoCaixa(fin: FinanceiroGrupo, ratioComissao?: number): FluxoMensal[] {
  const ratio = ratioComissao ?? 1;
  const meses = new Map<string, { ep: number; er: number; sp: number; sr: number; ec: number; srp: number }>();

  const getMonth = (d: string) => d.substring(0, 7);
  const ensureMonth = (m: string) => {
    if (!meses.has(m)) meses.set(m, { ep: 0, er: 0, sp: 0, sr: 0, ec: 0, srp: 0 });
    return meses.get(m)!;
  };

  // Entries from installments
  for (const p of fin.parcelas) {
    if (p.status === 'CANCELADO') continue;
    const m = getMonth(p.data_vencimento);
    const entry = ensureMonth(m);
    if (p.status === 'RECEBIDO' && p.data_recebimento) {
      const mr = getMonth(p.data_recebimento);
      const val = num(p.valor_recebido) || num(p.valor);
      ensureMonth(mr).er = round2(ensureMonth(mr).er + val);
      ensureMonth(mr).ec = round2(ensureMonth(mr).ec + val * ratio);
    }
    if (p.status === 'PENDENTE' || p.status === 'ATRASADO') {
      entry.ep = round2(entry.ep + num(p.valor));
      entry.ec = round2(entry.ec + num(p.valor) * ratio);
    } else if (p.status === 'RECEBIDO') {
      entry.ep = round2(entry.ep + num(p.valor));
    }
  }

  // Exits from supplier payments (repasses)
  for (const pg of fin.pagamentos_fornecedores) {
    if (pg.status === 'CANCELADO') continue;
    if (pg.data_vencimento) {
      const m = getMonth(pg.data_vencimento);
      const entry = ensureMonth(m);
      const val = round2(num(pg.valor_negociado) * (num(pg.cambio_pagamento) || num(pg.cambio_cotacao) || 1));
      entry.sp = round2(entry.sp + val);
      entry.srp = round2(entry.srp + val);
    }
    if (pg.data_pagamento) {
      const m = getMonth(pg.data_pagamento);
      ensureMonth(m).sr = round2(ensureMonth(m).sr + num(pg.valor_brl_pago));
    }
  }

  // Sort and calculate accumulated
  const sorted = Array.from(meses.entries()).sort(([a], [b]) => a.localeCompare(b));
  let acum = 0;
  let acumAgencia = 0;
  return sorted.map(([mes, d]) => {
    const saldo = round2(d.ep - d.sp);
    acum = round2(acum + saldo);
    const saldoAg = round2(d.ec - d.srp);
    acumAgencia = round2(acumAgencia + saldoAg);
    return {
      mes,
      entradasPrevistas: d.ep,
      entradasRealizadas: d.er,
      saidasPrevistas: d.sp,
      saidasRealizadas: d.sr,
      saldoMensal: saldo,
      saldoAcumulado: acum,
      entradasComissao: d.ec,
      saidasRepasses: d.srp,
      saldoAgencia: saldoAg,
      saldoAgenciaAcumulado: acumAgencia,
    };
  });
}

// DRE — Contabilidade de Agência de Viagens
// A agência é intermediária. Receita = comissão, não valor total do pacote.
// Impostos incidem sobre a comissão (Lei 11.771/2008).

export function calcDRE(g: GrupoViagem, fin: FinanceiroGrupo): DREAgenciaResult {
  const ativas = fin.vendas.filter(v => v.status !== 'CANCELADO');
  const canceladas = fin.vendas.filter(v => v.status === 'CANCELADO');
  const cortesiasVendas = ativas.filter(v => v.is_cortesia);

  // 1. FATURAMENTO BRUTO (total cobrado do cliente)
  const faturamentoBrutoPorTipo: Record<string, number> = { SGL: 0, DBL: 0, TPL: 0, QDP: 0 };
  for (const v of ativas) {
    faturamentoBrutoPorTipo[v.tipo_apto] = round2(num(faturamentoBrutoPorTipo[v.tipo_apto]) + num(v.valor_total_apto));
  }
  const faturamentoChdExtras = somaPor(ativas, v => somaPor(v.chds_extras, c => c.valor_final));
  const faturamentoBruto = round2(somaPor(ativas, v => v.valor_total_apto) + faturamentoChdExtras);

  // 2. DEDUÇÕES DO FATURAMENTO (cancelamentos e cortesias)
  const cancelamentoVal = somaPor(canceladas, v => v.valor_final);
  const cortesiaVal = somaPor(cortesiasVendas, v => v.valor_total_apto);
  const faturamentoLiquido = round2(faturamentoBruto - cancelamentoVal - cortesiaVal);

  // 3. REPASSES A FORNECEDORES (pass-through — não é receita da agência)
  const categorias = ['TKT', 'HTL', 'REC', 'CAR', 'GUIA', 'SEG', 'NAVIO', 'ING', 'BRINDE'] as const;
  const repassesPorCategoria: Record<string, number> = {};
  for (const cat of categorias) {
    const fornecedores = fin.pagamentos_fornecedores.filter(p => p.categoria === cat && p.status !== 'CANCELADO');
    repassesPorCategoria[cat] = somaPor(fornecedores, p => {
      const val = num(p.valor_negociado) > 0 ? num(p.valor_negociado) : num(p.valor_cotado);
      return round2(val * (num(p.cambio_pagamento) || num(p.cambio_cotacao) || 1));
    });
  }
  const repassesCustosExtras = somaPor(fin.custos_extras, c => c.valor);
  const repassesTotal = round2(soma(Object.values(repassesPorCategoria)) + repassesCustosExtras);

  // 4. RECEITA DA AGÊNCIA (comissão = faturamento - repasses)
  const receitaBrutaAgencia = round2(faturamentoLiquido - repassesTotal);

  // 5. DEDUÇÕES DA RECEITA (descontos saem da margem da agência)
  const descontosConcedidos = somaPor(ativas, v => v.desconto_concedido);
  const receitaLiquidaAgencia = round2(receitaBrutaAgencia - descontosConcedidos);

  // 6. CUSTOS OPERACIONAIS (custos próprios da agência)
  const vendasCartao = ativas.filter(v => v.forma_pagamento === 'CARTAO');
  const faturamentoCartao = somaPor(vendasCartao, v => v.valor_final);
  // tx_ad_mp é COEFICIENTE de recebimento do cartão (mesma semântica de
  // calcProposta: totalCartao = avista / tx_ad_mp). O custo da adquirência é o
  // que a maquininha retém: faturamento × (1 − coeficiente).
  // tx_ad_mp = 0 é o modelo simples (cartão = à vista, taxa não repassada) —
  // sem coeficiente NÃO existe custo de adquirência a lançar.
  const coefCartao = num(g.params.tx_ad_mp);
  const taxaAdquirencia = coefCartao > 0 && coefCartao < 1
    ? round2(faturamentoCartao * (1 - coefCartao))
    : 0;

  const vendasBoleto = ativas.filter(v => v.forma_pagamento === 'BOLETO');
  const totalBoletos = vendasBoleto.reduce((s, v) => s + num(v.qtd_parcelas), 0);
  const taxaBoleto = round2(totalBoletos * num(g.params.tx_boleto));

  const contratoComissao = round2(num(g.params.contrato) * ativas.filter(v => !v.is_cortesia).length);

  const variacaoCambial = somaPor(
    fin.pagamentos_fornecedores.filter(
      p => p.status !== 'CANCELADO' && p.moeda !== 'BRL'
        && p.cambio_pagamento && p.cambio_pagamento !== p.cambio_cotacao,
    ),
    p => round2((num(p.cambio_pagamento) - num(p.cambio_cotacao)) * num(p.valor_negociado)),
  );

  const custosAdmin = num(fin.config.custos_administrativos);
  const custosOpTotal = soma([taxaAdquirencia, taxaBoleto, contratoComissao, variacaoCambial, custosAdmin]);

  // 7. LUCRO OPERACIONAL
  const lucroOperacional = round2(receitaLiquidaAgencia - custosOpTotal);
  const margemOperacional = receitaLiquidaAgencia > 0 ? round2(divSegura(lucroOperacional, receitaLiquidaAgencia) * 100) : 0;

  // 8. IMPOSTOS (sobre RECEITA da agência, não sobre faturamento!)
  const aliquotaImposto = num(fin.config.aliquota_imposto);
  const impostos = receitaLiquidaAgencia > 0 ? percentual(receitaLiquidaAgencia, aliquotaImposto) : 0;
  const outrasTaxas = 0;
  const totalImpostos = round2(impostos + outrasTaxas);

  // 9. LUCRO LÍQUIDO
  const lucroLiquido = round2(lucroOperacional - totalImpostos);
  const margemLiquida = receitaLiquidaAgencia > 0 ? round2(divSegura(lucroLiquido, receitaLiquidaAgencia) * 100) : 0;

  return {
    faturamentoBrutoPorTipo, faturamentoChdExtras, faturamentoBruto,
    cancelamentos: cancelamentoVal, cortesias: cortesiaVal, faturamentoLiquido,
    repassesPorCategoria, repassesCustosExtras, repassesTotal,
    receitaBrutaAgencia,
    descontosConcedidos, receitaLiquidaAgencia,
    taxaAdquirencia, taxaBoleto, contratoComissao, variacaoCambial, custosAdmin, custosOpTotal,
    lucroOperacional, margemOperacional,
    aliquotaImposto, impostos, outrasTaxas, totalImpostos,
    lucroLiquido, margemLiquida,
    margemSobreFaturamento: faturamentoLiquido > 0 ? round2(divSegura(lucroLiquido, faturamentoLiquido) * 100) : 0,
    markupEfetivo: repassesTotal > 0 ? round2(divSegura(receitaBrutaAgencia, repassesTotal) * 100) : 0,
  };
}

// Indicadores / KPIs
export interface Indicadores {
  // Ocupacao
  paxVendidos: number;
  paxConfirmados: number;
  paxReservados: number;
  taxaOcupacao: number;
  vagasDisponiveis: number;
  // Break-even
  breakEvenPax: number;
  breakEvenAtingido: boolean;
  margemSeguranca: number;
  // Margins (baseadas em comissão/receita da agência)
  margemOperacional: number;
  margemLiquida: number;
  markupEfetivo: number;
  comissaoMediaPax: number;
  // Velocity
  diasDesdeAbertura: number;
  paxPorDia: number;
  diasParaLotar: number;
  dataEstimadaLotacao: string | null;
  vaiLotarATempo: boolean;
  // Scenarios (baseados em comissão)
  cenarioPessimista: { pax: number; receita: number; custo: number; lucro: number; margem: number };
  cenarioRealista: { pax: number; receita: number; custo: number; lucro: number; margem: number };
  cenarioOtimista: { pax: number; receita: number; custo: number; lucro: number; margem: number };
}

export function calcIndicadores(g: GrupoViagem, fin: FinanceiroGrupo): Indicadores {
  const ativas = fin.vendas.filter(v => v.status !== 'CANCELADO');
  const maxPax = g.params.qtd_max_pax;
  const paxVendidos = ativas.reduce((s, v) => s + v.passageiros.length, 0);
  const paxConfirmados = ativas.filter(v => v.status === 'CONFIRMADO').reduce((s, v) => s + v.passageiros.length, 0);
  const paxReservados = ativas.filter(v => v.status === 'RESERVADO').reduce((s, v) => s + v.passageiros.length, 0);
  const vagasDisponiveis = maxPax - paxVendidos;

  const dre = calcDRE(g, fin);
  // Usar receita da agência (comissão), não faturamento total
  const receitaAgencia = dre.receitaLiquidaAgencia;
  const custosOp = dre.custosOpTotal;

  // Break-even baseado na comissão por pax
  const comissaoPorPax = divSegura(receitaAgencia, paxVendidos);
  const custoOpPorPax = divSegura(custosOp, paxVendidos);
  const custoFixo = num(fin.config.custos_administrativos);
  const breakEvenPax = (comissaoPorPax - custoOpPorPax) > 0 ? divSegura(custoFixo, comissaoPorPax - custoOpPorPax) : 0;

  // Velocity
  const datasVenda = ativas.map(v => v.data_venda).filter(Boolean).sort();
  const hoje = dataLocal(hojeISO())!;
  const primeiraVenda = datasVenda.length > 0 ? (dataLocal(datasVenda[0]) ?? hoje) : hoje;
  const diasDesdeAbertura = Math.max(1, Math.floor((hoje.getTime() - primeiraVenda.getTime()) / 86400000));
  const paxPorDia = divSegura(paxVendidos, diasDesdeAbertura);
  const diasParaLotar = paxPorDia > 0 ? vagasDisponiveis / paxPorDia : Infinity;

  const produtoGrupo = getProdutoGrupo(g);
  const primeiraPartida = produtoGrupo.datas.primeira_partida;
  const dataLotacao = diasParaLotar === Infinity ? null : addDias(hojeISO(), Math.ceil(diasParaLotar));
  const partidaDate = primeiraPartida ? dataLocal(primeiraPartida) : null;
  const diasAteViagem = partidaDate ? Math.floor((partidaDate.getTime() - hoje.getTime()) / 86400000) : Infinity;

  // Cenários baseados em comissão (receita da agência)
  const taxaConv = fin.config.taxa_conversao_estimada / 100;
  const paxAdicionaisRealista = Math.round(vagasDisponiveis * taxaConv);

  const cenario = (pax: number, receita: number, custo: number) => ({
    pax,
    receita: round2(receita),
    custo: round2(custo),
    lucro: round2(receita - custo),
    margem: receita > 0 ? round2(divSegura(receita - custo, receita) * 100) : 0,
  });

  const cenarioPessimista = cenario(paxVendidos, receitaAgencia, custosOp);

  const cenarioRealista = cenario(
    paxVendidos + paxAdicionaisRealista,
    receitaAgencia + (paxAdicionaisRealista * comissaoPorPax),
    custosOp + (paxAdicionaisRealista * custoOpPorPax),
  );

  const cenarioOtimista = cenario(
    maxPax,
    receitaAgencia + (vagasDisponiveis * comissaoPorPax),
    custosOp + (vagasDisponiveis * custoOpPorPax),
  );

  return {
    paxVendidos, paxConfirmados, paxReservados,
    taxaOcupacao: divSegura(paxVendidos, maxPax) * 100,
    vagasDisponiveis,
    breakEvenPax: Math.ceil(breakEvenPax),
    breakEvenAtingido: paxVendidos >= breakEvenPax,
    margemSeguranca: paxVendidos - Math.ceil(breakEvenPax),
    margemOperacional: dre.margemOperacional,
    margemLiquida: dre.margemLiquida,
    markupEfetivo: dre.markupEfetivo,
    comissaoMediaPax: comissaoPorPax,
    diasDesdeAbertura,
    paxPorDia,
    diasParaLotar: diasParaLotar === Infinity ? 0 : Math.ceil(diasParaLotar),
    dataEstimadaLotacao: dataLotacao,
    vaiLotarATempo: diasParaLotar < diasAteViagem,
    cenarioPessimista, cenarioRealista, cenarioOtimista,
  };
}
