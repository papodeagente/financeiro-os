import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('clientes', ['nome', 'cpf_cnpj', 'tipo']);
