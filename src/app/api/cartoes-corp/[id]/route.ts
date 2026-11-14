import { createCrudItemHandlers } from '@/lib/crud-api';
import { moverFaturasAbertasDoCartao } from '@/lib/empresas-servidor';

// Várias empresas (E7): trocar a empresa da fatura leva as compras em aberto.
export const { GET, PUT, DELETE } = createCrudItemHandlers(
  'cartoes_corp',
  ['apelido', 'bandeira'],
  { somenteFinanceiro: true, filtroDeEmpresa: { tipo: 'registro' }, aposGravar: moverFaturasAbertasDoCartao },
);
