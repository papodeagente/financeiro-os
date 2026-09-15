/**
 * A venda como o Painel e o pilar Equipe precisam dela.
 *
 * Existe porque VendaCRM tem DUAS formas no banco e as telas somavam campos
 * que significam coisas diferentes em cada uma. `markup_realizado` é o caso
 * caro: percentual de markup na venda digitada em /vendas/nova e valor
 * absoluto de comissão nas vendas vindas do CRM. Somar os dois dá um número
 * que não é dinheiro nenhum.
 */
import type { VendaCRM, StatusVendaCRM } from './crm-types';
import { num, paraBRL, percentual, round2, somaPor } from './money';

// VendaCRM tem 2 formas no banco:
// 1) Legacy: campos completos (numero, produtos[], valor_final, valor_total_custo,
//    markup_realizado, status='CONFIRMADO'|...) — vindo da UI /vendas/nova
// 2) Nova (vinda do VENDA_FECHADA do CRM): valor_total/custo_total/comissao/
//    rentabilidade, status='vendido', sem produtos[] (vendas fechadas pelo
//    funil do CRM ainda não detalhadas por produto)
//
// O dashboard espera (1). normalizeVenda mapeia (2) para o shape (1) para
// que reduce/forEach em produtos não estourem.
//
// ATENÇÃO: `markup_realizado` tem DOIS significados no banco — percentual de
// markup na venda digitada em /vendas/nova e valor absoluto de comissão nas
// vendas vindas do CRM. Por isso ele NUNCA entra em somatório de dinheiro;
// normalizeVenda deriva `receita_agencia` em R$ e é esse campo que o
// dashboard soma.
export type VendaDash = VendaCRM & { receita_agencia: number };

export function normalizeVenda(v: Partial<VendaCRM> & Record<string, unknown>): VendaDash {
  const statusRaw = String(v.status ?? '').toLowerCase();
  const status: StatusVendaCRM =
    statusRaw === 'vendido' ? 'CONFIRMADO' :
    (['ORCAMENTO', 'RESERVADO', 'CONFIRMADO', 'CANCELADO', 'CONCLUIDO'] as const).includes(v.status as StatusVendaCRM)
      ? v.status as StatusVendaCRM
      : 'CONFIRMADO';

  const valor_total_venda =
    (v.valor_final as number | undefined)
    ?? (v.valor_total_venda as number | undefined)
    ?? (v.valor_total as number | undefined)
    ?? 0;
  const valor_total_custo =
    (v.valor_total_custo as number | undefined)
    ?? (v.custo_total as number | undefined)
    ?? 0;
  // markup_realizado = receita real da agência (comissão efetiva).
  // Só aceita campos que representem comissão de verdade. NÃO faz fallback
  // para rentabilidade/(valor−custo) — isso é margem bruta, não receita.
  // Se CRM não enviar comissão, fica 0 (KPI "Margem Bruta" mostra o resto).
  const markup_realizado =
    (v.markup_realizado as number | undefined)
    ?? (v.comissao as number | undefined)
    ?? 0;

  const produtos = (v.produtos as VendaCRM['produtos']) ?? [];
  // Receita da agência EM R$, na ordem de confiabilidade:
  //  1) comissão por produto (comissao_fornecedor é % do valor de venda);
  //  2) comissão absoluta reportada pelo CRM (campo `comissao`);
  //  3) valor final - custo, quando há custo de fornecedor registrado.
  // Sem nenhuma das três a receita é 0 (KPI mostra "aguardando comissão").
  const comissaoProdutos = somaPor(produtos, p =>
    percentual(paraBRL(p.valor_venda, p.moeda, p.cambio), p.comissao_fornecedor));
  const comissaoCRM = num(v.comissao);
  const receita_agencia =
    comissaoProdutos > 0 ? comissaoProdutos
    : comissaoCRM > 0 ? round2(comissaoCRM)
    : num(valor_total_custo) > 0 ? Math.max(round2(num(valor_total_venda) - num(valor_total_custo)), 0)
    : 0;

  return {
    receita_agencia,
    id: (v.id as string) ?? '',
    numero: (v.numero as string) ?? (v.crm_venda_id as string) ?? String(v.id ?? '').slice(0, 8) ?? '—',
    data_venda: (v.data_venda as string) ?? '',
    tipo: (v.tipo as 'AVULSA' | 'GRUPO') ?? (v.grupo_id ? 'GRUPO' : 'AVULSA'),
    grupo_id: (v.grupo_id as string | null) ?? null,
    cliente_id: (v.cliente_id as string) ?? '',
    vendedor_id: (v.vendedor_id as string) ?? '',
    passageiros: (v.passageiros as VendaCRM['passageiros']) ?? [],
    pagantes: (v.pagantes as VendaCRM['pagantes']) ?? [],
    produtos,
    valor_total_custo,
    valor_total_venda,
    markup_realizado,
    desconto: (v.desconto as number) ?? 0,
    valor_final: valor_total_venda,
    forma_pagamento: (v.forma_pagamento as VendaCRM['forma_pagamento']) ?? 'AVISTA_PIX',
    parcelas: (v.parcelas as number) ?? 1,
    pagamento_detalhado: (v.pagamento_detalhado as VendaCRM['pagamento_detalhado']) ?? [],
    status,
    motivo_cancelamento: (v.motivo_cancelamento as string) ?? '',
    recibo_emitido: (v.recibo_emitido as boolean) ?? false,
    intermediario_id: (v.intermediario_id as string | null) ?? null,
    comissao_intermediario: (v.comissao_intermediario as number) ?? 0,
    centro_custo: (v.centro_custo as string) ?? '',
    numero_po: (v.numero_po as string) ?? '',
    anexos: (v.anexos as VendaCRM['anexos']) ?? [],
    observacoes: (v.observacoes as string) ?? '',
    campos_personalizados: (v.campos_personalizados as Record<string, string>) ?? {},
  };
}

/**
 * O que ficou com a agência numa venda: o que o cliente pagou menos o repasse
 * ao fornecedor, sem deixar passar de zero.
 *
 * Clampado POR VENDA de propósito: uma viagem vendida abaixo do custo é
 * prejuízo, mas receita de empresa não é negativa. Quem precisa enxergar a
 * perda é o lucro, que usa a margem sem clamp — são perguntas diferentes.
 */
export function receitaDaAgencia(v: { valor_final?: number; valor_total_custo?: number }): number {
  return Math.max(round2(num(v.valor_final) - num(v.valor_total_custo)), 0);
}
