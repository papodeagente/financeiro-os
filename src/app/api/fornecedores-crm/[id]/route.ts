import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('fornecedores_crm', ['nome_fantasia', 'cnpj', 'categoria']);
