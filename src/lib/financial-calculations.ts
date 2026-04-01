import { GrupoViagem } from './types';
import { FinanceiroGrupo, Venda, Parcela, PagamentoFornecedor, FormaPagamento, TipoApto, PAX_PER_APTO } from './financial-types';
import { calcProposta, PropostaResult } from './calculations';
import { generateId } from './utils';

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
  const dataVenda = new Date(venda.data_venda);

  if (venda.forma_pagamento === 'AVISTA_PIX') {
    parcelas.push({
      id: generateId(),
      venda_id: venda.id,
      cliente_nome: venda.cliente_nome,
      numero_parcela: 1,
      total_parcelas: 1,
      data_vencimento: venda.data_venda,
      valor: venda.valor_final,
      status: 'PENDENTE',
      data_recebimento: null,
      valor_recebido: null,
      forma_recebimento: null,
      observacoes: '',
    });
  } else {
    const n = venda.qtd_parcelas || 1;
    const valorParcela = venda.valor_final / n;
    const isBoleto = venda.forma_pagamento === 'BOLETO';

    for (let i = 0; i < n; i++) {
      const dt = new Date(dataVenda);
      if (isBoleto && i === 0) {
        // First boleto: +5 business days (approximate with +7 calendar days)
        dt.setDate(dt.getDate() + 7);
      } else if (isBoleto) {
        dt.setDate(dt.getDate() + 7 + (i * 30));
      } else {
        dt.setDate(dt.getDate() + (i * 30));
      }

      parcelas.push({
        id: generateId(),
        venda_id: venda.id,
        cliente_nome: venda.cliente_nome,
        numero_parcela: i + 1,
        total_parcelas: n,
        data_vencimento: dt.toISOString().split('T')[0],
        valor: Math.round(valorParcela * 100) / 100,
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
  const hoje = new Date().toISOString().split('T')[0];
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
  const receitaBruta = ativas.reduce((s, v) => s + v.valor_total_apto, 0);
  const descontos = ativas.reduce((s, v) => s + v.desconto_concedido, 0);
  const receitaLiquida = ativas.reduce((s, v) => s + v.valor_final, 0);
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
    ticketMedioApto: totalAptos > 0 ? receitaLiquida / totalAptos : 0,
    ticketMedioPax: totalPax > 0 ? receitaLiquida / totalPax : 0,
    taxaOcupacao: maxPax > 0 ? (totalPax / maxPax) * 100 : 0,
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

  const totalRecebido = recebidas.reduce((s, p) => s + (p.valor_recebido || 0), 0);
  const totalPendente = pendentes.reduce((s, p) => s + p.valor, 0);
  const totalAtrasado = atrasadas.reduce((s, p) => s + p.valor, 0);
  const totalAReceber = totalPendente + totalAtrasado;

  const hoje = new Date();
  const em30d = new Date(hoje);
  em30d.setDate(em30d.getDate() + 30);
  const previsao30d = pendentes
    .filter(p => p.data_vencimento <= em30d.toISOString().split('T')[0])
    .reduce((s, p) => s + p.valor, 0);

  return {
    totalRecebido,
    totalPendente,
    totalAtrasado,
    totalAReceber,
    taxaInadimplencia: (totalRecebido + totalAReceber) > 0 ? (totalAtrasado / (totalRecebido + totalAReceber)) * 100 : 0,
    previsao30d,
  };
}

// Supplier payment metrics
export function calcFornecedoresMetrics(pagamentos: PagamentoFornecedor[]) {
  const ativos = pagamentos.filter(p => p.status !== 'CANCELADO');
  const custoCotado = ativos.reduce((s, p) => s + p.valor_brl_cotado, 0);
  const custoNegociado = ativos.reduce((s, p) => s + (p.valor_negociado * (p.cambio_pagamento || p.cambio_cotacao)), 0);
  const totalPago = ativos.reduce((s, p) => s + p.valor_brl_pago, 0);
  const totalAPagar = custoNegociado - totalPago;
  const totalVencido = ativos
    .filter(p => p.status === 'VENCIDO')
    .reduce((s, p) => s + ((p.valor_negociado * (p.cambio_pagamento || p.cambio_cotacao)) - p.valor_brl_pago), 0);

  const porCategoria: Record<string, number> = {};
  for (const p of ativos) {
    porCategoria[p.categoria] = (porCategoria[p.categoria] || 0) + (p.valor_negociado * (p.cambio_pagamento || p.cambio_cotacao));
  }

  return {
    custoCotado,
    custoNegociado,
    economiaNegociacao: custoCotado - custoNegociado,
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
}

export function calcFluxoCaixa(fin: FinanceiroGrupo): FluxoMensal[] {
  const meses = new Map<string, { ep: number; er: number; sp: number; sr: number }>();

  const getMonth = (d: string) => d.substring(0, 7);
  const ensureMonth = (m: string) => {
    if (!meses.has(m)) meses.set(m, { ep: 0, er: 0, sp: 0, sr: 0 });
    return meses.get(m)!;
  };

  // Entries from installments
  for (const p of fin.parcelas) {
    if (p.status === 'CANCELADO') continue;
    const m = getMonth(p.data_vencimento);
    const entry = ensureMonth(m);
    if (p.status === 'RECEBIDO' && p.data_recebimento) {
      const mr = getMonth(p.data_recebimento);
      ensureMonth(mr).er += p.valor_recebido || p.valor;
    }
    if (p.status === 'PENDENTE' || p.status === 'ATRASADO') {
      entry.ep += p.valor;
    } else if (p.status === 'RECEBIDO') {
      entry.ep += p.valor;
    }
  }

  // Exits from supplier payments
  for (const pg of fin.pagamentos_fornecedores) {
    if (pg.status === 'CANCELADO') continue;
    if (pg.data_vencimento) {
      const m = getMonth(pg.data_vencimento);
      const entry = ensureMonth(m);
      const val = pg.valor_negociado * (pg.cambio_pagamento || pg.cambio_cotacao);
      entry.sp += val;
    }
    if (pg.data_pagamento) {
      const m = getMonth(pg.data_pagamento);
      ensureMonth(m).sr += pg.valor_brl_pago;
    }
  }

  // Sort and calculate accumulated
  const sorted = Array.from(meses.entries()).sort(([a], [b]) => a.localeCompare(b));
  let acum = 0;
  return sorted.map(([mes, d]) => {
    const saldo = d.ep - d.sp;
    acum += saldo;
    return {
      mes,
      entradasPrevistas: d.ep,
      entradasRealizadas: d.er,
      saidasPrevistas: d.sp,
      saidasRealizadas: d.sr,
      saldoMensal: saldo,
      saldoAcumulado: acum,
    };
  });
}

// DRE calculation
export interface DREResult {
  receitaBruta: number;
  receitaPorTipo: Record<string, number>;
  receitaChdExtras: number;
  descontos: number;
  cancelamentos: number;
  cortesias: number;
  receitaLiquida: number;
  custosPorCategoria: Record<string, number>;
  custosDiretosTotal: number;
  lucroBruto: number;
  margemBruta: number;
  taxaAdquirencia: number;
  taxaBoleto: number;
  contratoComissao: number;
  variacaoCambial: number;
  custosAdmin: number;
  custosOpTotal: number;
  lucroOperacional: number;
  margemOperacional: number;
  impostos: number;
  outrasTaxas: number;
  totalImpostos: number;
  lucroLiquido: number;
  margemLiquida: number;
}

export function calcDRE(g: GrupoViagem, fin: FinanceiroGrupo): DREResult {
  const ativas = fin.vendas.filter(v => v.status !== 'CANCELADO');
  const canceladas = fin.vendas.filter(v => v.status === 'CANCELADO');
  const cortesias = ativas.filter(v => v.is_cortesia);

  // 1. Receita Bruta
  const receitaPorTipo: Record<string, number> = { SGL: 0, DBL: 0, TPL: 0, QDP: 0 };
  for (const v of ativas) {
    receitaPorTipo[v.tipo_apto] += v.valor_total_apto;
  }
  const receitaChdExtras = ativas.reduce((s, v) => s + v.chds_extras.reduce((ss, c) => ss + c.valor_final, 0), 0);
  const receitaBruta = ativas.reduce((s, v) => s + v.valor_total_apto, 0) + receitaChdExtras;

  // 2. Deductions
  const descontos = ativas.reduce((s, v) => s + v.desconto_concedido, 0);
  const cancelamentoVal = canceladas.reduce((s, v) => s + v.valor_final, 0);
  const cortesiaVal = cortesias.reduce((s, v) => s + v.valor_total_apto, 0);
  const receitaLiquida = receitaBruta - descontos - cancelamentoVal - cortesiaVal;

  // 3. Direct costs
  const categorias = ['TKT', 'HTL', 'REC', 'CAR', 'GUIA', 'SEG', 'NAVIO', 'ING', 'BRINDE'] as const;
  const custosPorCategoria: Record<string, number> = {};
  for (const cat of categorias) {
    const fornecedores = fin.pagamentos_fornecedores.filter(p => p.categoria === cat && p.status !== 'CANCELADO');
    custosPorCategoria[cat] = fornecedores.reduce((s, p) => {
      const val = p.valor_negociado > 0 ? p.valor_negociado : p.valor_cotado;
      return s + val * (p.cambio_pagamento || p.cambio_cotacao);
    }, 0);
  }
  const custosDiretosTotal = Object.values(custosPorCategoria).reduce((a, b) => a + b, 0)
    + fin.custos_extras.reduce((s, c) => s + c.valor, 0);

  // 4. Lucro Bruto
  const lucroBruto = receitaLiquida - custosDiretosTotal;
  const margemBruta = receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : 0;

  // 5. Operational costs
  const vendasCartao = ativas.filter(v => v.forma_pagamento === 'CARTAO');
  const receitaCartao = vendasCartao.reduce((s, v) => s + v.valor_final, 0);
  const taxaAdquirencia = receitaCartao > 0 ? receitaCartao - (receitaCartao * g.params.tx_ad_mp) : 0;

  const vendasBoleto = ativas.filter(v => v.forma_pagamento === 'BOLETO');
  const totalBoletos = vendasBoleto.reduce((s, v) => s + v.qtd_parcelas, 0);
  const taxaBoleto = totalBoletos * g.params.tx_boleto;

  const contratoComissao = g.params.contrato * ativas.filter(v => !v.is_cortesia).length;

  let variacaoCambial = 0;
  for (const p of fin.pagamentos_fornecedores) {
    if (p.status === 'CANCELADO' || p.moeda === 'BRL') continue;
    if (p.cambio_pagamento && p.cambio_pagamento !== p.cambio_cotacao) {
      variacaoCambial += (p.cambio_pagamento - p.cambio_cotacao) * p.valor_negociado;
    }
  }

  const custosAdmin = fin.config.custos_administrativos;
  const custosOpTotal = taxaAdquirencia + taxaBoleto + contratoComissao + variacaoCambial + custosAdmin;

  // 6. Lucro Operacional
  const lucroOperacional = lucroBruto - custosOpTotal;
  const margemOperacional = receitaLiquida > 0 ? (lucroOperacional / receitaLiquida) * 100 : 0;

  // 7. Impostos
  const impostos = receitaLiquida * (fin.config.aliquota_imposto / 100);
  const outrasTaxas = 0;
  const totalImpostos = impostos + outrasTaxas;

  // 8. Lucro Liquido
  const lucroLiquido = lucroOperacional - totalImpostos;
  const margemLiquida = receitaLiquida > 0 ? (lucroLiquido / receitaLiquida) * 100 : 0;

  return {
    receitaBruta, receitaPorTipo, receitaChdExtras,
    descontos, cancelamentos: cancelamentoVal, cortesias: cortesiaVal,
    receitaLiquida,
    custosPorCategoria, custosDiretosTotal,
    lucroBruto, margemBruta,
    taxaAdquirencia, taxaBoleto, contratoComissao, variacaoCambial, custosAdmin,
    custosOpTotal,
    lucroOperacional, margemOperacional,
    impostos, outrasTaxas, totalImpostos,
    lucroLiquido, margemLiquida,
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
  // Margins
  margemBruta: number;
  margemOperacional: number;
  margemLiquida: number;
  markupEfetivo: number;
  // Velocity
  diasDesdeAbertura: number;
  paxPorDia: number;
  diasParaLotar: number;
  dataEstimadaLotacao: string | null;
  vaiLotarATempo: boolean;
  // Scenarios
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
  const receitaLiquida = dre.receitaLiquida;
  const custoTotal = dre.custosDiretosTotal;

  // Fixed vs variable costs
  const fixas = ['CAR', 'GUIA'];
  const custoFixo = fixas.reduce((s, c) => s + (dre.custosPorCategoria[c] || 0), 0) + fin.config.custos_administrativos;
  const custoVariavel = custoTotal - custoFixo;
  const custoVarPorPax = paxVendidos > 0 ? custoVariavel / paxVendidos : 0;
  const ticketMedioPax = paxVendidos > 0 ? receitaLiquida / paxVendidos : 0;
  const breakEvenPax = (ticketMedioPax - custoVarPorPax) > 0 ? custoFixo / (ticketMedioPax - custoVarPorPax) : 0;

  // Velocity
  const datasVenda = ativas.map(v => v.data_venda).sort();
  const hoje = new Date();
  const primeiraVenda = datasVenda.length > 0 ? new Date(datasVenda[0]) : hoje;
  const diasDesdeAbertura = Math.max(1, Math.floor((hoje.getTime() - primeiraVenda.getTime()) / 86400000));
  const paxPorDia = paxVendidos / diasDesdeAbertura;
  const diasParaLotar = paxPorDia > 0 ? vagasDisponiveis / paxPorDia : Infinity;

  const produtoGrupo = getProdutoGrupo(g);
  const primeiraPartida = produtoGrupo.datas.primeira_partida;
  const dataLotacao = new Date(hoje);
  dataLotacao.setDate(dataLotacao.getDate() + diasParaLotar);
  const diasAteViagem = primeiraPartida ? Math.floor((new Date(primeiraPartida).getTime() - hoje.getTime()) / 86400000) : Infinity;

  // Scenarios
  const taxaConv = fin.config.taxa_conversao_estimada / 100;
  const paxAdicionaisRealista = Math.round(vagasDisponiveis * taxaConv);

  const cenarioPessimista = {
    pax: paxVendidos,
    receita: receitaLiquida,
    custo: custoTotal,
    lucro: receitaLiquida - custoTotal,
    margem: receitaLiquida > 0 ? ((receitaLiquida - custoTotal) / receitaLiquida) * 100 : 0,
  };

  const receitaRealista = receitaLiquida + (paxAdicionaisRealista * ticketMedioPax);
  const custoRealista = custoTotal + (paxAdicionaisRealista * custoVarPorPax);
  const cenarioRealista = {
    pax: paxVendidos + paxAdicionaisRealista,
    receita: receitaRealista,
    custo: custoRealista,
    lucro: receitaRealista - custoRealista,
    margem: receitaRealista > 0 ? ((receitaRealista - custoRealista) / receitaRealista) * 100 : 0,
  };

  const receitaOtimista = receitaLiquida + (vagasDisponiveis * ticketMedioPax);
  const custoOtimista = custoTotal + (vagasDisponiveis * custoVarPorPax);
  const cenarioOtimista = {
    pax: maxPax,
    receita: receitaOtimista,
    custo: custoOtimista,
    lucro: receitaOtimista - custoOtimista,
    margem: receitaOtimista > 0 ? ((receitaOtimista - custoOtimista) / receitaOtimista) * 100 : 0,
  };

  return {
    paxVendidos, paxConfirmados, paxReservados,
    taxaOcupacao: maxPax > 0 ? (paxVendidos / maxPax) * 100 : 0,
    vagasDisponiveis,
    breakEvenPax: Math.ceil(breakEvenPax),
    breakEvenAtingido: paxVendidos >= breakEvenPax,
    margemSeguranca: paxVendidos - Math.ceil(breakEvenPax),
    margemBruta: dre.margemBruta,
    margemOperacional: dre.margemOperacional,
    margemLiquida: dre.margemLiquida,
    markupEfetivo: custoTotal > 0 ? receitaLiquida / custoTotal : 0,
    diasDesdeAbertura,
    paxPorDia,
    diasParaLotar: diasParaLotar === Infinity ? 0 : Math.ceil(diasParaLotar),
    dataEstimadaLotacao: diasParaLotar !== Infinity ? dataLotacao.toISOString().split('T')[0] : null,
    vaiLotarATempo: diasParaLotar < diasAteViagem,
    cenarioPessimista, cenarioRealista, cenarioOtimista,
  };
}
