import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('propostas', ['numero', 'cliente_id', 'vendedor_id', 'status']);
