import { createCrudHandlers } from '@/lib/crud-api';
import { moverFaturasAbertasDoCartao } from '@/lib/empresas-servidor';

// Cartão corporativo carrega limite e fatura da empresa.
// Várias empresas (E7): `empresa_id` é a empresa em que a fatura nasce; ao
// trocar, as compras ainda em aberto vão junto para a nova empresa.
export const { GET, POST } = createCrudHandlers(
  'cartoes_corp',
  ['apelido', 'bandeira'],
  { somenteFinanceiro: true, filtroDeEmpresa: { tipo: 'registro' }, aposGravar: moverFaturasAbertasDoCartao },
);
