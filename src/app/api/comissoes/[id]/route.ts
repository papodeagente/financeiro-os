import { createCrudItemHandlers } from '@/lib/crud-api';
import { sincronizarContaDaComissao } from '@/lib/comissao-conta';
import type { ComissaoVenda } from '@/lib/crm-types';

export const { GET, PUT, DELETE } = createCrudItemHandlers('comissoes', ['venda_id', 'vendedor_id', 'status'], {
  aposGravar: (tenantId, item) => sincronizarContaDaComissao(tenantId, item as unknown as ComissaoVenda).then(() => undefined),
});
