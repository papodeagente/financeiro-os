import { createCrudHandlers } from '@/lib/crud-api';
import { validarCadastroDoTitulo } from '@/lib/rota-do-titulo';

// protegerBaixa: criar direto como PAGO deixaria o saldo sem o débito e o
// estorno da exclusão CRIARIA dinheiro. Baixa é operação do PUT.
export const { GET, POST } = createCrudHandlers(
  'contas_pagar',
  ['fornecedor_id', 'status'],
  {
    somenteFinanceiro: true, protegerBaixa: true, validarCadastro: validarCadastroDoTitulo('contas_pagar'),
    // Aviso de edição simultânea (06/11/2026): cada conta lida leva `_versao`.
    versao: true,
    // Pago numa conta não liberada para a pessoa: some da lista (05/11/2026).
    filtroDeConta: { campos: ['conta_bancaria_id'], soBaixados: true },
  },
);
