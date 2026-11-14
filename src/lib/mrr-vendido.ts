/**
 * O MRR vendido no mês, como o CRM manda (consulta MRR_VENDIDO, só para a
 * conta da Entur: shared/mrrVendidoParaOFinanceiro.ts no CRM).
 *
 * Cada venda é uma conta nova ou reativada do Entur OS no mês, as mesmas das
 * listas Novo e Reativação da Área Comercial, com o MRR que trouxe (anual ÷ 12),
 * os produtos que entraram (planos, adicionais, programas) e o vendedor da
 * negociação ligada a ela.
 *
 * Aqui só a leitura da resposta, pura e testada. A chamada assinada mora em
 * crm-integration.ts (consultarMrrVendido).
 */

export const TIPO_MRR_VENDIDO = 'MRR_VENDIDO';

export type ClasseDoProduto = 'plano' | 'adicional' | 'programa' | 'outros';

export interface ProdutoDoEcossistema {
  /** `plano:<slug>`, `adicional:<tipo>`, `programa:<id>` ou `outros`. */
  chave: string;
  nome: string;
  classe: ClasseDoProduto;
}

export interface ItemVendido extends ProdutoDoEcossistema {
  /** MRR do item em reais. */
  mrr: number;
}

export interface VendaMrr {
  conta_id: number;
  conta_nome: string;
  dia: string;
  tipo: 'nova' | 'reativada';
  mrr: number;
  itens: ItemVendido[];
  /** `id` é `crm_user_<id>`, o mesmo external_id das vendas do CRM. */
  vendedor: { id: string; nome: string; email: string } | null;
  negociacao_id: string | null;
}

export interface MrrVendido {
  mes: string;
  apurado_em: string;
  produtos: ProdutoDoEcossistema[];
  vendas: VendaMrr[];
}

/** O que a consulta ao CRM deu: os números, ou por que não vieram. */
export type MrrDoCrm =
  | { situacao: 'ok'; mrr: MrrVendido; consultado_em: string }
  | { situacao: 'sem_integracao' | 'crm_sem_suporte' | 'indisponivel' | 'nao_e_a_conta_operadora'; detalhe: string };

const CLASSES = new Set<ClasseDoProduto>(['plano', 'adicional', 'programa', 'outros']);

const dinheiro = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function lerProduto(bruto: unknown): ProdutoDoEcossistema | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const p = bruto as Record<string, unknown>;
  const chave = texto(p.chave);
  if (!chave) return null;
  const classe = CLASSES.has(p.classe as ClasseDoProduto) ? (p.classe as ClasseDoProduto) : 'outros';
  return { chave, nome: texto(p.nome) || chave, classe };
}

/**
 * Lê o `mrr` da resposta do CRM. Devolve null quando não é o mês pedido:
 * número de outro mês nunca vira comissão deste. Venda com MRR quebrado fica
 * de fora (não vira zero), e item quebrado também.
 */
export function lerMrrVendido(bruto: unknown, mes: string): MrrVendido | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const m = bruto as Record<string, unknown>;
  if (m.mes !== mes || !Array.isArray(m.vendas)) return null;

  const vendas: VendaMrr[] = [];
  for (const b of m.vendas as unknown[]) {
    if (!b || typeof b !== 'object') continue;
    const v = b as Record<string, unknown>;
    const dia = texto(v.dia);
    const mrr = dinheiro(v.mrr);
    const contaId = Number(v.conta_id);
    if (dia.slice(0, 7) !== mes || mrr === null || !Number.isFinite(contaId)) continue;
    const itens: ItemVendido[] = [];
    for (const i of Array.isArray(v.itens) ? (v.itens as unknown[]) : []) {
      const p = lerProduto(i);
      const valor = dinheiro((i as Record<string, unknown> | null)?.mrr);
      if (p && valor !== null && valor > 0) itens.push({ ...p, mrr: valor });
    }
    const vd = v.vendedor && typeof v.vendedor === 'object' ? (v.vendedor as Record<string, unknown>) : null;
    vendas.push({
      conta_id: contaId,
      conta_nome: texto(v.conta_nome) || `Conta ${contaId}`,
      dia,
      tipo: v.tipo === 'reativada' ? 'reativada' : 'nova',
      mrr,
      itens,
      vendedor: vd && texto(vd.id) ? { id: texto(vd.id), nome: texto(vd.nome), email: texto(vd.email).toLowerCase() } : null,
      negociacao_id: texto(v.negociacao_id) || null,
    });
  }

  const produtos: ProdutoDoEcossistema[] = [];
  const vistos = new Set<string>();
  for (const b of Array.isArray(m.produtos) ? (m.produtos as unknown[]) : []) {
    const p = lerProduto(b);
    if (p && !vistos.has(p.chave)) { vistos.add(p.chave); produtos.push(p); }
  }
  return { mes, apurado_em: texto(m.apurado_em), produtos, vendas };
}
