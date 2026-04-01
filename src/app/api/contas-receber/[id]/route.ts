import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('contas_receber', ['venda_id', 'cliente_id', 'status']);
