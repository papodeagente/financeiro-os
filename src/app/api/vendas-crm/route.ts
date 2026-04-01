import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('vendas_crm', ['cliente_id', 'vendedor_id', 'status']);
