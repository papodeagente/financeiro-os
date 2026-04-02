import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('comissoes', ['venda_id', 'vendedor_id', 'status']);
