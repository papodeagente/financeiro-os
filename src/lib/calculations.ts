import { GrupoViagem } from './types';
import { minPositivo } from './utils';

// PAX count per room type
const PAX_MAP: Record<string, number> = { sgl: 1, dbl: 2, tpl: 3, qdp: 4, chd: 1 };
const TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;

// TKT totals
export function calcTktTotals(g: GrupoViagem) {
  let totalAdt = 0, totalChd = 0;
  const perTrecho: { melhorAdt: number; melhorChd: number }[] = [];
  for (const t of g.tkt.trechos) {
    const melhorAdt = minPositivo(t.fontes.map(f => f.valor_adt));
    const melhorChd = minPositivo(t.fontes.map(f => f.valor_chd));
    perTrecho.push({ melhorAdt, melhorChd });
    totalAdt += melhorAdt;
    totalChd += melhorChd;
  }
  return { totalAdt, totalChd, perTrecho };
}

// HTL totals
export function calcHtlTotals(g: GrupoViagem) {
  const totals = { sgl: 0, dbl: 0, tpl: 0, qdp: 0, chd: 0 };
  const perHotel: Record<string, number>[] = [];
  for (const h of g.htl.hoteis) {
    const best: Record<string, number> = {};
    for (const tipo of TIPOS) {
      const key = `valor_${tipo}` as keyof typeof h.fontes[0];
      best[tipo] = minPositivo(h.fontes.map(f => f[key] as number | null));
      totals[tipo] += best[tipo];
    }
    perHotel.push(best);
  }
  return { totals, perHotel };
}

// REC totals
export function calcRecTotals(g: GrupoViagem) {
  let totalAdt = 0, totalChd = 0;
  for (const p of g.rec.passeios) {
    totalAdt += minPositivo(p.fornecedores.map(f => f.valor_adt));
    totalChd += minPositivo(p.fornecedores.map(f => f.valor_chd));
  }
  return { totalAdt, totalChd };
}

// CAR totals
export function calcCarTotals(g: GrupoViagem) {
  const minPax = g.params.qtd_min_pax || 1;
  let totalPorPax = 0;
  for (const t of g.car.transportes) {
    const melhor = minPositivo(t.empresas.map(e => e.valor_veiculo));
    totalPorPax += melhor / minPax;
  }
  return { totalPorPax };
}

// GUIA totals
export function calcGuiaTotals(g: GrupoViagem) {
  const minPax = g.params.qtd_min_pax || 1;
  let totalPorPax = 0;
  for (const d of g.guia.destinos) {
    const melhor = minPositivo(d.fornecedores.map(f => f.valor_total));
    totalPorPax += melhor / minPax;
  }
  return { totalPorPax };
}

// SEG totals
export function calcSegTotals(g: GrupoViagem) {
  const result: Record<string, number> = {};
  for (const tipo of ['sgl', 'dbl', 'tpl', 'qdp'] as const) {
    const key = `valor_${tipo}` as keyof typeof g.seg.seguradoras[0];
    result[tipo] = minPositivo(g.seg.seguradoras.map(s => s[key] as number | null));
  }
  return result;
}

// NAVIO totals
export function calcNavioTotals(g: GrupoViagem) {
  const result: Record<string, number> = {};
  for (const tipo of TIPOS) {
    const key = `valor_${tipo}` as keyof typeof g.navio.fornecedores[0];
    result[tipo] = minPositivo(g.navio.fornecedores.map(f => f[key] as number | null));
  }
  return result;
}

// ING totals
export function calcIngTotals(g: GrupoViagem) {
  let totalAdt = 0, totalChd = 0, totalInf = 0, totalMeia = 0;
  for (const a of g.ing.atrativos) {
    totalAdt += minPositivo(a.fontes.map(f => f.valor_adt));
    totalChd += minPositivo(a.fontes.map(f => f.valor_chd));
    totalInf += minPositivo(a.fontes.map(f => f.valor_inf));
    totalMeia += minPositivo(a.fontes.map(f => f.valor_meia));
  }
  return { totalAdt, totalChd, totalInf, totalMeia };
}

// BRINDE totals
export function calcBrindeTotals(g: GrupoViagem) {
  return { melhorPreco: minPositivo(g.brinde.fornecedores.map(f => f.valor_unidade)) };
}

// DIVULGAÇÃO totals — soma de todos os canais ativos, rateada por pax
export function calcDivulgacaoTotals(g: GrupoViagem) {
  const minPax = g.params.qtd_min_pax || 1;
  const lista = g.divulgacao?.fornecedores || [];
  const totalGeral = lista.reduce((acc, f) => acc + (f.valor_total || 0), 0);
  return {
    totalGeral,
    totalPorPax: totalGeral / minPax,
  };
}

// PROPOSTA - full pricing calculation
export interface PropostaLine {
  label: string;
  sgl: number; dbl: number; tpl: number; qdp: number; chd: number;
}

export interface PropostaResult {
  lines: PropostaLine[];
  totalAvista: Record<string, number>;
  totalCartao: Record<string, number>;
  totalBoleto: Record<string, number>;
  parcelaAptoCC: Record<string, number>;
  parcelaAptoBoleto: Record<string, number>;
  totalPaxAvista: Record<string, number>;
  totalPaxCartao: Record<string, number>;
  totalPaxBoleto: Record<string, number>;
  parcelaPaxCC: Record<string, number>;
  parcelaPaxBoleto: Record<string, number>;
}

export function calcProposta(g: GrupoViagem): PropostaResult {
  const tkt = calcTktTotals(g);
  const htl = calcHtlTotals(g);
  const rec = calcRecTotals(g);
  const car = calcCarTotals(g);
  const guia = calcGuiaTotals(g);
  const seg = calcSegTotals(g);
  const nav = calcNavioTotals(g);
  const ing = calcIngTotals(g);
  const brinde = calcBrindeTotals(g);
  const divulgacao = calcDivulgacaoTotals(g);
  const c = g.cambio;
  const p = g.params;

  const getCambio = (key: string) => c[key]?.valor || 1;

  const lineValues: Record<string, Record<string, number>> = {};

  // TKT
  lineValues['TKT'] = {};
  for (const tipo of TIPOS) {
    if (tipo === 'chd') {
      lineValues['TKT'][tipo] = tkt.totalChd * 1 * getCambio('tkt');
    } else {
      lineValues['TKT'][tipo] = tkt.totalAdt * PAX_MAP[tipo] * getCambio('tkt');
    }
  }

  // HTL (already per room, no pax multiply)
  lineValues['HTL'] = {};
  for (const tipo of TIPOS) {
    lineValues['HTL'][tipo] = (htl.totals[tipo] || 0) * getCambio('htl');
  }

  // REC
  lineValues['REC'] = {};
  for (const tipo of TIPOS) {
    if (tipo === 'chd') {
      lineValues['REC'][tipo] = rec.totalChd * 1 * getCambio('rec');
    } else {
      lineValues['REC'][tipo] = rec.totalAdt * PAX_MAP[tipo] * getCambio('rec');
    }
  }

  // CAR
  lineValues['CAR'] = {};
  for (const tipo of TIPOS) {
    lineValues['CAR'][tipo] = car.totalPorPax * PAX_MAP[tipo] * getCambio('car');
  }

  // GUIA
  lineValues['GUIA'] = {};
  for (const tipo of TIPOS) {
    lineValues['GUIA'][tipo] = guia.totalPorPax * PAX_MAP[tipo] * getCambio('guia');
  }

  // SEG (already per room, no pax multiply)
  lineValues['SEG'] = {};
  for (const tipo of TIPOS) {
    if (tipo === 'chd') {
      lineValues['SEG'][tipo] = (seg['sgl'] || 0) * getCambio('seg'); // CHD uses SGL value
    } else {
      lineValues['SEG'][tipo] = (seg[tipo] || 0) * getCambio('seg');
    }
  }

  // NAVIO (already per cabin)
  lineValues['NAVIO'] = {};
  for (const tipo of TIPOS) {
    lineValues['NAVIO'][tipo] = (nav[tipo] || 0) * getCambio('navio');
  }

  // ING
  lineValues['ING'] = {};
  for (const tipo of TIPOS) {
    if (tipo === 'chd') {
      lineValues['ING'][tipo] = ing.totalChd * 1 * getCambio('ing');
    } else {
      lineValues['ING'][tipo] = ing.totalAdt * PAX_MAP[tipo] * getCambio('ing');
    }
  }

  // BRINDE
  lineValues['BRINDE'] = {};
  for (const tipo of TIPOS) {
    lineValues['BRINDE'][tipo] = brinde.melhorPreco * PAX_MAP[tipo] * getCambio('brinde');
  }

  // DIVULGAÇÃO (custo total rateado por pax, depois multiplicado pelo nº de pax do apto)
  lineValues['DIVULGACAO'] = {};
  for (const tipo of TIPOS) {
    lineValues['DIVULGACAO'][tipo] = divulgacao.totalPorPax * PAX_MAP[tipo] * getCambio('divulgacao');
  }

  // CORTESIA
  lineValues['CORTESIA'] = {};
  const serviceKeys = ['TKT', 'HTL', 'REC', 'CAR', 'GUIA', 'SEG', 'NAVIO', 'ING', 'BRINDE', 'DIVULGACAO'];
  for (const tipo of TIPOS) {
    const soma = serviceKeys.reduce((acc, k) => acc + (lineValues[k]?.[tipo] || 0), 0);
    lineValues['CORTESIA'][tipo] = (soma / (p.qtd_min_pax || 1)) * p.cortesia;
  }

  // CONTRATO
  lineValues['CONTRATO'] = {};
  for (const tipo of TIPOS) {
    lineValues['CONTRATO'][tipo] = p.contrato;
  }

  // MARKUP (divisor, only on specific items)
  lineValues['MARKUP'] = {};
  const markupItems = ['TKT', 'HTL', 'ING', 'REC', 'SEG', 'CAR', 'BRINDE', 'DIVULGACAO'];
  for (const tipo of TIPOS) {
    let somaMarcavel: number;
    if (tipo === 'chd') {
      // CHD doesn't include CONTRATO
      somaMarcavel = markupItems.reduce((acc, k) => acc + (lineValues[k]?.[tipo] || 0), 0);
    } else {
      somaMarcavel = markupItems.reduce((acc, k) => acc + (lineValues[k]?.[tipo] || 0), 0) + p.contrato;
    }
    lineValues['MARKUP'][tipo] = p.markup > 0 ? -somaMarcavel + (somaMarcavel / p.markup) : 0;
  }

  // Build lines array
  const allLineKeys = [...serviceKeys, 'CORTESIA', 'CONTRATO', 'MARKUP'];
  const lines: PropostaLine[] = allLineKeys.map(k => ({
    label: k,
    sgl: lineValues[k]?.sgl || 0,
    dbl: lineValues[k]?.dbl || 0,
    tpl: lineValues[k]?.tpl || 0,
    qdp: lineValues[k]?.qdp || 0,
    chd: lineValues[k]?.chd || 0,
  }));

  // Totals
  const totalAvista: Record<string, number> = {};
  const totalCartao: Record<string, number> = {};
  const totalBoleto: Record<string, number> = {};
  const parcelaAptoCC: Record<string, number> = {};
  const parcelaAptoBoleto: Record<string, number> = {};
  const totalPaxAvista: Record<string, number> = {};
  const totalPaxCartao: Record<string, number> = {};
  const totalPaxBoleto: Record<string, number> = {};
  const parcelaPaxCC: Record<string, number> = {};
  const parcelaPaxBoleto: Record<string, number> = {};

  for (const tipo of TIPOS) {
    const soma = allLineKeys.reduce((acc, k) => acc + (lineValues[k]?.[tipo] || 0), 0);
    totalAvista[tipo] = soma;
    totalCartao[tipo] = p.tx_ad_mp > 0 ? soma / p.tx_ad_mp : 0;
    totalBoleto[tipo] = totalCartao[tipo] + (p.tx_boleto * p.parcelas);
    parcelaAptoCC[tipo] = p.parcelas > 0 ? totalCartao[tipo] / p.parcelas : 0;
    parcelaAptoBoleto[tipo] = p.parcelas > 0 ? totalBoleto[tipo] / p.parcelas : 0;

    const pax = PAX_MAP[tipo];
    totalPaxAvista[tipo] = totalAvista[tipo] / pax;
    totalPaxCartao[tipo] = totalCartao[tipo] / pax;
    totalPaxBoleto[tipo] = totalBoleto[tipo] / pax;
    parcelaPaxCC[tipo] = p.parcelas > 0 ? totalPaxCartao[tipo] / p.parcelas : 0;
    parcelaPaxBoleto[tipo] = p.parcelas > 0 ? totalPaxBoleto[tipo] / p.parcelas : 0;
  }

  return {
    lines, totalAvista, totalCartao, totalBoleto,
    parcelaAptoCC, parcelaAptoBoleto,
    totalPaxAvista, totalPaxCartao, totalPaxBoleto,
    parcelaPaxCC, parcelaPaxBoleto,
  };
}
