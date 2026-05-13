import { GrupoViagem } from './types';
import { minPositivo } from './utils';

// PAX count per room type
const PAX_MAP: Record<string, number> = { sgl: 1, dbl: 2, tpl: 3, qdp: 4, chd: 1 };
const TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;

// Quantidade total de pax usada como divisor nos cálculos por pessoa.
// Quando o grupo tem lista de passageiros cadastrados, ela é a fonte de
// verdade (independe do tipo GRUPO/PROPOSTA). Senão, cai no qtd_min_pax
// editado manualmente (compat com grupos legados sem lista).
export function getPaxCount(g: GrupoViagem): number {
  if (g.passageiros && g.passageiros.length > 0) return g.passageiros.length;
  return g.params.qtd_min_pax || 1;
}

// "Melhor preço de venda" — pega o MAIOR valor preenchido (não mais barato).
// Faz sentido porque venda é receita: quem cobra mais e ainda fecha é a
// referência. Retorna 0 se nenhuma fonte preencheu o campo.
function maxPositivo(vals: Array<number | null | undefined>): number {
  const ok = vals.filter((v): v is number => typeof v === 'number' && v > 0);
  return ok.length === 0 ? 0 : Math.max(...ok);
}

// TKT totals — custo + venda
export function calcTktTotals(g: GrupoViagem) {
  let totalAdt = 0, totalChd = 0;
  let totalAdtVenda = 0, totalChdVenda = 0;
  let hasVenda = false;
  const perTrecho: { melhorAdt: number; melhorChd: number }[] = [];
  for (const t of g.tkt.trechos) {
    const melhorAdt = minPositivo(t.fontes.map(f => f.valor_adt));
    const melhorChd = minPositivo(t.fontes.map(f => f.valor_chd));
    perTrecho.push({ melhorAdt, melhorChd });
    totalAdt += melhorAdt;
    totalChd += melhorChd;
    const vAdt = maxPositivo(t.fontes.map(f => f.valor_venda_adt));
    const vChd = maxPositivo(t.fontes.map(f => f.valor_venda_chd));
    totalAdtVenda += vAdt;
    totalChdVenda += vChd;
    if (vAdt > 0 || vChd > 0) hasVenda = true;
  }
  return { totalAdt, totalChd, totalAdtVenda, totalChdVenda, hasVenda, perTrecho };
}

// HTL totals
export function calcHtlTotals(g: GrupoViagem) {
  const totals = { sgl: 0, dbl: 0, tpl: 0, qdp: 0, chd: 0 };
  const totalsVenda = { sgl: 0, dbl: 0, tpl: 0, qdp: 0, chd: 0 };
  let hasVenda = false;
  const perHotel: Record<string, number>[] = [];
  for (const h of g.htl.hoteis) {
    const best: Record<string, number> = {};
    for (const tipo of TIPOS) {
      const key = `valor_${tipo}` as keyof typeof h.fontes[0];
      best[tipo] = minPositivo(h.fontes.map(f => f[key] as number | null));
      totals[tipo] += best[tipo];
      const vKey = `valor_venda_${tipo}` as keyof typeof h.fontes[0];
      const v = maxPositivo(h.fontes.map(f => f[vKey] as number | null | undefined));
      totalsVenda[tipo] += v;
      if (v > 0) hasVenda = true;
    }
    perHotel.push(best);
  }
  return { totals, totalsVenda, hasVenda, perHotel };
}

// REC totals
export function calcRecTotals(g: GrupoViagem) {
  let totalAdt = 0, totalChd = 0;
  let totalAdtVenda = 0, totalChdVenda = 0;
  let hasVenda = false;
  for (const p of g.rec.passeios) {
    totalAdt += minPositivo(p.fornecedores.map(f => f.valor_adt));
    totalChd += minPositivo(p.fornecedores.map(f => f.valor_chd));
    const vAdt = maxPositivo(p.fornecedores.map(f => f.valor_venda_adt));
    const vChd = maxPositivo(p.fornecedores.map(f => f.valor_venda_chd));
    totalAdtVenda += vAdt;
    totalChdVenda += vChd;
    if (vAdt > 0 || vChd > 0) hasVenda = true;
  }
  return { totalAdt, totalChd, totalAdtVenda, totalChdVenda, hasVenda };
}

// CAR totals
export function calcCarTotals(g: GrupoViagem) {
  const minPax = getPaxCount(g);
  let totalPorPax = 0;
  let totalPorPaxVenda = 0;
  let hasVenda = false;
  for (const t of g.car.transportes) {
    const melhor = minPositivo(t.empresas.map(e => e.valor_veiculo));
    totalPorPax += melhor / minPax;
    const v = maxPositivo(t.empresas.map(e => e.valor_venda_veiculo));
    if (v > 0) {
      totalPorPaxVenda += v / minPax;
      hasVenda = true;
    }
  }
  return { totalPorPax, totalPorPaxVenda, hasVenda };
}

// GUIA totals
export function calcGuiaTotals(g: GrupoViagem) {
  const minPax = getPaxCount(g);
  let totalPorPax = 0;
  let totalPorPaxVenda = 0;
  let hasVenda = false;
  for (const d of g.guia.destinos) {
    const melhor = minPositivo(d.fornecedores.map(f => f.valor_total));
    totalPorPax += melhor / minPax;
    const v = maxPositivo(d.fornecedores.map(f => f.valor_venda_total));
    if (v > 0) {
      totalPorPaxVenda += v / minPax;
      hasVenda = true;
    }
  }
  return { totalPorPax, totalPorPaxVenda, hasVenda };
}

// SEG totals — custo por tipo + venda por tipo + hasVenda
export function calcSegTotals(g: GrupoViagem) {
  const result: Record<string, number> = { sgl: 0, dbl: 0, tpl: 0, qdp: 0 };
  const venda: Record<string, number> = { sgl: 0, dbl: 0, tpl: 0, qdp: 0 };
  let hasVenda = false;
  for (const tipo of ['sgl', 'dbl', 'tpl', 'qdp'] as const) {
    const key = `valor_${tipo}` as keyof typeof g.seg.seguradoras[0];
    result[tipo] = minPositivo(g.seg.seguradoras.map(s => s[key] as number | null));
    const vKey = `valor_venda_${tipo}` as keyof typeof g.seg.seguradoras[0];
    const v = maxPositivo(g.seg.seguradoras.map(s => s[vKey] as number | null | undefined));
    venda[tipo] = v;
    if (v > 0) hasVenda = true;
  }
  return { ...result, venda, hasVenda } as Record<string, number> & { venda: Record<string, number>; hasVenda: boolean };
}

// NAVIO totals
export function calcNavioTotals(g: GrupoViagem) {
  const result: Record<string, number> = { sgl: 0, dbl: 0, tpl: 0, qdp: 0, chd: 0 };
  const venda: Record<string, number> = { sgl: 0, dbl: 0, tpl: 0, qdp: 0, chd: 0 };
  let hasVenda = false;
  for (const tipo of TIPOS) {
    const key = `valor_${tipo}` as keyof typeof g.navio.fornecedores[0];
    result[tipo] = minPositivo(g.navio.fornecedores.map(f => f[key] as number | null));
    const vKey = `valor_venda_${tipo}` as keyof typeof g.navio.fornecedores[0];
    const v = maxPositivo(g.navio.fornecedores.map(f => f[vKey] as number | null | undefined));
    venda[tipo] = v;
    if (v > 0) hasVenda = true;
  }
  return { ...result, venda, hasVenda } as Record<string, number> & { venda: Record<string, number>; hasVenda: boolean };
}

// ING totals
export function calcIngTotals(g: GrupoViagem) {
  let totalAdt = 0, totalChd = 0, totalInf = 0, totalMeia = 0;
  let totalAdtVenda = 0, totalChdVenda = 0;
  let hasVenda = false;
  for (const a of g.ing.atrativos) {
    totalAdt += minPositivo(a.fontes.map(f => f.valor_adt));
    totalChd += minPositivo(a.fontes.map(f => f.valor_chd));
    totalInf += minPositivo(a.fontes.map(f => f.valor_inf));
    totalMeia += minPositivo(a.fontes.map(f => f.valor_meia));
    const vAdt = maxPositivo(a.fontes.map(f => f.valor_venda_adt));
    const vChd = maxPositivo(a.fontes.map(f => f.valor_venda_chd));
    totalAdtVenda += vAdt;
    totalChdVenda += vChd;
    if (vAdt > 0 || vChd > 0) hasVenda = true;
  }
  return { totalAdt, totalChd, totalInf, totalMeia, totalAdtVenda, totalChdVenda, hasVenda };
}

// BRINDE totals
export function calcBrindeTotals(g: GrupoViagem) {
  const melhorPreco = minPositivo(g.brinde.fornecedores.map(f => f.valor_unidade));
  const melhorPrecoVenda = maxPositivo(g.brinde.fornecedores.map(f => f.valor_venda_unidade));
  return { melhorPreco, melhorPrecoVenda, hasVenda: melhorPrecoVenda > 0 };
}

// DIVULGAÇÃO totals — soma de todos os canais ativos, rateada por pax
export function calcDivulgacaoTotals(g: GrupoViagem) {
  const minPax = getPaxCount(g);
  const lista = g.divulgacao?.fornecedores || [];
  const totalGeral = lista.reduce((acc, f) => acc + (f.valor_total || 0), 0);
  const totalGeralVenda = lista.reduce((acc, f) => acc + (f.valor_venda_total || 0), 0);
  return {
    totalGeral,
    totalPorPax: totalGeral / minPax,
    totalGeralVenda,
    totalPorPaxVenda: totalGeralVenda / minPax,
    hasVenda: totalGeralVenda > 0,
  };
}

// ============================================================
// Itens incluidos — visao clean da aba Proposta
// ============================================================
// Lista apenas os servicos que tem dados, com custo/venda/margem
// no tipo de apto de referencia (DBL para Grupo, SGL para Proposta).
// Fornecedores listados sao aqueles com algum valor preenchido.

export interface ItemIncluido {
  servico: string;        // 'TKT' | 'HTL' | ...
  label: string;          // 'Aéreo' | 'Hotel' | ...
  fornecedores: string[]; // nomes únicos com algum valor preenchido
  custo: number;          // custo no tipoBase (sem markup)
  venda: number;          // venda manual se preenchida; senão custo / markup
  margem: number;         // venda - custo
  margemPct: number;      // (margem/venda)*100
  detalhes: string;       // ex: "3 trechos", "2 hotéis"
  vendaManual: boolean;   // true se usuário definiu valor_venda_*
}

const SERVICO_LABEL: Record<string, string> = {
  TKT: 'Aéreo',
  HTL: 'Hotel',
  REC: 'Receptivo',
  CAR: 'Carro / Transporte',
  GUIA: 'Guia',
  SEG: 'Seguro',
  NAVIO: 'Cruzeiro',
  ING: 'Ingresso',
  BRINDE: 'Brinde',
  DIVULGACAO: 'Divulgação',
};

// Aplica markup aproximado quando nao ha venda manual (modelo legado).
// Reproduz a logica de calcProposta isoladamente para o servico.
function aplicarMargemAproximada(custo: number, markup: number): number {
  if (markup <= 0) return custo;
  return Number((custo / markup).toFixed(2));
}

export function calcItensIncluidos(g: GrupoViagem, tipoBase: string): ItemIncluido[] {
  const out: ItemIncluido[] = [];
  const c = g.cambio;
  const params = g.params;
  const cambio = (k: string) => c[k]?.valor || 1;
  const minPax = getPaxCount(g);
  const paxBase = PAX_MAP[tipoBase] || 1;
  const markup = params.markup || 0;

  // helper p/ extrair nomes únicos com algum valor preenchido
  const uniq = (arr: string[]) => Array.from(new Set(arr.filter(s => s && s.trim())));

  // TKT
  const tkt = calcTktTotals(g);
  if (tkt.totalAdt > 0 || tkt.totalChd > 0 || tkt.hasVenda) {
    const custo = tipoBase === 'chd'
      ? tkt.totalChd * cambio('tkt')
      : tkt.totalAdt * paxBase * cambio('tkt');
    const venda = tkt.hasVenda
      ? (tipoBase === 'chd' ? tkt.totalChdVenda : tkt.totalAdtVenda * paxBase)
      : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'TKT',
      label: SERVICO_LABEL.TKT,
      fornecedores: uniq(g.tkt.trechos.flatMap(t => t.fontes.filter(f => f.valor_adt || f.valor_chd || f.valor_venda_adt || f.valor_venda_chd).map(f => f.nome))),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: `${g.tkt.trechos.length} trecho${g.tkt.trechos.length > 1 ? 's' : ''}`,
      vendaManual: tkt.hasVenda,
    });
  }

  // HTL
  const htl = calcHtlTotals(g);
  const htlTotals = htl.totals as Record<string, number>;
  const htlTotalsVenda = htl.totalsVenda as Record<string, number>;
  const custoHtl = (htlTotals[tipoBase] || 0) * cambio('htl');
  const vendaHtlManual = htl.hasVenda ? (htlTotalsVenda[tipoBase] || 0) : 0;
  if (custoHtl > 0 || vendaHtlManual > 0) {
    const venda = htl.hasVenda ? vendaHtlManual : aplicarMargemAproximada(custoHtl, markup);
    out.push({
      servico: 'HTL',
      label: SERVICO_LABEL.HTL,
      fornecedores: uniq(g.htl.hoteis.flatMap(h => h.fontes.filter(f => f.valor_sgl || f.valor_dbl || f.valor_tpl || f.valor_qdp || f.valor_venda_sgl || f.valor_venda_dbl).map(f => f.nome))),
      custo: custoHtl, venda,
      margem: Math.max(venda - custoHtl, 0),
      margemPct: venda > 0 ? ((venda - custoHtl) / venda) * 100 : 0,
      detalhes: `${g.htl.hoteis.length} hotel/hotéis`,
      vendaManual: htl.hasVenda,
    });
  }

  // REC
  const rec = calcRecTotals(g);
  if (rec.totalAdt > 0 || rec.totalChd > 0 || rec.hasVenda) {
    const custo = tipoBase === 'chd'
      ? rec.totalChd * cambio('rec')
      : rec.totalAdt * paxBase * cambio('rec');
    const venda = rec.hasVenda
      ? (tipoBase === 'chd' ? rec.totalChdVenda : rec.totalAdtVenda * paxBase)
      : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'REC',
      label: SERVICO_LABEL.REC,
      fornecedores: uniq(g.rec.passeios.flatMap(p => p.fornecedores.filter(f => f.valor_adt || f.valor_chd || f.valor_venda_adt || f.valor_venda_chd).map(f => f.nome))),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: `${g.rec.passeios.length} passeio${g.rec.passeios.length > 1 ? 's' : ''}`,
      vendaManual: rec.hasVenda,
    });
  }

  // CAR
  const car = calcCarTotals(g);
  if (car.totalPorPax > 0 || car.hasVenda) {
    const custo = car.totalPorPax * paxBase * cambio('car');
    const venda = car.hasVenda
      ? car.totalPorPaxVenda * paxBase
      : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'CAR',
      label: SERVICO_LABEL.CAR,
      fornecedores: uniq(g.car.transportes.flatMap(t => t.empresas.filter(e => e.valor_veiculo || e.valor_venda_veiculo).map(e => e.nome))),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: `${g.car.transportes.length} transporte${g.car.transportes.length > 1 ? 's' : ''}`,
      vendaManual: car.hasVenda,
    });
  }

  // GUIA
  const guia = calcGuiaTotals(g);
  if (guia.totalPorPax > 0 || guia.hasVenda) {
    const custo = guia.totalPorPax * paxBase * cambio('guia');
    const venda = guia.hasVenda
      ? guia.totalPorPaxVenda * paxBase
      : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'GUIA',
      label: SERVICO_LABEL.GUIA,
      fornecedores: uniq(g.guia.destinos.flatMap(d => d.fornecedores.filter(f => f.valor_total || f.valor_venda_total).map(f => f.nome))),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: `${g.guia.destinos.length} destino${g.guia.destinos.length > 1 ? 's' : ''}`,
      vendaManual: guia.hasVenda,
    });
  }

  // SEG
  const seg = calcSegTotals(g);
  const segCustoTipo = tipoBase === 'chd' ? (seg['sgl'] || 0) : (seg[tipoBase] || 0);
  const segVendaTipo = tipoBase === 'chd' ? (seg.venda['sgl'] || 0) : (seg.venda[tipoBase] || 0);
  if (segCustoTipo > 0 || segVendaTipo > 0) {
    const custo = segCustoTipo * cambio('seg');
    const venda = seg.hasVenda ? segVendaTipo : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'SEG',
      label: SERVICO_LABEL.SEG,
      fornecedores: uniq(g.seg.seguradoras.filter(s => s.valor_sgl || s.valor_dbl || s.valor_venda_sgl || s.valor_venda_dbl).map(s => s.nome)),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: '',
      vendaManual: seg.hasVenda,
    });
  }

  // NAVIO
  const nav = calcNavioTotals(g);
  const navCustoTipo = nav[tipoBase] || 0;
  const navVendaTipo = nav.venda[tipoBase] || 0;
  if (navCustoTipo > 0 || navVendaTipo > 0) {
    const custo = navCustoTipo * cambio('navio');
    const venda = nav.hasVenda ? navVendaTipo : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'NAVIO',
      label: SERVICO_LABEL.NAVIO,
      fornecedores: uniq(g.navio.fornecedores.filter(f => f.valor_sgl || f.valor_dbl || f.valor_venda_sgl || f.valor_venda_dbl).map(f => f.nome)),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: g.navio_info.nome_cruzeiro || '',
      vendaManual: nav.hasVenda,
    });
  }

  // ING
  const ing = calcIngTotals(g);
  if (ing.totalAdt > 0 || ing.totalChd > 0 || ing.hasVenda) {
    const custo = tipoBase === 'chd'
      ? ing.totalChd * cambio('ing')
      : ing.totalAdt * paxBase * cambio('ing');
    const venda = ing.hasVenda
      ? (tipoBase === 'chd' ? ing.totalChdVenda : ing.totalAdtVenda * paxBase)
      : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'ING',
      label: SERVICO_LABEL.ING,
      fornecedores: uniq(g.ing.atrativos.flatMap(a => a.fontes.filter(f => f.valor_adt || f.valor_chd || f.valor_venda_adt || f.valor_venda_chd).map(f => f.nome))),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: `${g.ing.atrativos.length} atrativo${g.ing.atrativos.length > 1 ? 's' : ''}`,
      vendaManual: ing.hasVenda,
    });
  }

  // BRINDE
  const brinde = calcBrindeTotals(g);
  if (brinde.melhorPreco > 0 || brinde.hasVenda) {
    const custo = brinde.melhorPreco * paxBase * cambio('brinde');
    const venda = brinde.hasVenda
      ? brinde.melhorPrecoVenda * paxBase
      : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'BRINDE',
      label: SERVICO_LABEL.BRINDE,
      fornecedores: uniq(g.brinde.fornecedores.filter(f => f.valor_unidade || f.valor_venda_unidade).map(f => f.nome)),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: '',
      vendaManual: brinde.hasVenda,
    });
  }

  // DIVULGAÇÃO
  const div = calcDivulgacaoTotals(g);
  if (div.totalGeral > 0 || div.hasVenda) {
    const custo = div.totalPorPax * paxBase * cambio('divulgacao');
    const venda = div.hasVenda
      ? div.totalPorPaxVenda * paxBase
      : aplicarMargemAproximada(custo, markup);
    out.push({
      servico: 'DIVULGACAO',
      label: SERVICO_LABEL.DIVULGACAO,
      fornecedores: uniq(g.divulgacao.fornecedores.filter(f => f.valor_total || f.valor_venda_total).map(f => f.nome)),
      custo, venda,
      margem: Math.max(venda - custo, 0),
      margemPct: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
      detalhes: '',
      vendaManual: div.hasVenda,
    });
  }

  // helper p/ silenciar warnings de variável não usada — minPax usado em outras versões
  void minPax;

  return out;
}

// ============================================================
// Resumo por fornecedor — agrupa items vinculados a fornecedores
// (custo, venda e margem por fornecedor), para a aba Proposta.
// ============================================================
export interface ResumoFornecedor {
  fornecedor_id: string;    // id interno (vazio = nome livre sem cadastro)
  nome: string;
  servicos: string[];       // ['TKT', 'HTL', ...] onde aparece
  custo: number;
  venda: number;
  margem: number;
  margemPct: number;
}

export function calcResumoFornecedores(g: GrupoViagem, tipoBase: string): ResumoFornecedor[] {
  const PAX = PAX_MAP[tipoBase] || 1;
  const c = g.cambio;
  const cambio = (k: string) => c[k]?.valor || 1;

  // key = fornecedor_id || `nome::${nome}` para itens sem id
  type Bucket = { id: string; nome: string; custo: number; venda: number; servicos: Set<string> };
  const map = new Map<string, Bucket>();
  const ensure = (id: string, nome: string): Bucket => {
    const key = id || `nome::${nome.toLowerCase().trim()}`;
    let b = map.get(key);
    if (!b) {
      b = { id, nome, custo: 0, venda: 0, servicos: new Set() };
      map.set(key, b);
    }
    return b;
  };
  const accumulate = (id: string | undefined, nome: string, servico: string, custo: number, venda: number) => {
    if (!nome) return;
    if (custo <= 0 && venda <= 0) return;
    const b = ensure(id || '', nome);
    b.custo += custo;
    b.venda += venda;
    b.servicos.add(servico);
  };

  // TKT — melhor fonte por trecho (a que tem menor custo OU maior venda)
  for (const trecho of g.tkt?.trechos || []) {
    for (const f of trecho.fontes || []) {
      const custoAdt = Number(f.valor_adt) || 0;
      const vendaAdt = Number(f.valor_venda_adt) || 0;
      if (custoAdt === 0 && vendaAdt === 0) continue;
      accumulate(f.fornecedor_id, f.nome, 'TKT', custoAdt * PAX * cambio('tkt'), vendaAdt * PAX);
    }
  }
  // HTL — fonte tem preço por tipo de apto
  for (const hotel of g.htl?.hoteis || []) {
    for (const f of hotel.fontes || []) {
      const keyCusto = `valor_${tipoBase}` as keyof typeof f;
      const keyVenda = `valor_venda_${tipoBase}` as keyof typeof f;
      const custo = Number(f[keyCusto]) || 0;
      const venda = Number(f[keyVenda]) || 0;
      if (custo === 0 && venda === 0) continue;
      accumulate(f.fornecedor_id, f.nome, 'HTL', custo * cambio('htl'), venda);
    }
  }
  // REC
  for (const passeio of g.rec?.passeios || []) {
    for (const f of passeio.fornecedores || []) {
      const custo = Number(f.valor_adt) || 0;
      const venda = Number(f.valor_venda_adt) || 0;
      if (custo === 0 && venda === 0) continue;
      accumulate(f.fornecedor_id, f.nome, 'REC', custo * PAX * cambio('rec'), venda * PAX);
    }
  }
  // CAR
  const minPax = getPaxCount(g);
  for (const transp of g.car?.transportes || []) {
    for (const e of transp.empresas || []) {
      const custo = Number(e.valor_veiculo) || 0;
      const venda = Number(e.valor_venda_veiculo) || 0;
      if (custo === 0 && venda === 0) continue;
      accumulate(e.fornecedor_id, e.nome, 'CAR', (custo / minPax) * PAX * cambio('car'), (venda / minPax) * PAX);
    }
  }

  return Array.from(map.values()).map(b => {
    const custo = Number(b.custo.toFixed(2));
    const venda = Number(b.venda.toFixed(2));
    const margem = Math.max(venda - custo, 0);
    const margemPct = venda > 0 ? (margem / venda) * 100 : 0;
    return {
      fornecedor_id: b.id,
      nome: b.nome,
      servicos: Array.from(b.servicos),
      custo, venda, margem, margemPct,
    };
  }).sort((a, b) => b.venda - a.venda);
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

  // Serviços onde o usuario preencheu `valor_venda_*` — esses items
  // entram com o valor de venda manual e ficam fora do markup. A margem
  // ja esta embutida em (venda - custo) por linha.
  const usaVenda = new Set<string>();
  if (tkt.hasVenda) usaVenda.add('TKT');
  if (htl.hasVenda) usaVenda.add('HTL');
  if (rec.hasVenda) usaVenda.add('REC');
  if (car.hasVenda) usaVenda.add('CAR');
  if (guia.hasVenda) usaVenda.add('GUIA');
  if (seg.hasVenda) usaVenda.add('SEG');
  if (nav.hasVenda) usaVenda.add('NAVIO');
  if (ing.hasVenda) usaVenda.add('ING');
  if (brinde.hasVenda) usaVenda.add('BRINDE');
  if (divulgacao.hasVenda) usaVenda.add('DIVULGACAO');

  // TKT
  lineValues['TKT'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('TKT')) {
      if (tipo === 'chd') lineValues['TKT'][tipo] = tkt.totalChdVenda * 1;
      else lineValues['TKT'][tipo] = tkt.totalAdtVenda * PAX_MAP[tipo];
    } else if (tipo === 'chd') {
      lineValues['TKT'][tipo] = tkt.totalChd * 1 * getCambio('tkt');
    } else {
      lineValues['TKT'][tipo] = tkt.totalAdt * PAX_MAP[tipo] * getCambio('tkt');
    }
  }

  // HTL (already per room, no pax multiply)
  lineValues['HTL'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('HTL')) {
      lineValues['HTL'][tipo] = htl.totalsVenda[tipo] || 0;
    } else {
      lineValues['HTL'][tipo] = (htl.totals[tipo] || 0) * getCambio('htl');
    }
  }

  // REC
  lineValues['REC'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('REC')) {
      if (tipo === 'chd') lineValues['REC'][tipo] = rec.totalChdVenda * 1;
      else lineValues['REC'][tipo] = rec.totalAdtVenda * PAX_MAP[tipo];
    } else if (tipo === 'chd') {
      lineValues['REC'][tipo] = rec.totalChd * 1 * getCambio('rec');
    } else {
      lineValues['REC'][tipo] = rec.totalAdt * PAX_MAP[tipo] * getCambio('rec');
    }
  }

  // CAR
  lineValues['CAR'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('CAR')) {
      lineValues['CAR'][tipo] = car.totalPorPaxVenda * PAX_MAP[tipo];
    } else {
      lineValues['CAR'][tipo] = car.totalPorPax * PAX_MAP[tipo] * getCambio('car');
    }
  }

  // GUIA
  lineValues['GUIA'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('GUIA')) {
      lineValues['GUIA'][tipo] = guia.totalPorPaxVenda * PAX_MAP[tipo];
    } else {
      lineValues['GUIA'][tipo] = guia.totalPorPax * PAX_MAP[tipo] * getCambio('guia');
    }
  }

  // SEG (already per room, no pax multiply)
  lineValues['SEG'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('SEG')) {
      if (tipo === 'chd') lineValues['SEG'][tipo] = seg.venda['sgl'] || 0;
      else lineValues['SEG'][tipo] = seg.venda[tipo] || 0;
    } else if (tipo === 'chd') {
      lineValues['SEG'][tipo] = (seg['sgl'] || 0) * getCambio('seg');
    } else {
      lineValues['SEG'][tipo] = (seg[tipo] || 0) * getCambio('seg');
    }
  }

  // NAVIO (already per cabin)
  lineValues['NAVIO'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('NAVIO')) {
      lineValues['NAVIO'][tipo] = nav.venda[tipo] || 0;
    } else {
      lineValues['NAVIO'][tipo] = (nav[tipo] || 0) * getCambio('navio');
    }
  }

  // ING
  lineValues['ING'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('ING')) {
      if (tipo === 'chd') lineValues['ING'][tipo] = ing.totalChdVenda * 1;
      else lineValues['ING'][tipo] = ing.totalAdtVenda * PAX_MAP[tipo];
    } else if (tipo === 'chd') {
      lineValues['ING'][tipo] = ing.totalChd * 1 * getCambio('ing');
    } else {
      lineValues['ING'][tipo] = ing.totalAdt * PAX_MAP[tipo] * getCambio('ing');
    }
  }

  // BRINDE
  lineValues['BRINDE'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('BRINDE')) {
      lineValues['BRINDE'][tipo] = brinde.melhorPrecoVenda * PAX_MAP[tipo];
    } else {
      lineValues['BRINDE'][tipo] = brinde.melhorPreco * PAX_MAP[tipo] * getCambio('brinde');
    }
  }

  // DIVULGAÇÃO (custo total rateado por pax, depois multiplicado pelo nº de pax do apto)
  lineValues['DIVULGACAO'] = {};
  for (const tipo of TIPOS) {
    if (usaVenda.has('DIVULGACAO')) {
      lineValues['DIVULGACAO'][tipo] = divulgacao.totalPorPaxVenda * PAX_MAP[tipo];
    } else {
      lineValues['DIVULGACAO'][tipo] = divulgacao.totalPorPax * PAX_MAP[tipo] * getCambio('divulgacao');
    }
  }

  // CORTESIA — rateia o custo dos cortesias entre os pagantes
  lineValues['CORTESIA'] = {};
  const serviceKeys = ['TKT', 'HTL', 'REC', 'CAR', 'GUIA', 'SEG', 'NAVIO', 'ING', 'BRINDE', 'DIVULGACAO'];
  const pagantes = Math.max(getPaxCount(g) - (p.cortesia || 0), 1);
  for (const tipo of TIPOS) {
    const soma = serviceKeys.reduce((acc, k) => acc + (lineValues[k]?.[tipo] || 0), 0);
    lineValues['CORTESIA'][tipo] = (soma / pagantes) * p.cortesia;
  }

  // CONTRATO
  lineValues['CONTRATO'] = {};
  for (const tipo of TIPOS) {
    lineValues['CONTRATO'][tipo] = p.contrato;
  }

  // MARKUP (divisor, only on specific items). Servicos com venda manual
  // ja tem margem embutida no lineValues — ficam fora do markup.
  lineValues['MARKUP'] = {};
  const markupItems = ['TKT', 'HTL', 'ING', 'REC', 'SEG', 'CAR', 'BRINDE', 'DIVULGACAO']
    .filter(k => !usaVenda.has(k));
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

  const r2 = (v: number) => Math.round(v * 100) / 100;

  for (const tipo of TIPOS) {
    const soma = allLineKeys.reduce((acc, k) => acc + (lineValues[k]?.[tipo] || 0), 0);
    totalAvista[tipo] = r2(soma);
    // tx_ad_mp = 0 (novo modelo simples) → cartão = à vista, sem multiplicador.
    // > 0 → divide pelo coeficiente (modelo legado).
    totalCartao[tipo] = r2(p.tx_ad_mp > 0 ? soma / p.tx_ad_mp : soma);
    // tx_boleto = 0 → boleto = à vista; > 0 → adiciona taxa por parcela.
    totalBoleto[tipo] = r2(soma + (p.tx_boleto * p.parcelas));
    parcelaAptoCC[tipo] = r2(p.parcelas > 0 ? totalCartao[tipo] / p.parcelas : 0);
    parcelaAptoBoleto[tipo] = r2(p.parcelas > 0 ? totalBoleto[tipo] / p.parcelas : 0);

    const pax = PAX_MAP[tipo];
    totalPaxAvista[tipo] = r2(totalAvista[tipo] / pax);
    totalPaxCartao[tipo] = r2(totalCartao[tipo] / pax);
    totalPaxBoleto[tipo] = r2(totalBoleto[tipo] / pax);
    parcelaPaxCC[tipo] = r2(p.parcelas > 0 ? totalPaxCartao[tipo] / p.parcelas : 0);
    parcelaPaxBoleto[tipo] = r2(p.parcelas > 0 ? totalPaxBoleto[tipo] / p.parcelas : 0);
  }

  return {
    lines, totalAvista, totalCartao, totalBoleto,
    parcelaAptoCC, parcelaAptoBoleto,
    totalPaxAvista, totalPaxCartao, totalPaxBoleto,
    parcelaPaxCC, parcelaPaxBoleto,
  };
}
