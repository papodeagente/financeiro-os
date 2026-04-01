import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('vendas_crm', ['cliente_id', 'vendedor_id', 'status']);
