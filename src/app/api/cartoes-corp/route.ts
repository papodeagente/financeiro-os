import { createCrudHandlers } from '@/lib/crud-api';

// Cartão corporativo carrega limite e fatura da empresa.
export const { GET, POST } = createCrudHandlers(
  'cartoes_corp',
  ['apelido', 'bandeira'],
  { somenteFinanceiro: true },
);
