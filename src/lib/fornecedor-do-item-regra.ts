/**
 * Quando a conta a pagar de um item da Cotação acabou de ganhar o fornecedor
 * (ver fornecedor-do-item.ts). Puro, sem banco: os testes importam daqui.
 */
type Dados = Record<string, unknown>;

/** Os itens do CRM da conta, quando ela acabou de ganhar o fornecedor. */
export function deveAvisarOCrm(antes: Dados, depois: Dados): number[] | null {
  if (antes.fornecedor_pendente !== true) return null;
  if (depois.fornecedor_pendente === true) return null;
  const fornecedor = String(depois.fornecedor_id ?? '').trim();
  if (!fornecedor) return null;
  const bruto = Array.isArray(depois.crm_item_ids) ? depois.crm_item_ids : Array.isArray(antes.crm_item_ids) ? antes.crm_item_ids : [];
  const ids = (bruto as unknown[]).map(Number).filter(x => Number.isInteger(x) && x > 0);
  return ids.length ? ids : null;
}
