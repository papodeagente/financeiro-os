import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('contas_receber', ['venda_id', 'cliente_id', 'status']);
