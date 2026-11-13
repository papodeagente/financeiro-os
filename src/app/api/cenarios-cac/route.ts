import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('cenarios_cac', ['nome', 'mes_referencia']);
