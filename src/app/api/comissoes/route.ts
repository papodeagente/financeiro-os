import { createCrudHandlers } from '@/lib/crud-api';
import { sincronizarContaDaComissao } from '@/lib/comissao-conta';
import type { ComissaoVenda } from '@/lib/crm-types';

/**
 * Toda comissão gravada vira (ou atualiza) a sua conta a pagar, na próxima
 * data da agenda de pagamento. Ver src/lib/comissao-conta.ts.
 */
export const { GET, POST } = createCrudHandlers('comissoes', ['venda_id', 'vendedor_id', 'status'], {
  aposGravar: (tenantId, item) => sincronizarContaDaComissao(tenantId, item as unknown as ComissaoVenda).then(() => undefined),
});
