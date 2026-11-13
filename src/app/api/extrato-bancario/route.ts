import { createCrudHandlers } from '@/lib/crud-api';

// Extrato bancário é dado de tesouraria: só perfis com acesso ao financeiro.
export const { GET, POST } = createCrudHandlers(
  'extrato_bancario',
  ['conta_bancaria_id', 'status_conciliacao'],
  { somenteFinanceiro: true },
);
