import { createCrudHandlers } from '@/lib/crud-api';
import { prepararDimensoesDaConta } from '@/lib/dimensoes';

// protegerBaixa: o POST não movimenta caixa (só o PUT movimenta). Criar uma
// conta já RECEBIDA por aqui deixaria o saldo sem a entrada e, ao excluí-la,
// o estorno destruiria dinheiro que nunca entrou.
export const { GET, POST } = createCrudHandlers(
  'contas_receber',
  ['venda_id', 'cliente_id', 'status'],
  {
    somenteFinanceiro: true, protegerBaixa: true, validarCadastro: prepararDimensoesDaConta,
    // Recebido numa conta não liberada para a pessoa: some da lista (05/11/2026).
    filtroDeConta: { campos: ['conta_bancaria_id'], soBaixados: true },
  },
);
