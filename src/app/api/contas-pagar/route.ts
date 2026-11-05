import { createCrudHandlers } from '@/lib/crud-api';
import { prepararDimensoesDaConta } from '@/lib/dimensoes';

// protegerBaixa: criar direto como PAGO deixaria o saldo sem o débito e o
// estorno da exclusão CRIARIA dinheiro. Baixa é operação do PUT.
export const { GET, POST } = createCrudHandlers(
  'contas_pagar',
  ['fornecedor_id', 'status'],
  {
    somenteFinanceiro: true, protegerBaixa: true, validarCadastro: prepararDimensoesDaConta,
    // Pago numa conta não liberada para a pessoa: some da lista (05/11/2026).
    filtroDeConta: { campos: ['conta_bancaria_id'], soBaixados: true },
  },
);
