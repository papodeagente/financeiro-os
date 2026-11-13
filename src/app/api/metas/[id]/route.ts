import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('metas', ['vendedor_id', 'mes_referencia']);
