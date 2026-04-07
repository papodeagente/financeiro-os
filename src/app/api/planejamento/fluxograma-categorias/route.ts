import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('fluxograma_categorias', ['nome', 'ordem']);
