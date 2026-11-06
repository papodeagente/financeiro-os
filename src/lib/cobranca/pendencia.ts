/**
 * Pendência da baixa automática (E7, 06/11/2026). Puro.
 *
 * Quando o provedor avisa um pagamento e a baixa da conta não entra sozinha
 * (a conta foi baixada à mão antes, foi cancelada, mudou de valor...), a
 * cobrança fica "paga" no provedor e a conta continua como estava. O aviso
 * guarda o pagamento em `dados.pendencia_pagamento` e a frase em
 * `dados.pendencia`. Uma pessoa escolhe o que fazer:
 *
 *   · corrigir  — dar a baixa agora, com o valor, a data e a conta do aviso
 *                 (pelo porteiro de sempre: direito, conta, alçada e limites);
 *   · credito   — guardar como crédito do cliente (carteira da E5): a sobra,
 *                 quando a conta ainda tem saldo; o pagamento inteiro, quando
 *                 a conta já está fechada ou cancelada;
 *   · ignorar   — o pagamento já está lançado de outro jeito; registra o
 *                 motivo e tira a marca.
 */
import { deCentavos } from '../money';
import { dividirPagamento } from './taxa-boleto';

export type EscolhaDaPendencia = 'corrigir' | 'credito' | 'ignorar';
export type TipoDaPendencia = 'pagamento' | 'estorno' | 'devolucao_parcial';

export const MOTIVO_MINIMO = 10;

/** O pagamento que o aviso trouxe e não entrou (centavos; data AAAA-MM-DD). */
export interface PagamentoDaPendencia {
  valor_centavos: number;
  /** Taxa do provedor (bruto − líquido). */
  taxa_centavos: number;
  juros: number;
  desconto: number;
  data: string;
  conta_bancaria_id: string | null;
  forma: string;
  id_pagamento: string;
}

export interface ContaDaPendencia {
  status: string;
  /** Saldo em aberto, em reais. */
  saldo: number;
  cliente_id: string;
}

export interface OpcaoDaPendencia {
  pode: boolean;
  /** O que acontece (quando pode) ou por que não dá. */
  frase: string;
  /** Crédito que nasce, em reais (só na escolha "credito"). */
  credito?: number;
  /** Quanto entra na conta bancária, em reais. */
  entra?: number;
}

export interface PlanoDaPendencia {
  tipo: TipoDaPendencia;
  pagamento: PagamentoDaPendencia | null;
  /** Do pagamento: a parte da conta e a da taxa de boleto (centavos). */
  divisao: { conta: number; taxa_boleto: number };
  conta_aberta: boolean;
  escolhas: Record<EscolhaDaPendencia, OpcaoDaPendencia>;
}

const brl = (centavos: number) => deCentavos(centavos).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

export function lerPagamentoDaPendencia(v: unknown): PagamentoDaPendencia | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const valor = Math.round(Number(p.valor_centavos ?? 0));
  if (!(valor > 0)) return null;
  return {
    valor_centavos: valor,
    taxa_centavos: Math.max(0, Math.round(Number(p.taxa_centavos ?? 0))),
    juros: Math.max(0, Number(p.juros ?? 0)) || 0,
    desconto: Math.max(0, Number(p.desconto ?? 0)) || 0,
    data: String(p.data ?? '').slice(0, 10),
    conta_bancaria_id: typeof p.conta_bancaria_id === 'string' && p.conta_bancaria_id ? p.conta_bancaria_id : null,
    forma: String(p.forma ?? 'Boleto') || 'Boleto',
    id_pagamento: String(p.id_pagamento ?? ''),
  };
}

export function tipoDaPendencia(v: unknown): TipoDaPendencia {
  return v === 'estorno' || v === 'devolucao_parcial' ? v : 'pagamento';
}

/**
 * O que cada escolha faria. `cobranca` em centavos; `conta` com o saldo em
 * reais (null = a conta a receber não existe mais).
 */
export function planejarPendencia(
  cobranca: { valor_centavos: number; dados: Record<string, unknown> },
  conta: ContaDaPendencia | null,
): PlanoDaPendencia {
  const tipo = tipoDaPendencia(cobranca.dados.pendencia_tipo);
  const pagamento = lerPagamentoDaPendencia(cobranca.dados.pendencia_pagamento);
  const taxaBoleto = Math.max(0, Math.round(Number(cobranca.dados.taxa_boleto_centavos ?? 0)));
  const divisao = pagamento
    ? (() => { const d = dividirPagamento(pagamento.valor_centavos, cobranca.valor_centavos, taxaBoleto); return { conta: d.conta, taxa_boleto: d.taxa }; })()
    : { conta: 0, taxa_boleto: 0 };
  const aberta = Boolean(conta) && conta!.status !== 'CANCELADO' && conta!.status !== 'RECEBIDO' && conta!.saldo > 0.005;
  const ignorar: OpcaoDaPendencia = {
    pode: true,
    frase: 'Tira a marca sem lançar nada. Use quando o pagamento já está lançado de outro jeito; o motivo fica no histórico.',
  };
  if (tipo !== 'pagamento' || !pagamento) {
    const porque = tipo === 'estorno'
      ? 'O provedor avisou um estorno: desfaça a baixa na conta a receber e marque aqui como resolvida.'
      : tipo === 'devolucao_parcial'
        ? 'O provedor devolveu parte do valor: lance o ajuste na conta a receber e marque aqui como resolvida.'
        : 'O aviso não trouxe o valor do pagamento. Dê a baixa na conta a receber e marque aqui como resolvida.';
    const nao = { pode: false, frase: porque };
    return { tipo, pagamento, divisao, conta_aberta: aberta, escolhas: { corrigir: nao, credito: nao, ignorar } };
  }

  const pagoConta = divisao.conta;
  const taxaFrase = divisao.taxa_boleto > 0 ? ` A taxa de boleto (${brl(divisao.taxa_boleto)}) entra à parte, na categoria de taxa de cobrança.` : '';
  const saldoCentavos = conta ? Math.max(0, Math.round(conta.saldo * 100)) : 0;
  const entra = deCentavos(pagamento.valor_centavos - pagamento.taxa_centavos);

  let corrigir: OpcaoDaPendencia;
  if (!conta) corrigir = { pode: false, frase: 'A conta a receber desta cobrança não existe mais. Guarde como crédito ou marque como resolvida.' };
  else if (conta.status === 'CANCELADO') corrigir = { pode: false, frase: 'A conta foi cancelada. Guarde o pagamento como crédito do cliente ou marque como resolvida.' };
  else if (!aberta) corrigir = { pode: false, frase: 'A conta já está recebida. Se o cliente pagou duas vezes, guarde como crédito; se a baixa à mão foi este pagamento, marque como resolvida.' };
  else {
    const resto = pagoConta - saldoCentavos;
    const depois = resto > 0
      ? ` A sobra de ${brl(resto)} entra como acréscimo (juros).`
      : resto < 0 ? ` A conta fica em parte: faltam ${brl(-resto)}.` : ' A conta fica recebida.';
    corrigir = {
      pode: true, entra,
      frase: `Dá a baixa de ${brl(pagoConta)} com a data do pagamento (${dataBR(pagamento.data)}) e a taxa do provedor.${depois}${taxaFrase}`,
    };
  }

  let credito: OpcaoDaPendencia;
  if (!conta?.cliente_id) credito = { pode: false, frase: 'A conta não está ligada a um cliente cadastrado: não há carteira onde guardar o crédito.' };
  else if (aberta) {
    const sobra = pagoConta - saldoCentavos;
    credito = sobra > 0
      ? { pode: true, entra, credito: deCentavos(sobra), frase: `Dá a baixa da conta (${brl(saldoCentavos)}) e guarda a sobra de ${brl(sobra)} como crédito do cliente, para usar numa próxima venda.${taxaFrase}` }
      : { pode: false, frase: 'Não sobra nada: o pagamento não passa do que falta na conta. Use "Corrigir a baixa".' };
  } else {
    credito = {
      pode: true, entra, credito: deCentavos(pagoConta),
      frase: `Registra a entrada de ${brl(pagamento.valor_centavos)} na conta bancária e guarda ${brl(pagoConta)} como crédito do cliente, para usar numa próxima venda.${taxaFrase}`,
    };
  }
  return { tipo, pagamento, divisao, conta_aberta: aberta, escolhas: { corrigir, credito, ignorar } };
}

export function conferirMotivo(escolha: EscolhaDaPendencia, motivo: unknown): string | null {
  const m = String(motivo ?? '').trim();
  if (escolha === 'ignorar' && m.replace(/\s/g, '').length < MOTIVO_MINIMO) return `Diga por que (pelo menos ${MOTIVO_MINIMO} letras): o motivo fica no histórico da cobrança.`;
  return null;
}
