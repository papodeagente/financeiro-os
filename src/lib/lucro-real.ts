/**
 * LUCRO REAL: faturamento, comissão e lucro separados, por mês e por venda.
 *
 * Pedido do Bruno (01/10/2026): "a comissão deve aparecer e no final chegar
 * no valor que realmente fica e %. A conta do número de vendas também é
 * necessária e é dinâmica: quanto mais venda faz, menor o custo rateado por
 * venda. Um relatório que me permita entender QUANDO eu realmente lucrei, e
 * por venda, quanto aproximadamente lucra uma venda."
 *
 * A ESCADA. Três números que a agência confunde, cada um com dono diferente:
 *
 *   FATURAMENTO  o que o cliente pagou. A maior parte é do fornecedor.
 *   COMISSÃO     o que ficou da agência depois do fornecedor.
 *   LUCRO        o que sobra da comissão depois do vendedor, da plataforma,
 *                do imposto e da fatia do custo fixo do mês.
 *
 * A REGRA DO RATEIO (decisão do Bruno): o custo fixo do mês é repartido entre
 * as vendas na PROPORÇÃO DO FATURAMENTO de cada uma. Uma venda de R$ 20.000
 * carrega o dobro do fixo de uma de R$ 10.000. É uma convenção, não uma
 * verdade contábil — e é por isso que o lucro POR VENDA é "aproximado" e o
 * lucro DO MÊS é exato: o fixo inteiro só existe no mês.
 *
 * O QUE É DINÂMICO. O fixo é o mesmo com 10 ou com 30 vendas. Então cada
 * venda nova dilui o fixo das anteriores, e o lucro por venda sobe sem
 * ninguém vender melhor. Num mês aberto o rateio é provisório: a venda de
 * hoje carrega um fixo maior do que vai carregar no dia 30.
 *
 * O INVARIANTE que o módulo garante, e o teste cobra: a soma dos lucros das
 * vendas é igual ao lucro do mês. Nada é contado duas vezes e nada escapa.
 * Rateio que não fecha no centavo é a primeira coisa que um contador acha.
 *
 * Só cálculo: nada de banco, nada de rede.
 */
import type { ComissaoVenda, ContaPagar, ContaReceber, PlanoContas, VendaCRM } from './crm-types';
import { divSegura, mesDe, num, ratearTotal, round2, soma, somaPor } from './money';

export interface EntradasDoMes {
  /** 'YYYY-MM'. */
  mes: string;
  /** Hoje, ISO. Decide se o mês está aberto. */
  hoje: string;
  /** Vendas COM lastro (ver venda-lancamentos.ts); as canceladas são descartadas aqui. */
  vendas: VendaCRM[];
  contasReceber: ContaReceber[];
  contasPagar: ContaPagar[];
  planoContas: PlanoContas[];
  /** A comissão do vendedor por venda, já calculada pela escala. */
  comissoes: ComissaoVenda[];
  /**
   * Alíquota de ISS da configuração fiscal, em %. Só entra quando o mês não
   * tem imposto lançado — e aí o número vira estimativa, avisada na tela.
   */
  aliquotaIssConfig?: number | null;
}

export interface EscadaDaVenda {
  venda_id: string;
  numero: string;
  data: string;
  cliente_id: string;
  vendedor_id: string;
  vendedor_nome: string;
  /** Primeiro produto da venda, para a linha ter nome. */
  descricao: string;

  faturamento: number;
  fornecedores: number;
  comissao: number;
  comissao_pct: number;

  comissao_vendedor: number;
  taxa_plataforma: number;
  impostos: number;
  /** O que a venda deixa para pagar o fixo. */
  contribuicao: number;
  custo_fixo_rateado: number;

  lucro: number;
  /** Sobre o faturamento: é o número que o dono compara com "quanto vendi". */
  lucro_pct: number;
  avisos: string[];
}

export interface PontoDeEquilibrio {
  atingido: boolean;
  /** Ordinal da venda que cruzou o fixo (1 = primeira do mês). */
  na_venda: number | null;
  data: string | null;
  /** Quanto ainda falta de contribuição para cobrir o fixo. */
  faltam: number;
  /** Com a contribuição média do mês, quantas vendas pagam o fixo. */
  vendas_necessarias: number | null;
}

export interface CenarioDeDiluicao {
  vendas: number;
  custo_fixo_por_venda: number;
  lucro_por_venda: number;
  lucro_do_mes: number;
}

export interface EscadaDoMes {
  mes: string;
  aberto: boolean;
  n_vendas: number;

  faturamento: number;
  fornecedores: number;
  comissao: number;
  comissao_pct: number;
  comissao_vendedor: number;
  taxa_plataforma: number;
  impostos: number;
  impostos_estimados: boolean;
  custo_fixo: number;
  custo_fixo_por_venda: number;
  /** Comissão menos o que varia com a venda: o que sobra para o fixo. */
  contribuicao: number;
  contribuicao_media: number;

  lucro: number;
  lucro_pct: number;

  equilibrio: PontoDeEquilibrio;
  diluicao: CenarioDeDiluicao[];
  /** Contribuição acumulada por dia, para desenhar o cruzamento. */
  acumulado: Array<{ data: string; rotulo: string; valor: number; detalhe: string }>;
  vendas: EscadaDaVenda[];
  avisos: string[];
}

const vivo = (s: unknown) => String(s ?? '') !== 'CANCELADO';

/**
 * Quem é custo FIXO do mês: tudo que a agência paga e não nasce de uma venda
 * específica. Mesma régua do DRE (prefixos do plano de contas), com duas
 * exclusões que o DRE também faz:
 *
 *  - o repasse ao fornecedor gerado pela venda (`auto_gerado` + VENDA) não é
 *    despesa da agência; é dinheiro do cliente a caminho do fornecedor;
 *  - imposto sobre a receita (2.3) NÃO é fixo: ele cresce com a comissão, e
 *    por isso é rateado à parte, por comissão, não por faturamento.
 *
 * E uma exclusão própria: conta a pagar que seja comissão de vendedor. Hoje
 * ela não existe como conta (a comissão vive na entidade `comissoes`), mas
 * se um dia passar a existir, entraria aqui E na linha do vendedor — contada
 * duas vezes. A guarda custa uma linha e evita o pior erro deste relatório.
 */
export function custoFixoDoMes(
  contasPagar: ContaPagar[],
  planoContas: PlanoContas[],
  mes: string,
): { total: number; impostos: number } {
  const doMes = contasPagar.filter(cp => mesDe(cp.data_vencimento) === mes && vivo(cp.status));
  const ehRepasse = (cp: ContaPagar) => !!cp.auto_gerado && cp.origem === 'VENDA';
  const ehComissaoDeVendedor = (cp: ContaPagar) =>
    /comiss[aã]o/i.test(String((cp as any).descricao ?? '')) && !ehRepasse(cp);

  const idsDoPrefixo = (prefixo: string) =>
    new Set(planoContas.filter(p => String(p.codigo ?? '').startsWith(prefixo)).map(p => p.id));
  const idsImposto = idsDoPrefixo('2.3');

  const impostos = somaPor(doMes.filter(cp => idsImposto.has(cp.categoria_id)), cp => cp.valor_final);
  const total = somaPor(
    doMes.filter(cp => !idsImposto.has(cp.categoria_id) && !ehRepasse(cp) && !ehComissaoDeVendedor(cp)),
    cp => cp.valor_final,
  );
  return { total: round2(total), impostos: round2(impostos) };
}

/** A taxa que a plataforma reteve nas parcelas desta venda. */
function taxaDaVenda(vendaId: string, contasReceber: ContaReceber[]): number {
  return somaPor(
    contasReceber.filter(cr =>
      vivo(cr.status) && (cr.origem_venda_id === vendaId || cr.venda_id === vendaId)),
    cr => Math.max(0, num(cr.taxa)),
  );
}

function descricaoDaVenda(v: VendaCRM): string {
  const p = (v.produtos ?? [])[0] as any;
  const texto = String(p?.descricao ?? p?.hotel_nome ?? '').trim();
  return texto || `Venda ${v.numero ?? ''}`.trim();
}

/**
 * Os cenários de diluição: o mesmo fixo repartido por mais vendas.
 *
 * Responde "quanto mais venda faz, menor o custo rateado por venda" com
 * números, não com adjetivo. A contribuição média do mês é mantida — é a
 * premissa honesta: as vendas a mais seriam parecidas com as que já houve.
 */
export function cenariosDeDiluicao(
  custoFixo: number,
  nAtual: number,
  contribuicaoMedia: number,
): CenarioDeDiluicao[] {
  const base = Math.max(1, nAtual);
  const candidatos = [base, base + 5, base + 10, base * 2, base * 3];
  const vistos = new Set<number>();
  const saida: CenarioDeDiluicao[] = [];
  for (const n of candidatos) {
    if (vistos.has(n)) continue;
    vistos.add(n);
    const fixoPorVenda = round2(divSegura(custoFixo, n));
    saida.push({
      vendas: n,
      custo_fixo_por_venda: fixoPorVenda,
      lucro_por_venda: round2(contribuicaoMedia - fixoPorVenda),
      lucro_do_mes: round2(contribuicaoMedia * n - custoFixo),
    });
  }
  // Em ordem crescente de vendas: a tabela é lida de cima para baixo como
  // "e se eu vendesse mais", e a queda do fixo por venda precisa ser visível
  // linha a linha, não espalhada.
  return saida.sort((a, b) => a.vendas - b.vendas);
}

export function escadaDoMes(e: EntradasDoMes): EscadaDoMes {
  const avisos: string[] = [];
  const aberto = mesDe(e.hoje) === e.mes;

  const vendas = e.vendas
    .filter(v => mesDe(v.data_venda) === e.mes && vivo(v.status))
    .sort((a, b) => String(a.data_venda).localeCompare(String(b.data_venda)) || String(a.numero).localeCompare(String(b.numero)));

  const { total: custoFixo, impostos: impostosLancados } = custoFixoDoMes(e.contasPagar, e.planoContas, e.mes);

  // Comissão do vendedor por venda: a que a escala já calculou.
  const comissaoPorVenda = new Map<string, { valor: number; nome: string }>();
  for (const c of e.comissoes) {
    if (c.status === 'CANCELADA') continue;
    const atual = comissaoPorVenda.get(c.venda_id);
    comissaoPorVenda.set(c.venda_id, {
      valor: round2((atual?.valor ?? 0) + num(c.valor_comissao)),
      nome: c.vendedor_nome || atual?.nome || '',
    });
  }

  // ── Primeiro passo: o que cada venda tem de PRÓPRIO ────────────────────
  const parciais = vendas.map(v => {
    const faturamento = round2(Math.max(0, num(v.valor_final)));
    const fornecedores = round2(Math.min(faturamento, Math.max(0, num(v.valor_total_custo))));
    const comissao = round2(faturamento - fornecedores);
    const cv = comissaoPorVenda.get(v.id);
    return {
      v, faturamento, fornecedores, comissao,
      comissao_vendedor: cv?.valor ?? 0,
      vendedor_nome: cv?.nome ?? '',
      taxa_plataforma: taxaDaVenda(v.id, e.contasReceber),
      avisos: cv ? [] : ['Sem comissão de vendedor registrada'],
    };
  });

  const faturamento = round2(somaPor(parciais, p => p.faturamento));
  const comissao = round2(somaPor(parciais, p => p.comissao));

  // ── Impostos: o lançado, rateado por comissão; sem lançamento, estimativa ─
  let impostos = impostosLancados;
  let impostosEstimados = false;
  let impostosPorVenda: number[];
  if (impostosLancados > 0) {
    impostosPorVenda = ratearTotal(impostosLancados, parciais.map(p => p.comissao));
  } else {
    const aliq = Math.max(0, num(e.aliquotaIssConfig));
    impostosPorVenda = parciais.map(p => round2(p.comissao * aliq / 100));
    impostos = round2(soma(impostosPorVenda));
    impostosEstimados = aliq > 0 && impostos > 0;
    if (impostosEstimados) avisos.push(`Imposto estimado pela alíquota de ISS configurada (${aliq}%): nenhum imposto lançado no mês.`);
  }

  // ── Custo fixo: rateado por FATURAMENTO (decisão do Bruno) ──────────────
  const pesos = parciais.map(p => p.faturamento);
  const temPeso = pesos.some(p => p > 0);
  // Sem venda, o fixo não tem onde cair: fica no mês, e o lucro do mês é −fixo.
  const fixoPorVenda = temPeso ? ratearTotal(custoFixo, pesos) : parciais.map(() => 0);
  if (!temPeso && custoFixo > 0) avisos.push('Sem venda no mês: o custo fixo inteiro é prejuízo.');

  const escadas: EscadaDaVenda[] = parciais.map((p, i) => {
    const contribuicao = round2(p.comissao - p.comissao_vendedor - p.taxa_plataforma - impostosPorVenda[i]);
    const lucro = round2(contribuicao - fixoPorVenda[i]);
    const avisosDaVenda = [...p.avisos];
    if (impostosEstimados && impostosPorVenda[i] > 0) avisosDaVenda.push('Imposto estimado');
    return {
      venda_id: p.v.id,
      numero: String(p.v.numero ?? ''),
      data: String(p.v.data_venda ?? '').slice(0, 10),
      cliente_id: String(p.v.cliente_id ?? ''),
      vendedor_id: String(p.v.vendedor_id ?? ''),
      vendedor_nome: p.vendedor_nome,
      descricao: descricaoDaVenda(p.v),
      faturamento: p.faturamento,
      fornecedores: p.fornecedores,
      comissao: p.comissao,
      comissao_pct: round2(divSegura(p.comissao, p.faturamento) * 100),
      comissao_vendedor: p.comissao_vendedor,
      taxa_plataforma: p.taxa_plataforma,
      impostos: impostosPorVenda[i],
      contribuicao,
      custo_fixo_rateado: fixoPorVenda[i],
      lucro,
      lucro_pct: round2(divSegura(lucro, p.faturamento) * 100),
      avisos: avisosDaVenda,
    };
  });

  const comissaoVendedor = round2(somaPor(escadas, s => s.comissao_vendedor));
  const taxaPlataforma = round2(somaPor(escadas, s => s.taxa_plataforma));
  const contribuicao = round2(comissao - comissaoVendedor - taxaPlataforma - impostos);
  const lucro = round2(contribuicao - custoFixo);
  const n = escadas.length;
  const contribuicaoMedia = round2(divSegura(contribuicao, n));

  // ── Quando eu realmente lucrei: a venda em que o acumulado cobriu o fixo ─
  let acumuladoValor = 0;
  let cruzou: { ordinal: number; data: string } | null = null;
  const acumulado = escadas.map((s, i) => {
    acumuladoValor = round2(acumuladoValor + s.contribuicao);
    if (!cruzou && custoFixo > 0 && acumuladoValor >= custoFixo) cruzou = { ordinal: i + 1, data: s.data };
    return {
      data: s.data,
      rotulo: s.descricao,
      valor: s.contribuicao,
      detalhe: `${s.numero ? `Venda ${s.numero} · ` : ''}contribuição ${s.contribuicao >= 0 ? '+' : ''}${s.contribuicao.toFixed(2)}`,
    };
  });
  const equilibrio: PontoDeEquilibrio = {
    atingido: custoFixo <= 0 ? n > 0 : cruzou !== null,
    na_venda: cruzou ? (cruzou as { ordinal: number }).ordinal : null,
    data: cruzou ? (cruzou as { data: string }).data : null,
    faltam: round2(Math.max(0, custoFixo - contribuicao)),
    vendas_necessarias: contribuicaoMedia > 0 ? Math.ceil(divSegura(custoFixo, contribuicaoMedia)) : null,
  };

  if (aberto) avisos.push('Mês aberto: cada venda nova dilui o custo fixo das anteriores. O lucro por venda ainda vai subir.');

  return {
    mes: e.mes,
    aberto,
    n_vendas: n,
    faturamento,
    fornecedores: round2(somaPor(escadas, s => s.fornecedores)),
    comissao,
    comissao_pct: round2(divSegura(comissao, faturamento) * 100),
    comissao_vendedor: comissaoVendedor,
    taxa_plataforma: taxaPlataforma,
    impostos,
    impostos_estimados: impostosEstimados,
    custo_fixo: custoFixo,
    custo_fixo_por_venda: round2(divSegura(custoFixo, n)),
    contribuicao,
    contribuicao_media: contribuicaoMedia,
    lucro,
    lucro_pct: round2(divSegura(lucro, faturamento) * 100),
    equilibrio,
    diluicao: cenariosDeDiluicao(custoFixo, n, contribuicaoMedia),
    acumulado,
    vendas: escadas,
    avisos,
  };
}
