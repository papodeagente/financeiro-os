import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('fluxogramas', ['nome', 'categoria_id']);
