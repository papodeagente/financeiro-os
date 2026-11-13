import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('cenarios_cac', ['nome', 'mes_referencia']);
