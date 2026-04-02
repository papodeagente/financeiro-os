import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('comissoes', ['venda_id', 'vendedor_id', 'status']);
