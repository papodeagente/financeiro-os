/**
 * COMISSÃO POR MRR (Bruno, 04/11/2026), só na conta da Entur (perfil
 * "ecossistema", perfil-da-conta.ts).
 *
 * "Organizar o comissionamento por MRR. Criar meta de MRR. Vincular produtos
 * do CRM a metas dentro do financeiro." Decisões do mesmo dia:
 *  - produtos: os do Entur OS (planos, adicionais, programas), pela chave que
 *    o CRM manda (`plano:essencial`, `adicional:whatsapp_number`);
 *  - o que conta: o MRR NOVO vendido no mês (contas novas e reativadas);
 *  - o anual entra dividido por 12 (o CRM já manda assim);
 *  - a comissão é por FAIXAS do quanto a meta foi batida, sobre o MRR vendido;
 *  - SUBSTITUI a comissão sobre todo pagamento recebido que o CRM calculava.
 *
 * O MODELO
 *  - Meta de MRR (tabela metas_mrr): do mês, com um nome, os produtos
 *    vinculados e o valor de cada vendedor. Um produto vale para UMA meta do
 *    mês só: em duas, a mesma venda pagaria duas vezes.
 *  - Faixas no plano de comissão (`mrr.faixas`): "até X% da meta paga Y% do
 *    MRR vendido". A faixa é escolhida pelo percentual atingido e vale para o
 *    MRR inteiro daquela meta (como a escada do mês dos outros planos).
 *    Acima da última faixa, vale a última.
 *  - A comissão do mês do vendedor vira UMA linha em `comissoes`
 *    (`comissao-mrr-<vendedor>-<AAAA-MM>`, origem 'mrr'), com a conta a pagar
 *    pelo mesmo gancho de toda comissão.
 *
 * O QUE NUNCA SE PRESUME
 *  - Vendedor sem meta naquela meta: não há percentual atingido, então não há
 *    faixa. Fica pendente, com o MRR à vista, até alguém pôr a meta.
 *  - Vendedor sem plano, ou com plano sem faixas de MRR: pendente.
 *  - Venda sem vendedor no CRM (negociação não ligada): à vista, sem comissão.
 *  - Produto vendido que não está em meta nenhuma: à vista, sem comissão.
 *
 * Só cálculo: nada de banco, nada de rede, nada de relógio.
 */
import { round2 } from './money';
import type { ItemVendido, VendaMrr } from './mrr-vendido';

export interface FaixaDaMeta {
  /** Até quanto da meta (em %) a faixa vale; null = sem teto. */
  ate_pct: number | null;
  /** Percentual pago sobre o MRR vendido da meta. */
  percentual: number;
}

export interface MetaMrr {
  id: string;
  mes: string;
  nome: string;
  /** Chaves dos produtos do CRM que contam para esta meta. */
  produtos: string[];
  /** Nome de cada produto vinculado, para a tela não depender do CRM no ar. */
  produtos_nomes: Record<string, string>;
  /** Meta de MRR de cada vendedor (id do usuário do financeiro), em reais. */
  valores: Record<string, number>;
}

export interface VendedorDoFinanceiro {
  id: string;
  nome: string;
  email: string;
  external_id: string;
  plano_comissao_id: string;
}

export interface PlanoComFaixasDeMrr {
  id: string;
  nome: string;
  ativo: boolean;
  base_calculo?: string;
  mrr?: { faixas?: unknown } | null;
}

// ============================================================
// Faixas
// ============================================================

/**
 * As faixas como o plano guarda, limpas e em ordem. Faixa com percentual
 * quebrado sai; teto repetido fica só a primeira; a sem teto vai para o fim.
 */
export function normalizarFaixas(bruto: unknown): FaixaDaMeta[] {
  if (!Array.isArray(bruto)) return [];
  const limpas: FaixaDaMeta[] = [];
  for (const f of bruto) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const percentual = Number(r.percentual);
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 1000) continue;
    const ate = r.ate_pct === null || r.ate_pct === undefined || r.ate_pct === '' ? null : Number(r.ate_pct);
    if (ate !== null && (!Number.isFinite(ate) || ate <= 0)) continue;
    limpas.push({ ate_pct: ate === null ? null : round2(ate), percentual: round2(percentual) });
  }
  limpas.sort((a, b) => (a.ate_pct ?? Infinity) - (b.ate_pct ?? Infinity));
  const vistas = new Set<string>();
  return limpas.filter(f => {
    const k = String(f.ate_pct);
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

/** O que está errado nas faixas que a pessoa preencheu, ou null. */
export function validarFaixas(bruto: unknown): string | null {
  if (!Array.isArray(bruto) || bruto.length === 0) return null; // sem faixas é permitido: o plano só não paga MRR
  const limpas = normalizarFaixas(bruto);
  if (limpas.length !== bruto.length) return 'Cada faixa precisa de um percentual entre 0 e 1000 e de um teto maior que zero, sem teto repetido.';
  if (limpas.filter(f => f.ate_pct === null).length > 1) return 'Só a última faixa pode ficar sem teto.';
  return null;
}

/** A faixa do percentual atingido. Acima da última, vale a última. */
export function faixaPelaMeta(faixas: readonly FaixaDaMeta[], pct: number): FaixaDaMeta | null {
  if (!faixas.length || !Number.isFinite(pct)) return null;
  for (const f of faixas) if (f.ate_pct === null || pct <= f.ate_pct + 1e-9) return f;
  return faixas[faixas.length - 1];
}

/** As faixas em palavras: "até 70%: 20% · até 100%: 40% · acima: 60%". */
export function faixasEmPalavras(faixas: readonly FaixaDaMeta[]): string {
  const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return faixas.map((f, i) => {
    const anterior = i > 0 ? faixas[i - 1].ate_pct : null;
    const limite = f.ate_pct === null ? (anterior === null ? 'qualquer resultado' : `acima de ${num(anterior)}%`) : `até ${num(f.ate_pct)}%`;
    return `${limite} da meta: ${num(f.percentual)}% do MRR`;
  }).join(' · ');
}

// ============================================================
// Metas
// ============================================================

/** O que impede gravar a meta, ou null. `outras` são as outras metas do mesmo mês. */
export function validarMeta(meta: Pick<MetaMrr, 'mes' | 'nome' | 'produtos' | 'valores'>, outras: readonly Pick<MetaMrr, 'id' | 'nome' | 'produtos'>[]): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(meta.mes)) return 'Mês de referência inválido.';
  if (!meta.nome.trim()) return 'Dê um nome à meta (ex.: Planos, Adicionais).';
  if (!meta.produtos.length) return 'Vincule pelo menos um produto do CRM à meta.';
  for (const [vendedor, valor] of Object.entries(meta.valores)) {
    if (!vendedor || !Number.isFinite(valor) || valor < 0) return 'A meta de cada vendedor precisa ser um valor em reais, zero ou maior.';
  }
  for (const o of outras) {
    const repetido = meta.produtos.find(p => o.produtos.includes(p));
    if (repetido) return `Um produto só pode contar para uma meta do mês: ele já está na meta "${o.nome}".`;
  }
  return null;
}

/** De um mês para outro: mesmas metas, mesmos produtos e valores, ids novos. */
export function copiarMetas(metas: readonly MetaMrr[], mesNovo: string, novoId: () => string): MetaMrr[] {
  return metas.map(m => ({ ...m, id: novoId(), mes: mesNovo, produtos: [...m.produtos], produtos_nomes: { ...m.produtos_nomes }, valores: { ...m.valores } }));
}

// ============================================================
// Quem vendeu
// ============================================================

/**
 * O vendedor do financeiro de uma venda do CRM: pelo external_id
 * (`crm_user_<id>`, o mesmo das vendas de viagem), senão pelo e-mail.
 */
export function vendedorDaVenda(vendedor: VendaMrr['vendedor'], vendedores: readonly VendedorDoFinanceiro[]): VendedorDoFinanceiro | null {
  if (!vendedor) return null;
  const porId = vendedores.find(v => v.external_id && v.external_id === vendedor.id);
  if (porId) return porId;
  const email = vendedor.email.trim().toLowerCase();
  return email ? vendedores.find(v => v.email.trim().toLowerCase() === email) ?? null : null;
}

// ============================================================
// Apuração do mês
// ============================================================

export interface ContaNaMeta {
  conta_id: number;
  conta_nome: string;
  dia: string;
  tipo: 'nova' | 'reativada';
  mrr: number;
  itens: ItemVendido[];
}

export interface ResultadoDaMeta {
  meta_id: string;
  nome: string;
  alvo: number | null;
  realizado: number;
  /** Percentual da meta atingido; null sem meta. */
  pct: number | null;
  faixa: FaixaDaMeta | null;
  percentual: number;
  comissao: number;
  contas: ContaNaMeta[];
  pendencia: string | null;
}

export interface ResultadoDoVendedor {
  vendedor_id: string;
  nome: string;
  plano_id: string;
  plano_nome: string;
  metas: ResultadoDaMeta[];
  mrr_nas_metas: number;
  comissao: number;
  pendencias: string[];
}

export interface ApuracaoMrr {
  mes: string;
  vendedores: ResultadoDoVendedor[];
  /** Produtos vendidos que não estão em meta nenhuma do mês. */
  foraDasMetas: { mrr: number; itens: Array<{ chave: string; nome: string; mrr: number; contas: number }> };
  /** Vendas sem negociação ligada no CRM. */
  semVendedor: { mrr: number; contas: Array<{ conta_nome: string; dia: string; mrr: number }> };
  /** Vendedor do CRM que ainda não tem cadastro no financeiro. */
  semCadastro: Array<{ id: string; nome: string; email: string; mrr: number }>;
  total: { mrr: number; mrr_nas_metas: number; comissao: number };
}

export function apurarComissaoMrr(e: {
  mes: string;
  metas: readonly MetaMrr[];
  vendas: readonly VendaMrr[];
  vendedores: readonly VendedorDoFinanceiro[];
  planos: readonly PlanoComFaixasDeMrr[];
}): ApuracaoMrr {
  const metas = e.metas.filter(m => m.mes === e.mes);
  // Um produto conta para UMA meta: a primeira que o vinculou (validarMeta
  // impede o segundo vínculo; aqui é a defesa se o banco tiver dois).
  const metaDoProduto = new Map<string, MetaMrr>();
  for (const m of metas) for (const p of m.produtos) if (!metaDoProduto.has(p)) metaDoProduto.set(p, m);

  const fora = new Map<string, { chave: string; nome: string; mrr: number; contas: Set<number> }>();
  const semVendedor: ApuracaoMrr['semVendedor'] = { mrr: 0, contas: [] };
  const semCadastro = new Map<string, { id: string; nome: string; email: string; mrr: number }>();
  // vendedor → meta → contas
  const porVendedor = new Map<string, Map<string, ContaNaMeta[]>>();

  for (const v of e.vendas) {
    if (v.dia.slice(0, 7) !== e.mes) continue;
    if (!v.vendedor) {
      semVendedor.mrr = round2(semVendedor.mrr + v.mrr);
      semVendedor.contas.push({ conta_nome: v.conta_nome, dia: v.dia, mrr: v.mrr });
      continue;
    }
    const vendedor = vendedorDaVenda(v.vendedor, e.vendedores);
    if (!vendedor) {
      const s = semCadastro.get(v.vendedor.id) ?? { ...v.vendedor, mrr: 0 };
      s.mrr = round2(s.mrr + v.mrr);
      semCadastro.set(v.vendedor.id, s);
      continue;
    }
    const doVendedor = porVendedor.get(vendedor.id) ?? new Map<string, ContaNaMeta[]>();
    porVendedor.set(vendedor.id, doVendedor);
    const porMeta = new Map<string, ItemVendido[]>();
    for (const item of v.itens) {
      const meta = metaDoProduto.get(item.chave);
      if (!meta) {
        const f = fora.get(item.chave) ?? { chave: item.chave, nome: item.nome, mrr: 0, contas: new Set<number>() };
        f.mrr = round2(f.mrr + item.mrr);
        f.contas.add(v.conta_id);
        fora.set(item.chave, f);
        continue;
      }
      porMeta.set(meta.id, [...(porMeta.get(meta.id) ?? []), item]);
    }
    for (const [metaId, itens] of porMeta) {
      const conta: ContaNaMeta = {
        conta_id: v.conta_id, conta_nome: v.conta_nome, dia: v.dia, tipo: v.tipo,
        mrr: round2(itens.reduce((s, i) => s + i.mrr, 0)), itens,
      };
      doVendedor.set(metaId, [...(doVendedor.get(metaId) ?? []), conta]);
    }
  }

  // Quem tem meta aparece mesmo sem venda (a meta a zero também é informação).
  for (const m of metas) for (const [vid, valor] of Object.entries(m.valores)) {
    if (valor > 0 && e.vendedores.some(v => v.id === vid) && !porVendedor.has(vid)) porVendedor.set(vid, new Map());
  }

  const vendedores: ResultadoDoVendedor[] = [];
  for (const [vid, doVendedor] of porVendedor) {
    const vendedor = e.vendedores.find(v => v.id === vid)!;
    const plano = e.planos.find(p => p.id === vendedor.plano_comissao_id && p.ativo && p.base_calculo === 'MRR_GERADO') ?? null;
    const faixas = normalizarFaixas(plano?.mrr?.faixas);
    const pendencias: string[] = [];
    if (!plano) pendencias.push('Sem plano ativo com base MRR gerado: escolha um em Vendedores e planos.');
    else if (!faixas.length) pendencias.push(`O plano "${plano.nome}" não tem faixas de MRR.`);

    const resultados: ResultadoDaMeta[] = [];
    for (const m of metas) {
      const contas = doVendedor.get(m.id) ?? [];
      const alvo = m.valores[vid] > 0 ? round2(m.valores[vid]) : null;
      if (!contas.length && alvo === null) continue;
      const realizado = round2(contas.reduce((s, c) => s + c.mrr, 0));
      const pct = alvo !== null ? round2((realizado / alvo) * 100) : null;
      const faixa = pct !== null && faixas.length ? faixaPelaMeta(faixas, pct) : null;
      let pendencia: string | null = null;
      if (alvo === null && realizado > 0) pendencia = `Sem meta de MRR em "${m.nome}": sem meta não há faixa.`;
      const percentual = faixa && plano ? faixa.percentual : 0;
      const comissao = pendencia || !faixa ? 0 : round2((realizado * percentual) / 100);
      resultados.push({ meta_id: m.id, nome: m.nome, alvo, realizado, pct, faixa, percentual, comissao, contas, pendencia });
      if (pendencia) pendencias.push(pendencia);
    }
    // Sem resultado em meta nenhuma (só vendeu produto fora das metas): não há
    // o que mostrar nem pagar; o MRR dele já aparece em "fora das metas".
    if (!resultados.length) continue;
    const mrrNasMetas = round2(resultados.reduce((s, r) => s + r.realizado, 0));
    vendedores.push({
      vendedor_id: vid, nome: vendedor.nome, plano_id: plano?.id ?? '', plano_nome: plano?.nome ?? '',
      metas: resultados, mrr_nas_metas: mrrNasMetas,
      comissao: round2(resultados.reduce((s, r) => s + r.comissao, 0)),
      pendencias,
    });
  }
  vendedores.sort((a, b) => b.mrr_nas_metas - a.mrr_nas_metas || a.nome.localeCompare(b.nome, 'pt-BR'));

  const foraItens = [...fora.values()].map(f => ({ chave: f.chave, nome: f.nome, mrr: f.mrr, contas: f.contas.size })).sort((a, b) => b.mrr - a.mrr);
  const mrrTotal = round2(e.vendas.filter(v => v.dia.slice(0, 7) === e.mes).reduce((s, v) => s + v.mrr, 0));
  return {
    mes: e.mes,
    vendedores,
    foraDasMetas: { mrr: round2(foraItens.reduce((s, i) => s + i.mrr, 0)), itens: foraItens },
    semVendedor,
    semCadastro: [...semCadastro.values()].sort((a, b) => b.mrr - a.mrr),
    total: {
      mrr: mrrTotal,
      mrr_nas_metas: round2(vendedores.reduce((s, v) => s + v.mrr_nas_metas, 0)),
      comissao: round2(vendedores.reduce((s, v) => s + v.comissao, 0)),
    },
  };
}

// ============================================================
// A linha em `comissoes`
// ============================================================

export const idDaComissaoMrr = (vendedorId: string, mes: string) => `comissao-mrr-${vendedorId}-${mes}`;

function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** O que a comissão de MRR guarda além do que toda comissão guarda. */
export interface DetalheDaComissaoMrr {
  mes: string;
  metas: Array<Pick<ResultadoDaMeta, 'meta_id' | 'nome' | 'alvo' | 'realizado' | 'pct' | 'percentual' | 'comissao'> & { contas: number }>;
}

export interface LinhaDeComissaoMrr {
  id: string;
  venda_id: string;
  venda_numero: string;
  vendedor_id: string;
  vendedor_nome: string;
  plano_comissao_id: string;
  plano_nome: string;
  data_venda: string;
  valor_base: number;
  percentual_aplicado: number;
  valor_comissao: number;
  status: 'CALCULADA' | 'APROVADA' | 'PAGA' | 'CANCELADA';
  data_aprovacao: string | null;
  data_pagamento: string | null;
  observacoes: string;
  origem: 'mrr';
  mrr: DetalheDaComissaoMrr;
}

export function linhaDaComissaoMrr(r: ResultadoDoVendedor, mes: string): LinhaDeComissaoMrr {
  const [a, m] = mes.split('-');
  return {
    id: idDaComissaoMrr(r.vendedor_id, mes),
    venda_id: `mrr-${mes}`,
    venda_numero: `MRR ${m}/${a}`,
    vendedor_id: r.vendedor_id,
    vendedor_nome: r.nome,
    plano_comissao_id: r.plano_id,
    plano_nome: r.plano_nome,
    data_venda: ultimoDiaDoMes(mes),
    valor_base: r.mrr_nas_metas,
    // Percentual efetivo: com duas metas em faixas diferentes, é a média ponderada.
    percentual_aplicado: r.mrr_nas_metas > 0 ? round2((r.comissao / r.mrr_nas_metas) * 100) : 0,
    valor_comissao: r.comissao,
    status: 'CALCULADA',
    data_aprovacao: null,
    data_pagamento: null,
    observacoes: `Comissão por MRR de ${m}/${a}: ${r.metas.map(x => `${x.nome} ${x.pct === null ? 'sem meta' : `${x.pct.toLocaleString('pt-BR')}% da meta`}`).join(', ')}.`,
    origem: 'mrr',
    mrr: {
      mes,
      metas: r.metas.map(x => ({ meta_id: x.meta_id, nome: x.nome, alvo: x.alvo, realizado: x.realizado, pct: x.pct, percentual: x.percentual, comissao: x.comissao, contas: x.contas.length })),
    },
  };
}

export type DecisaoDaComissao =
  | { acao: 'gravar'; linha: LinhaDeComissaoMrr }
  | { acao: 'cancelar' }
  | { acao: 'manter'; motivo: string }
  | { acao: 'nada' };

/**
 * O que fazer com a linha do vendedor no mês, dado o que já está gravado.
 *  - nada gravado e comissão > 0: grava;
 *  - CALCULADA: regrava com os números novos; comissão zerada cancela;
 *  - APROVADA ou PAGA com valor igual: nada; com valor diferente: mantém e
 *    avisa (alguém já aprovou ou pagou aquele valor);
 *  - CANCELADA: volta a valer se a comissão voltou a existir.
 */
export function decidirComissaoMrr(
  existente: { status: string; valor_comissao: number } | null,
  nova: LinhaDeComissaoMrr,
): DecisaoDaComissao {
  const zero = !(nova.valor_comissao > 0);
  if (!existente || existente.status === 'CANCELADA') return zero ? { acao: 'nada' } : { acao: 'gravar', linha: nova };
  if (existente.status === 'CALCULADA') return zero ? { acao: 'cancelar' } : { acao: 'gravar', linha: nova };
  if (Math.abs(round2(existente.valor_comissao) - nova.valor_comissao) < 0.005) return { acao: 'nada' };
  return {
    acao: 'manter',
    motivo: `A comissão de ${nova.vendedor_nome} em ${nova.venda_numero} já foi ${existente.status === 'PAGA' ? 'paga' : 'aprovada'} e mudaria para ${nova.valor_comissao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}: confira antes de mexer.`,
  };
}
