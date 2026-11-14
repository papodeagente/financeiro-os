/**
 * Taxa de boleto repassada ao cliente (E7, 06/11/2026). Puro.
 *
 * Como o dinheiro anda (o efeito no resultado, sem contar nada duas vezes):
 *   1. Na emissão: o cliente marcado "Repassar a taxa do boleto" recebe o boleto
 *      com o saldo da conta + a taxa da agência (Configurações › Cobrança).
 *      A conta a receber NÃO muda: a venda, a fatura e a comissão continuam
 *      vendo o mesmo valor. A cobrança guarda `dados.taxa_boleto_centavos`.
 *   2. No pagamento: o que entrou se divide. A conta da venda é baixada pelo
 *      valor dela (com a taxa do provedor, como sempre); a parte da taxa
 *      vira uma conta a receber PRÓPRIA, já recebida, na categoria de taxa
 *      de cobrança (origem OUTROS, `taxa_boleto_de`). No resultado ela
 *      aparece como outra receita, ao lado da despesa da taxa do provedor:
 *      a agência vê quanto gastou com boleto e quanto o cliente devolveu.
 *   3. Pagou a menos: primeiro a conta da venda; a taxa só com o que sobrar.
 * Só boleto (com ou sem Pix). Pix puro, link e carnê não levam taxa.
 */
import type { TipoCobranca } from './tipos';

export function levaTaxaDeBoleto(tipo: TipoCobranca | string, taxaCentavos: number, clienteMarcado: boolean | undefined): boolean {
  return clienteMarcado === true && taxaCentavos > 0 && (tipo === 'boleto' || tipo === 'boleto_pix');
}

/**
 * Divide o que o cliente pagou entre a conta (o valor da cobrança sem a
 * taxa) e a taxa de boleto. Tudo em centavos.
 */
export function dividirPagamento(pagoCentavos: number, cobrancaCentavos: number, taxaCentavos: number): { conta: number; taxa: number } {
  const pago = Math.max(0, Math.round(pagoCentavos));
  const taxa = Math.max(0, Math.round(taxaCentavos));
  if (taxa <= 0) return { conta: pago, taxa: 0 };
  const daConta = Math.max(0, Math.round(cobrancaCentavos) - taxa);
  const taxaPaga = Math.min(taxa, Math.max(0, pago - daConta));
  return { conta: pago - taxaPaga, taxa: taxaPaga };
}

/** Id fixo da conta da taxa: o mesmo aviso repetido nunca cria outra. */
export function idDaContaDaTaxa(cobrancaId: string): string {
  return `taxa-boleto-${cobrancaId}`;
}
