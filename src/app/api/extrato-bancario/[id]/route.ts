import { createCrudItemHandlers } from '@/lib/crud-api';

export const { GET, PUT, DELETE } = createCrudItemHandlers(
  'extrato_bancario',
  ['conta_bancaria_id', 'status_conciliacao'],
  // Linha de conta não liberada não se abre (05/11/2026).
  { somenteFinanceiro: true, filtroDeConta: { campos: ['conta_bancaria_id'] }, filtroDeEmpresa: { tipo: 'por_conta', campos: ['conta_bancaria_id'] } },
);
