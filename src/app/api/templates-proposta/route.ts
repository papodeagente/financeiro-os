import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('templates_proposta', ['nome']);
