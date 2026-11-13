import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('plano_contas', ['codigo', 'descricao', 'tipo']);
