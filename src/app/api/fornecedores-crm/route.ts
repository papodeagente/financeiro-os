import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('fornecedores_crm', ['nome_fantasia', 'cnpj', 'categoria']);
