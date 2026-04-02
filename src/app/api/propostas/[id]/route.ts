import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('propostas', ['numero', 'cliente_id', 'vendedor_id', 'status']);
