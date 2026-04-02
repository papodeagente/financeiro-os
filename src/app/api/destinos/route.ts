import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('destinos', ['nome', 'pais']);
