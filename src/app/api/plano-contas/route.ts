import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('plano_contas', ['codigo', 'descricao', 'tipo']);
