/**
 * A comissão que o fornecedor deve à agência (origem COMISSAO_FORNECEDOR), dita
 * para quem olha a lista de contas a receber: de qual venda ela é e quanto o
 * cliente pagou direto ao fornecedor. É a ponte entre "o que foi pago ao
 * fornecedor" e "o que ele deve de volta" (Bruno, 09/10/2026).
 */
import type { ContaReceber } from './crm-types';
import { formatBRL } from './utils';
import { num } from './money';

export function ehComissaoDeFornecedor(c: Pick<ContaReceber, 'origem'>): boolean {
  return c.origem === 'COMISSAO_FORNECEDOR';
}

/** "Venda de Ana Souza: pagou R$ 390,63 direto ao fornecedor." ou null quando não é comissão. */
export function fraseDaComissao(
  c: Pick<ContaReceber, 'origem' | 'cliente_da_venda_nome' | 'valor_pago_direto'>,
): string | null {
  if (!ehComissaoDeFornecedor(c)) return null;
  const cliente = (c.cliente_da_venda_nome || '').trim();
  const pago = num(c.valor_pago_direto);
  if (cliente && pago > 0) return `Venda de ${cliente}: pagou ${formatBRL(pago)} direto ao fornecedor.`;
  if (cliente) return `Venda de ${cliente}.`;
  if (pago > 0) return `O cliente pagou ${formatBRL(pago)} direto ao fornecedor.`;
  return null;
}
