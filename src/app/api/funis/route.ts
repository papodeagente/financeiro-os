import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('funis', ['nome', 'status']);
