/**
 * UNIFICAÇÃO DO RECEBIMENTO: o pagamento da plataforma passa a SER o
 * recebimento da venda do CRM, em vez de uma segunda venda ao lado dela.
 *
 * Pedido do Bruno (01/10/2026): "muitas vezes foi uma negociação iniciada
 * no CRM que gerou um link de pagamento e no final duplica no financeiro".
 *
 * O que duplicava. A venda fechada no CRM chega por webhook e gera as suas
 * contas a receber (o valor combinado, nas parcelas combinadas). O link de
 * pagamento da plataforma chega por outro webhook e gera as dele (o que o
 * cliente de fato pagou, com a taxa declarada). Vincular um ao outro só
 * apontava as contas da plataforma para a venda — as contas do CRM ficavam
 * de pé. A mesma viagem aparecia duas vezes no contas a receber, na receita
 * do DRE e na projeção do caixa.
 *
 * A REGRA: o recebimento da plataforma CONSOME as contas pendentes da venda
 * no CRM, na ordem do vencimento. Conta inteiramente coberta é cancelada
 * (substituída); a que fica parcialmente coberta tem o valor reduzido ao
 * que ainda falta receber; as demais ficam como estão. Assim:
 *
 *   - o que o cliente já pagou não aparece como pendente;
 *   - o que ainda falta continua cobrável, com o valor certo;
 *   - se a plataforma recebeu MAIS do que a venda previa, o excesso fica
 *     nas contas da plataforma (é receita de verdade) e a tela avisa.
 *
 * Nunca se toca em conta já recebida, parcial ou cancelada: baixa moveu
 * caixa, e desfazer isso por cima de uma unificação apagaria lançamento.
 *
 * É REVERSÍVEL. Cada conta tocada guarda em `substituida_por_plataforma` o
 * que ela era, e "registrar como venda direta" devolve tudo. Unificação que
 * não se desfaz é a que ninguém se atreve a fazer.
 *
 * Este arquivo é só cálculo. Quem lê e grava é `unificar-db.ts`.
 */
import { num, round2 } from '../money';

export interface ContaDaVenda {
  id: string;
  status: string;
  valor_final: number;
  data_vencimento: string;
  /** Marca de conta criada pela própria plataforma: nunca entra no plano. */
  plataforma_transacao?: string | null;
}

export type AcaoNaConta =
  | { id: string; acao: 'CANCELAR'; valor_original: number }
  | { id: string; acao: 'REDUZIR'; valor_original: number; valor_novo: number };

export interface PlanoDeUnificacao {
  acoes: AcaoNaConta[];
  /** Quanto das contas do CRM o pagamento cobriu. */
  consumido: number;
  /** O que a plataforma recebeu além do que a venda previa. */
  excedente: number;
  /** O que ainda falta receber da venda depois da unificação. */
  restante: number;
}

const TOCAVEL = new Set(['PENDENTE', 'ATRASADO']);

/**
 * O plano: quais contas da venda o pagamento da plataforma substitui.
 *
 * Entram só as contas da própria venda que ainda não receberam nada e que
 * não vieram de plataforma. Ordem de vencimento: o pagamento quita primeiro
 * a parcela mais antiga, que é como o cliente e a agência entendem a conta.
 */
export function planoDeUnificacao(
  contasDaVenda: readonly ContaDaVenda[],
  totalPlataforma: number,
): PlanoDeUnificacao {
  const elegiveis = contasDaVenda
    .filter(c => TOCAVEL.has(String(c.status ?? '')) && !c.plataforma_transacao)
    .sort((a, b) => String(a.data_vencimento).localeCompare(String(b.data_vencimento)) || a.id.localeCompare(b.id));

  let sobra = round2(Math.max(0, num(totalPlataforma)));
  let consumido = 0;
  let restante = 0;
  const acoes: AcaoNaConta[] = [];

  for (const c of elegiveis) {
    const valor = round2(Math.max(0, num(c.valor_final)));
    if (valor <= 0) continue;
    if (sobra <= 0) { restante = round2(restante + valor); continue; }
    if (sobra >= valor) {
      acoes.push({ id: c.id, acao: 'CANCELAR', valor_original: valor });
      sobra = round2(sobra - valor);
      consumido = round2(consumido + valor);
    } else {
      const novo = round2(valor - sobra);
      acoes.push({ id: c.id, acao: 'REDUZIR', valor_original: valor, valor_novo: novo });
      consumido = round2(consumido + sobra);
      restante = round2(restante + novo);
      sobra = 0;
    }
  }

  return { acoes, consumido, excedente: sobra, restante };
}

/** O carimbo gravado na conta tocada, para a unificação poder ser desfeita. */
export interface CarimboDeSubstituicao {
  plataforma: string;
  id_transacao: string;
  acao: 'CANCELAR' | 'REDUZIR';
  valor_original: number;
  status_original: string;
}

export function carimbo(
  a: AcaoNaConta,
  plataforma: string,
  idTransacao: string,
  statusOriginal: string,
): CarimboDeSubstituicao {
  return {
    plataforma,
    id_transacao: idTransacao,
    acao: a.acao,
    valor_original: a.valor_original,
    status_original: statusOriginal,
  };
}

/** A frase que a tela mostra antes de confirmar. Números, não adjetivos. */
export function descreverPlano(p: PlanoDeUnificacao, totalPlataforma: number, fmt: (v: number) => string): string {
  const canceladas = p.acoes.filter(a => a.acao === 'CANCELAR').length;
  const reduzidas = p.acoes.filter(a => a.acao === 'REDUZIR').length;
  const partes: string[] = [];
  if (canceladas > 0) partes.push(`${canceladas} ${canceladas === 1 ? 'conta pendente da venda será substituída' : 'contas pendentes da venda serão substituídas'} por este recebimento`);
  if (reduzidas > 0) partes.push(`${reduzidas === 1 ? 'uma conta terá' : `${reduzidas} contas terão`} o valor reduzido ao que ainda falta`);
  if (p.acoes.length === 0) partes.push('a venda não tem conta pendente para substituir');
  if (p.restante > 0) partes.push(`ficam ${fmt(p.restante)} a receber`);
  if (p.excedente > 0) partes.push(`a plataforma recebeu ${fmt(p.excedente)} além do que a venda previa`);
  return `${fmt(totalPlataforma)} recebidos: ${partes.join('; ')}.`;
}
