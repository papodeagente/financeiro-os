import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('metas', ['vendedor_id', 'mes_referencia']);
