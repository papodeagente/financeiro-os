import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('contas_bancarias', ['nome', 'banco']);
