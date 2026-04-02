import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('planos_comissao', ['nome']);
