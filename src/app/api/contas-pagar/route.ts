import { createCrudHandlers } from '@/lib/crud-api';

// protegerBaixa: criar direto como PAGO deixaria o saldo sem o débito e o
// estorno da exclusão CRIARIA dinheiro. Baixa é operação do PUT.
export const { GET, POST } = createCrudHandlers(
  'contas_pagar',
  ['fornecedor_id', 'status'],
  { protegerBaixa: true },
);
