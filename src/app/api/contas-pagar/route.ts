import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('contas_pagar', ['fornecedor_id', 'status']);
