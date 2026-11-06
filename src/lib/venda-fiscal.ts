/**
 * Notas e retenção na fonte da venda, como a ficha mostra (E7, 06/11/2026).
 * Puro: o servidor (./venda-fiscal-servidor.ts) lê as notas e as contas.
 *
 *   · notas: todas as da venda (as da regra e as por conta), da mais nova
 *     para a mais antiga, com a situação em palavras e o tom do selo;
 *   · retenção: a de cada conta a receber que saiu líquida
 *     (`retencao_na_fonte` gravado pela parte E: valores em reais), com o
 *     total por tributo.
 */

export type TomFiscal = 'positivo' | 'aviso' | 'negativo' | 'neutro';

export interface NotaNaFicha {
  id: string;
  numero: string;
  situacao: string;
  rotulo: string;
  tom: TomFiscal;
  valor_servicos: number;
  tomador: string;
  /** AAAA-MM-DD: autorizada, emitida ou criada (nesta ordem). */
  data: string;
  link_pdf: string;
  erro: string;
  /** Nota registrada à mão (emitida fora do sistema). */
  externa: boolean;
}

export interface RetencaoNaFicha {
  conta_id: string;
  descricao: string;
  pagante: string;
  valor_bruto: number;
  total: number;
  liquido: number;
  IR: number;
  CSLL: number;
  PIS: number;
  COFINS: number;
}

export interface FiscalDaVenda {
  notas: NotaNaFicha[];
  retencoes: RetencaoNaFicha[];
  totais: {
    /** Soma do valor de serviço das notas autorizadas. */
    autorizado: number;
    /** Soma do que está na prefeitura ou em rascunho. */
    em_andamento: number;
    retido: number;
    IR: number;
    CSLL: number;
    PIS: number;
    COFINS: number;
  };
}

const SITUACAO: Record<string, { rotulo: string; tom: TomFiscal }> = {
  RASCUNHO: { rotulo: 'Em rascunho', tom: 'neutro' },
  PROCESSANDO: { rotulo: 'Na prefeitura', tom: 'aviso' },
  AUTORIZADA: { rotulo: 'Autorizada', tom: 'positivo' },
  REJEITADA: { rotulo: 'Recusada', tom: 'negativo' },
  CANCELADA: { rotulo: 'Cancelada', tom: 'neutro' },
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dia = (v: unknown) => txt(v).slice(0, 10);

/** Uma linha de `notas_fiscais` (status da coluna; o resto em `data`). */
export function notaNaFicha(linha: { id: string; status: string; data: Record<string, unknown>; criado_em?: string }): NotaNaFicha {
  const d = linha.data ?? {};
  const st = (txt(linha.status) || txt(d.status) || 'RASCUNHO').toUpperCase();
  const s = SITUACAO[st] ?? { rotulo: st.charAt(0) + st.slice(1).toLowerCase(), tom: 'neutro' as TomFiscal };
  const tomador = d.tomador && typeof d.tomador === 'object' ? d.tomador as Record<string, unknown> : {};
  return {
    id: linha.id,
    numero: txt(d.numero),
    situacao: st,
    rotulo: s.rotulo,
    tom: s.tom,
    valor_servicos: r2(num(d.valor_servicos)),
    tomador: txt(tomador.razao_social || tomador.nome),
    data: dia(d.autorizada_em) || dia(d.emitida_em) || dia(linha.criado_em),
    link_pdf: /^https?:\/\//i.test(txt(d.link_pdf)) ? txt(d.link_pdf) : '',
    erro: st === 'REJEITADA' ? txt(d.erro).slice(0, 300) : '',
    externa: Boolean(d.emitida_fora || d.registrada_manualmente || d.externa),
  };
}

/** A retenção gravada numa conta a receber (null quando a conta não tem). */
export function retencaoNaFicha(c: Record<string, unknown>): RetencaoNaFicha | null {
  const r = c.retencao_na_fonte;
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const total = r2(num(o.total));
  if (!(total > 0)) return null;
  const bruto = r2(num(o.valor_bruto));
  return {
    conta_id: txt(c.id),
    descricao: txt(c.descricao),
    pagante: txt(c.cliente_nome),
    valor_bruto: bruto,
    total,
    liquido: r2(bruto - total),
    IR: r2(num(o.IR)), CSLL: r2(num(o.CSLL)), PIS: r2(num(o.PIS)), COFINS: r2(num(o.COFINS)),
  };
}

export function resumoFiscalDaVenda(
  notas: ReadonlyArray<{ id: string; status: string; data: Record<string, unknown>; criado_em?: string }>,
  contasReceber: ReadonlyArray<Record<string, unknown>>,
): FiscalDaVenda {
  const lista = notas.map(notaNaFicha).sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id));
  const retencoes = contasReceber
    .filter(c => txt(c.status).toUpperCase() !== 'CANCELADO' || (c.na_fatura && typeof c.na_fatura === 'object'))
    .map(retencaoNaFicha)
    .filter((x): x is RetencaoNaFicha => x !== null);
  const soma = (k: keyof Pick<RetencaoNaFicha, 'total' | 'IR' | 'CSLL' | 'PIS' | 'COFINS'>) => r2(retencoes.reduce((s, r) => s + r[k], 0));
  return {
    notas: lista,
    retencoes,
    totais: {
      autorizado: r2(lista.filter(n => n.situacao === 'AUTORIZADA').reduce((s, n) => s + n.valor_servicos, 0)),
      em_andamento: r2(lista.filter(n => n.situacao === 'PROCESSANDO' || n.situacao === 'RASCUNHO').reduce((s, n) => s + n.valor_servicos, 0)),
      retido: soma('total'), IR: soma('IR'), CSLL: soma('CSLL'), PIS: soma('PIS'), COFINS: soma('COFINS'),
    },
  };
}
