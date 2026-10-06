/**
 * Regras da Hotmart que não cabem no adaptador: como uma transação vira
 * recebimento, e como corrigir o que a versão anterior gravou.
 *
 * Pedido do Bruno (06/10/2026): "O recebimento da plataforma está confuso.
 * Esse pagamento da Latitude Sul não entrou na Hotmart em 6/10, nem em
 * nenhum dia entre 1 e 6 de outubro." A auditoria achou quatro causas:
 *
 * 1. Boleto/Pix GERADO (PURCHASE_BILLET_PRINTED) e renovação que FALHOU
 *    (PURCHASE_DELAYED) viravam conta "Em aberto" com vencimento na data da
 *    compra. Numa plataforma de checkout, cobrança gerada não é dinheiro a
 *    receber: a maioria nunca é paga. Agora o status é AGUARDANDO e não vira
 *    conta a receber; a tela de Recebimentos mostra como "aguardando o
 *    pagamento do cliente".
 * 2. Venda parcelada no cartão virava N contas mensais, todas com o status
 *    da transação ("2/6 Recebido" com vencimento no mês que vem). A Hotmart
 *    repassa a venda INTEIRA ao produtor depois da garantia, por mais que o
 *    comprador parcele: uma transação é um recebimento, previsto para o fim
 *    da garantia.
 * 3. O status de um aviso que chega fora de ordem sobrescrevia o anterior:
 *    "aprovado" depois de "concluído" fazia a venda recebida voltar a aberto
 *    e estornar o caixa. Na Hotmart o ciclo só anda para a frente, exceto
 *    reembolso e chargeback, que vencem qualquer estado.
 * 4. A conta criada pela versão antiga (id sem número de parcela) só era
 *    adotada no primeiro aviso; no seguinte nascia uma segunda conta para a
 *    mesma venda, duplicando a receita.
 *
 * Este arquivo é só cálculo. Quem lê e grava é o servico.ts.
 */
import { num, round2 } from '../money';
import type { ParcelaNormalizada, StatusParcelaPlataforma } from './tipos';

const FINAL = new Set<StatusParcelaPlataforma>(['ESTORNADO', 'CHARGEBACK']);

/**
 * O status que fica depois de um novo aviso da Hotmart. O ciclo só anda
 * para a frente: aguardando → (cancelado | confirmado) → recebido. Reembolso
 * e chargeback vencem tudo e não são desfeitos por aviso atrasado.
 */
export function proximoStatusHotmart(atual: StatusParcelaPlataforma | undefined, novo: StatusParcelaPlataforma): StatusParcelaPlataforma {
  if (!atual) return novo;
  if (FINAL.has(atual)) return FINAL.has(novo) ? novo : atual;
  if (FINAL.has(novo)) return novo;
  if (atual === 'RECEBIDO') return atual;
  if (atual === 'CONFIRMADO') return novo === 'RECEBIDO' ? novo : atual;
  // Cobrança gerada de novo não reabre o que já foi decidido.
  if (novo === 'AGUARDANDO') return atual === 'CANCELADO' ? atual : 'AGUARDANDO';
  return novo;
}

/**
 * Status gravados pela versão anterior para cobrança que ninguém pagou:
 * PENDENTE vinha do boleto/Pix gerado e ATRASADO da renovação que falhou.
 * Na Hotmart, os dois são AGUARDANDO.
 */
export function statusHotmartAtual(s: StatusParcelaPlataforma): StatusParcelaPlataforma {
  return s === 'PENDENTE' || s === 'ATRASADO' ? 'AGUARDANDO' : s;
}

const PESO: Record<StatusParcelaPlataforma, number> = {
  AGUARDANDO: 0, PENDENTE: 0, ATRASADO: 0, CANCELADO: 1, CONFIRMADO: 2, RECEBIDO: 3, ESTORNADO: 4, CHARGEBACK: 4,
};

/**
 * Junta as N parcelas que a versão anterior criava numa só: a Hotmart
 * repassa a venda inteira. Valores somados, datas da primeira, e o status
 * mais avançado entre elas (eram todas iguais, mas o retrato pode ter
 * mudado parcela a parcela).
 */
export function unificarParcelasHotmart(parcelas: readonly ParcelaNormalizada[], previsao?: string): ParcelaNormalizada[] {
  if (parcelas.length === 0) return [];
  const ordem = [...parcelas].sort((a, b) => a.numero - b.numero);
  const primeira = ordem[0];
  const status = ordem
    .map(p => statusHotmartAtual(p.status))
    .reduce((a, b) => (PESO[b] > PESO[a] ? b : a));
  const soma = (f: (p: ParcelaNormalizada) => number) => round2(ordem.reduce((s, p) => s + num(f(p)), 0));
  const recebimentos = ordem.map(p => p.data_recebimento).filter(Boolean).sort();
  return [{
    ...primeira,
    numero: 1,
    total: 1,
    status,
    valor_bruto: soma(p => p.valor_bruto),
    valor_taxa: soma(p => p.valor_taxa),
    valor_liquido: soma(p => p.valor_liquido),
    desconto: soma(p => p.desconto),
    juros: soma(p => p.juros),
    data_prevista_recebimento: previsao || primeira.data_prevista_recebimento || '',
    data_pagamento: ordem.find(p => p.data_pagamento)?.data_pagamento ?? '',
    data_recebimento: status === 'RECEBIDO' ? (recebimentos[0] ?? '') : '',
    antecipada: ordem.some(p => p.antecipada),
  }];
}

/** Uma conta a receber da transação, como está gravada. */
export interface ContaDaTransacao {
  id: string;
  /** Parcela a que a conta pertence (1 para a conta antiga sem número). */
  numero: number;
  status: string;
  valor_recebido: number;
  /** Alguém mexeu: conciliada no extrato, nota emitida ou baixa à mão. */
  tocada_por_humano: string | null;
}

export interface PlanoHotmart {
  /** A transação já está no formato certo: nada a fazer. */
  em_dia: boolean;
  /** Motivo de não mexer (conta tocada por humano). */
  pulada: string | null;
  parcela: ParcelaNormalizada | null;
  /** A conta que representa o recebimento (parcela 1). */
  conta_principal: string | null;
  /** Contas que sobram (parcelas 2..N, ou a duplicata da conta antiga). */
  cancelar: string[];
  /** Quanto o caixa já recebeu desta transação, somando todas as parcelas. */
  creditado: number;
  motivos: Array<'NAO_PAGA' | 'PARCELAS_UNIFICADAS' | 'DUPLICATA_DA_CONTA_ANTIGA'>;
}

/**
 * O que corrigir numa transação da Hotmart gravada pela versão anterior.
 * Conta que uma pessoa tocou (conciliada, com nota, baixada à mão) faz a
 * transação inteira ser pulada e listada: a revisão não apaga trabalho de
 * ninguém, e quem decide é quem olhou.
 */
export function planoHotmart(
  parcelas: readonly ParcelaNormalizada[],
  contas: readonly ContaDaTransacao[],
  creditado: Record<string, number>,
  previsao?: string,
): PlanoHotmart {
  const jaCreditado = round2(Object.values(creditado ?? {}).reduce((s, v) => s + num(v), 0));
  const temAntigo = parcelas.some(p => p.status === 'PENDENTE' || p.status === 'ATRASADO');
  const unificada = unificarParcelasHotmart(parcelas, previsao);
  const parcela = unificada[0] ?? null;

  // A conta principal: a da parcela 1 com número; senão a antiga sem número.
  const daParcela1 = contas.filter(c => c.numero === 1);
  const principal = daParcela1.find(c => /-1$/.test(c.id)) ?? daParcela1[0] ?? null;
  const sobra = contas.filter(c => c !== principal);

  const motivos: PlanoHotmart['motivos'] = [];
  if (parcela && parcela.status === 'AGUARDANDO' && contas.some(c => c.status !== 'CANCELADO')) motivos.push('NAO_PAGA');
  if (parcelas.length > 1) motivos.push('PARCELAS_UNIFICADAS');
  if (daParcela1.length > 1) motivos.push('DUPLICATA_DA_CONTA_ANTIGA');
  const cancelar = sobra.filter(c => c.status !== 'CANCELADO').map(c => c.id);

  const em_dia = parcelas.length <= 1 && !temAntigo && cancelar.length === 0 && motivos.length === 0;
  const tocada = contas.find(c => c.tocada_por_humano);
  if (!em_dia && tocada) {
    return { em_dia: false, pulada: `${tocada.id}: ${tocada.tocada_por_humano}`, parcela, conta_principal: principal?.id ?? null, cancelar: [], creditado: jaCreditado, motivos };
  }
  return { em_dia, pulada: null, parcela, conta_principal: principal?.id ?? null, cancelar, creditado: jaCreditado, motivos };
}

// ── O que a tela mostra ───────────────────────────────────────────────────

/** Avisos da Hotmart em português, para o histórico da transação. */
export const AVISO_HOTMART: Record<string, string> = {
  PURCHASE_BILLET_PRINTED: 'Boleto ou Pix gerado (ainda não pago)',
  PURCHASE_APPROVED: 'Pagamento aprovado (dinheiro em garantia)',
  PURCHASE_COMPLETE: 'Garantia concluída: dinheiro liberado',
  PURCHASE_DELAYED: 'Cobrança da assinatura não paga',
  PURCHASE_CANCELED: 'Compra cancelada',
  PURCHASE_EXPIRED: 'Boleto ou Pix expirou sem pagamento',
  PURCHASE_REFUNDED: 'Reembolsada ao comprador',
  PURCHASE_CHARGEBACK: 'Chargeback',
  PURCHASE_PROTEST: 'Contestação do comprador',
};

export interface SituacaoDaTransacao {
  codigo: 'aguardando' | 'garantia' | 'liberada' | 'nao-paga' | 'reembolsada' | 'em-aberto' | 'atrasada' | 'mista';
  rotulo: string;
  /** Entra em "a receber"? Só dinheiro pago ou cobrança da agência. */
  conta_a_receber: boolean;
}

/** A situação da transação na plataforma, em uma frase. */
export function situacaoDaTransacao(
  parcelas: readonly ParcelaNormalizada[],
  formatarData: (iso: string) => string = iso => iso,
): SituacaoDaTransacao {
  const st = new Set(parcelas.map(p => p.status));
  const so = (s: StatusParcelaPlataforma) => st.size === 1 && st.has(s);
  if (st.has('ESTORNADO') || st.has('CHARGEBACK')) return { codigo: 'reembolsada', rotulo: st.has('CHARGEBACK') ? 'Chargeback: o dinheiro voltou ao comprador' : 'Reembolsada ao comprador', conta_a_receber: false };
  if (so('AGUARDANDO')) return { codigo: 'aguardando', rotulo: 'Cobrança gerada, aguardando o cliente pagar. Não é dinheiro a receber.', conta_a_receber: false };
  if (so('CANCELADO')) return { codigo: 'nao-paga', rotulo: 'Não paga: cancelada ou expirada', conta_a_receber: false };
  if (so('RECEBIDO')) return { codigo: 'liberada', rotulo: 'Paga e liberada', conta_a_receber: true };
  if (so('CONFIRMADO')) {
    const previsao = parcelas.map(p => p.data_prevista_recebimento).filter(Boolean).sort()[0];
    return { codigo: 'garantia', rotulo: previsao ? `Paga, em garantia até ${formatarData(previsao)}` : 'Paga, aguardando o fim da garantia', conta_a_receber: true };
  }
  if (so('PENDENTE')) return { codigo: 'em-aberto', rotulo: 'Cobrança em aberto', conta_a_receber: true };
  if (so('ATRASADO')) return { codigo: 'atrasada', rotulo: 'Cobrança atrasada', conta_a_receber: true };
  return { codigo: 'mista', rotulo: 'Parcelas em situações diferentes', conta_a_receber: true };
}
