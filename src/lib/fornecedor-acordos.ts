/**
 * ACORDOS COM FORNECEDORES (E5, parte C, 05/11/2026).
 *
 * O que cada fornecedor paga à agência por tipo de produto (ou por um produto
 * do catálogo), com VIGÊNCIA: Comissão (% ou valor), Over (% ou valor) e a
 * Taxa CC que ele cobra sobre Taxa DU e RAV quando passa o cartão do cliente.
 * Um acordo pode valer só para compras feitas por um representante
 * (consolidadora).
 *
 * A venda usa o acordo vigente NA DATA DA VENDA (não o de hoje): mudar o
 * acordo em dezembro não mexe na comissão esperada de uma venda de outubro.
 * Quando mais de um acordo serve, vale o mais específico (produto do
 * catálogo > representante > tipo de produto); empatados, o que começou por
 * último.
 *
 * Usos:
 *  - venda lançada à mão: componente que falta (Comissão, Over, Taxa CC) é
 *    preenchido pelo acordo (`aplicarAcordosNaVenda`); componente que a pessoa
 *    pôs, mesmo zerado, nunca é trocado;
 *  - comissão esperada × recebida por operadora (fornecedor-comissao.ts).
 *
 * Arquivo puro. Dinheiro em centavos; percentuais com até 4 casas.
 */
import { num } from './money';
import {
  ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO, dataOuVazio, novoIdDaVenda, totaisDoProduto,
  type Centavos, type ComponenteDeReceita, type ParteDaVenda, type ProdutoDaVenda, type TipoProduto, type Venda,
} from './venda-modelo';

export interface AcordoComFornecedor {
  id: string;
  fornecedor: ParteDaVenda;
  /** Só compras por este representante. null = qualquer caminho. */
  representante: ParteDaVenda | null;
  /** null = todos os tipos de produto. */
  tipo_produto: TipoProduto | null;
  /** Produto do catálogo do CRM ('' = qualquer). */
  produto_crm_id: string;
  produto_nome: string;
  comissao_percentual: number | null;
  comissao_valor_centavos: Centavos | null;
  over_percentual: number | null;
  over_valor_centavos: Centavos | null;
  /** % sobre a Taxa DU quando o fornecedor cobra o cartão do cliente. */
  taxa_cc_du_percentual: number | null;
  /** % sobre o RAV quando o fornecedor cobra o cartão do cliente. */
  taxa_cc_rav_percentual: number | null;
  vigencia_inicio: string;
  /** null = sem fim. */
  vigencia_fim: string | null;
  observacoes: string;
}

export interface ErroDoAcordo { campo: string; mensagem: string }

const txt = (v: unknown, max = 300) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));

function pct(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v);
  return n > 0 ? Math.round(n * 10000) / 10000 : null;
}
function cent(v: unknown): Centavos | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parte(v: unknown): ParteDaVenda | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = txt(o.id, 200);
  const nome = txt(o.nome, 200);
  return id || nome ? { id, nome } : null;
}

/** Lê o acordo vindo da tela ou do banco e diz o que impede gravar. */
export function normalizarAcordo(v: unknown): { acordo: AcordoComFornecedor; erros: ErroDoAcordo[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const erros: ErroDoAcordo[] = [];
  const fornecedor = parte(o.fornecedor) ?? { id: '', nome: '' };
  if (!fornecedor.id) erros.push({ campo: 'fornecedor', mensagem: 'Escolha o fornecedor do acordo.' });
  const tipo = txt(o.tipo_produto).toUpperCase();
  const acordo: AcordoComFornecedor = {
    id: txt(o.id, 80),
    fornecedor,
    representante: parte(o.representante),
    tipo_produto: (TIPOS_PRODUTO as readonly string[]).includes(tipo) ? tipo as TipoProduto : null,
    produto_crm_id: txt(o.produto_crm_id, 120),
    produto_nome: txt(o.produto_nome, 200),
    comissao_percentual: pct(o.comissao_percentual),
    comissao_valor_centavos: cent(o.comissao_valor_centavos),
    over_percentual: pct(o.over_percentual),
    over_valor_centavos: cent(o.over_valor_centavos),
    taxa_cc_du_percentual: pct(o.taxa_cc_du_percentual),
    taxa_cc_rav_percentual: pct(o.taxa_cc_rav_percentual),
    vigencia_inicio: dataOuVazio(o.vigencia_inicio),
    vigencia_fim: dataOuVazio(o.vigencia_fim) || null,
    observacoes: txt(o.observacoes, 1000),
  };
  if (!acordo.vigencia_inicio) erros.push({ campo: 'vigencia_inicio', mensagem: 'Diga desde quando o acordo vale.' });
  if (acordo.vigencia_fim && acordo.vigencia_inicio && acordo.vigencia_fim < acordo.vigencia_inicio) {
    erros.push({ campo: 'vigencia_fim', mensagem: 'O fim da vigência vem antes do início.' });
  }
  for (const [campo, valor] of [['comissao_percentual', acordo.comissao_percentual], ['over_percentual', acordo.over_percentual], ['taxa_cc_du_percentual', acordo.taxa_cc_du_percentual], ['taxa_cc_rav_percentual', acordo.taxa_cc_rav_percentual]] as const) {
    if (valor !== null && valor > 100) erros.push({ campo, mensagem: 'Percentual acima de 100%.' });
  }
  if (acordo.comissao_percentual !== null && acordo.comissao_valor_centavos !== null) {
    erros.push({ campo: 'comissao_valor_centavos', mensagem: 'Use percentual OU valor na comissão, não os dois.' });
  }
  if (acordo.over_percentual !== null && acordo.over_valor_centavos !== null) {
    erros.push({ campo: 'over_valor_centavos', mensagem: 'Use percentual OU valor no over, não os dois.' });
  }
  const temAlgo = [acordo.comissao_percentual, acordo.comissao_valor_centavos, acordo.over_percentual, acordo.over_valor_centavos, acordo.taxa_cc_du_percentual, acordo.taxa_cc_rav_percentual].some(x => x !== null);
  if (!temAlgo) erros.push({ campo: 'comissao_percentual', mensagem: 'Informe ao menos a comissão, o over ou a Taxa CC.' });
  if (acordo.representante && acordo.representante.id && acordo.representante.id === fornecedor.id) {
    erros.push({ campo: 'representante', mensagem: 'O representante precisa ser outra empresa.' });
  }
  return { acordo, erros };
}

/** O que identifica "o mesmo acordo" no tempo: dois deles não podem valer no mesmo dia. */
export function chaveDoAcordo(a: Pick<AcordoComFornecedor, 'fornecedor' | 'representante' | 'tipo_produto' | 'produto_crm_id'>): string {
  return [a.fornecedor.id, a.representante?.id ?? '', a.tipo_produto ?? '', a.produto_crm_id].join('|');
}

function sobrepoe(a: { vigencia_inicio: string; vigencia_fim: string | null }, b: { vigencia_inicio: string; vigencia_fim: string | null }): boolean {
  const fimA = a.vigencia_fim ?? '9999-12-31';
  const fimB = b.vigencia_fim ?? '9999-12-31';
  return a.vigencia_inicio <= fimB && b.vigencia_inicio <= fimA;
}

/** Acordos com a mesma chave e vigência que encosta na do novo (o próprio fica de fora). */
export function conflitosDeVigencia(novo: AcordoComFornecedor, existentes: readonly AcordoComFornecedor[]): AcordoComFornecedor[] {
  const chave = chaveDoAcordo(novo);
  return existentes.filter(e => e.id !== novo.id && chaveDoAcordo(e) === chave && sobrepoe(novo, e));
}

export function vigenteEm(a: Pick<AcordoComFornecedor, 'vigencia_inicio' | 'vigencia_fim'>, data: string): boolean {
  return a.vigencia_inicio <= data && (!a.vigencia_fim || a.vigencia_fim >= data);
}

export interface AcordoEscolhido {
  acordo: AcordoComFornecedor;
  /** Por que este (para a tela explicar). */
  motivo: string;
}

/**
 * O acordo que vale para o produto na data. Procura primeiro pelo fornecedor
 * do produto; se não houver, pelo representante (acordo feito com a
 * consolidadora como um todo).
 */
export function acordoVigente(
  p: Pick<ProdutoDaVenda, 'fornecedor' | 'representante' | 'tipo' | 'produto_crm_id'>,
  data: string,
  acordos: readonly AcordoComFornecedor[],
): AcordoEscolhido | null {
  const tentar = (fornecedorId: string, repId: string): AcordoEscolhido | null => {
    if (!fornecedorId) return null;
    let melhor: { a: AcordoComFornecedor; nota: number } | null = null;
    for (const a of acordos) {
      if (a.fornecedor.id !== fornecedorId || !vigenteEm(a, data)) continue;
      if (a.representante?.id && a.representante.id !== repId) continue;
      if (a.tipo_produto && a.tipo_produto !== p.tipo) continue;
      if (a.produto_crm_id && a.produto_crm_id !== p.produto_crm_id) continue;
      const nota = (a.produto_crm_id ? 4 : 0) + (a.representante?.id ? 2 : 0) + (a.tipo_produto ? 1 : 0);
      if (!melhor || nota > melhor.nota || (nota === melhor.nota && a.vigencia_inicio > melhor.a.vigencia_inicio)) melhor = { a, nota };
    }
    if (!melhor) return null;
    const a = melhor.a;
    const partes = [
      a.produto_crm_id ? `produto ${a.produto_nome || a.produto_crm_id}` : a.tipo_produto ? ROTULO_TIPO_PRODUTO[a.tipo_produto] : 'todos os produtos',
      a.representante?.nome ? `via ${a.representante.nome}` : '',
    ].filter(Boolean).join(', ');
    return { acordo: a, motivo: `Acordo com ${a.fornecedor.nome || 'o fornecedor'} (${partes}), vigente desde ${dataBR(a.vigencia_inicio)}${a.vigencia_fim ? ` até ${dataBR(a.vigencia_fim)}` : ''}.` };
  };
  return tentar(p.fornecedor?.id ?? '', p.representante?.id ?? '')
    ?? tentar(p.representante?.id ?? '', '');
}

const dataBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// ============================================================
// Taxa CC: sobre a Taxa DU ou sobre o RAV
// ============================================================

export type LadoDaTaxaCC = 'DU' | 'RAV';
export const ROTULO_TAXA_CC: Record<LadoDaTaxaCC, string> = { DU: 'Taxa CC DU', RAV: 'Taxa CC RAV' };

/**
 * Sobre qual taxa está a Taxa CC. O modelo tem um componente só (TAXA_CC);
 * o lado vai na descrição ("Taxa CC DU…"/"Taxa CC RAV…"). Sem descrição, o
 * lado é o da taxa que o produto tem (RAV primeiro).
 */
export function ladoDaTaxaCC(c: Pick<ComponenteDeReceita, 'descricao'>, p: Pick<ProdutoDaVenda, 'componentes'>): LadoDaTaxaCC {
  const d = c.descricao.toUpperCase();
  if (d.startsWith('TAXA CC DU')) return 'DU';
  if (d.startsWith('TAXA CC RAV')) return 'RAV';
  if (/\bDU\b/.test(d) && !/\bRAV\b/.test(d)) return 'DU';
  const temRav = p.componentes.some(x => x.tipo === 'RAV' && x.valor_centavos > 0);
  const temDu = p.componentes.some(x => x.tipo === 'TAXA_DU' && x.valor_centavos > 0);
  return !temRav && temDu ? 'DU' : 'RAV';
}

export interface TaxasDoProduto {
  taxa_du: Centavos;
  rav: Centavos;
  taxa_cc_du: Centavos;
  taxa_cc_rav: Centavos;
}

/** Taxa DU, RAV e a Taxa CC de cada uma, na moeda do produto (passageiro cancelado não entra). */
export function taxasDoProduto(p: ProdutoDaVenda): TaxasDoProduto {
  const ativos = new Set(p.passageiros.filter(x => !x.cancelado_em).map(x => x.id));
  const conta = (c: ComponenteDeReceita) => !p.cancelado_em && (!c.passageiro_id || ativos.has(c.passageiro_id));
  const t: TaxasDoProduto = { taxa_du: 0, rav: 0, taxa_cc_du: 0, taxa_cc_rav: 0 };
  for (const c of p.componentes) {
    if (!conta(c)) continue;
    if (c.tipo === 'TAXA_DU') t.taxa_du += c.valor_centavos;
    else if (c.tipo === 'RAV') t.rav += c.valor_centavos;
    else if (c.tipo === 'TAXA_CC') {
      if (ladoDaTaxaCC(c, p) === 'DU') t.taxa_cc_du += c.valor_centavos; else t.taxa_cc_rav += c.valor_centavos;
    }
  }
  return t;
}

export class ErroTaxaCC extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string) { super(mensagem); this.name = 'ErroTaxaCC'; this.codigo = codigo; }
}

/**
 * Troca a Taxa CC de um lado (DU ou RAV) do produto. Regras do mercado: não
 * passa da taxa a que se refere, e não existe sem ela. Zero fica gravado como
 * zero (diz "sem Taxa CC"; o acordo não volta a preencher).
 */
export function alterarTaxaCCDoProduto(p: ProdutoDaVenda, lado: LadoDaTaxaCC, valor: Centavos): ProdutoDaVenda {
  const t = taxasDoProduto(p);
  const base = lado === 'DU' ? t.taxa_du : t.rav;
  const rotulo = lado === 'DU' ? 'Taxa DU' : 'RAV';
  if (!(valor >= 0) || !Number.isInteger(valor)) throw new ErroTaxaCC('VALOR', 'Valor inválido.');
  if (base <= 0) throw new ErroTaxaCC('SEM_TAXA', `Este produto não tem ${rotulo}: não há Taxa CC ${lado} para alterar.`);
  if (valor > base) throw new ErroTaxaCC('ACIMA_DA_TAXA', `A Taxa CC ${lado} não pode passar da ${rotulo} do produto.`);
  const outros = p.componentes.filter(c => !(c.tipo === 'TAXA_CC' && ladoDaTaxaCC(c, p) === lado));
  return {
    ...p,
    componentes: [...outros, { id: novoIdDaVenda('cp'), tipo: 'TAXA_CC', valor_centavos: valor, percentual: null, passageiro_id: null, descricao: ROTULO_TAXA_CC[lado] }],
  };
}

// ============================================================
// O que o acordo diz para um produto
// ============================================================

export interface EsperadoDoProduto {
  acordo_id: string;
  motivo: string;
  /** Na moeda do produto. */
  comissao: Centavos;
  over: Centavos;
  taxa_cc_du: Centavos;
  taxa_cc_rav: Centavos;
}

/** Valor fixo do acordo (em reais) na moeda do produto. */
function naMoeda(valorBrl: Centavos, p: Pick<ProdutoDaVenda, 'moeda' | 'cambio'>): Centavos {
  return p.moeda === 'BRL' ? valorBrl : Math.round(valorBrl / (p.cambio > 0 ? p.cambio : 1));
}

/** Comissão, over e Taxa CC que o acordo manda para o produto (null: nenhum acordo vale). */
export function esperadoDoProduto(p: ProdutoDaVenda, data: string, acordos: readonly AcordoComFornecedor[]): EsperadoDoProduto | null {
  const e = acordoVigente(p, data, acordos);
  if (!e) return null;
  const a = e.acordo;
  const tarifa = totaisDoProduto(p).tarifa;
  const t = taxasDoProduto(p);
  const peloCartao = p.quem_cobra === 'FORNECEDOR';
  return {
    acordo_id: a.id, motivo: e.motivo,
    comissao: a.comissao_valor_centavos !== null ? naMoeda(a.comissao_valor_centavos, p) : Math.round(tarifa * (a.comissao_percentual ?? 0) / 100),
    over: a.over_valor_centavos !== null ? naMoeda(a.over_valor_centavos, p) : Math.round(tarifa * (a.over_percentual ?? 0) / 100),
    taxa_cc_du: peloCartao ? Math.round(t.taxa_du * (a.taxa_cc_du_percentual ?? 0) / 100) : 0,
    taxa_cc_rav: peloCartao ? Math.round(t.rav * (a.taxa_cc_rav_percentual ?? 0) / 100) : 0,
  };
}

export interface AplicacaoDoAcordo {
  produto_id: string;
  tipo: 'COMISSAO' | 'OVER' | 'TAXA_CC';
  acordo_id: string;
  valor_centavos: Centavos;
  motivo: string;
}

/**
 * Preenche o que falta na venda pelos acordos vigentes na data dela. Só
 * acrescenta componente de um tipo que o produto NÃO tem (nem zerado): o que a
 * pessoa ou o CRM disse nunca é trocado.
 */
export function aplicarAcordosNaVenda(venda: Venda, acordos: readonly AcordoComFornecedor[]): { venda: Venda; aplicados: AplicacaoDoAcordo[] } {
  const aplicados: AplicacaoDoAcordo[] = [];
  if (!acordos.length || !venda.data_venda) return { venda, aplicados };
  const produtos = venda.produtos.map(p => {
    if (p.cancelado_em) return p;
    const esperado = esperadoDoProduto(p, venda.data_venda, acordos);
    if (!esperado) return p;
    const tem = (tipo: string) => p.componentes.some(c => c.tipo === tipo);
    const novos: ComponenteDeReceita[] = [];
    const sufixo = `pelo acordo vigente em ${dataBR(venda.data_venda)}`;
    const add = (tipo: AplicacaoDoAcordo['tipo'], valor: Centavos, descricao: string) => {
      if (valor <= 0) return;
      novos.push({ id: novoIdDaVenda('cp'), tipo, valor_centavos: valor, percentual: null, passageiro_id: null, descricao });
      aplicados.push({ produto_id: p.id, tipo, acordo_id: esperado.acordo_id, valor_centavos: valor, motivo: esperado.motivo });
    };
    if (!tem('COMISSAO')) add('COMISSAO', esperado.comissao, `Comissão ${sufixo}`);
    if (!tem('OVER')) add('OVER', esperado.over, `Over ${sufixo}`);
    if (!tem('TAXA_CC')) {
      add('TAXA_CC', esperado.taxa_cc_du, `${ROTULO_TAXA_CC.DU} ${sufixo}`);
      add('TAXA_CC', esperado.taxa_cc_rav, `${ROTULO_TAXA_CC.RAV} ${sufixo}`);
    }
    return novos.length ? { ...p, componentes: [...p.componentes, ...novos] } : p;
  });
  return { venda: aplicados.length ? { ...venda, produtos } : venda, aplicados };
}

/** Frase curta do que o acordo dá ("Comissão 10% · Over R$ 50,00 · Taxa CC RAV 2%"). */
export function resumoDoAcordo(a: AcordoComFornecedor): string {
  const r = (c: Centavos) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const p = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  return [
    a.comissao_percentual !== null ? `Comissão ${p(a.comissao_percentual)}` : a.comissao_valor_centavos !== null ? `Comissão ${r(a.comissao_valor_centavos)}` : '',
    a.over_percentual !== null ? `Over ${p(a.over_percentual)}` : a.over_valor_centavos !== null ? `Over ${r(a.over_valor_centavos)}` : '',
    a.taxa_cc_du_percentual !== null ? `Taxa CC DU ${p(a.taxa_cc_du_percentual)}` : '',
    a.taxa_cc_rav_percentual !== null ? `Taxa CC RAV ${p(a.taxa_cc_rav_percentual)}` : '',
  ].filter(Boolean).join(' · ');
}
