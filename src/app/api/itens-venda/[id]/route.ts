import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('itens_venda', ['venda_id', 'fornecedor_id', 'status']);
