import { createCrudHandlers } from '@/lib/crud-api';

// somenteFinanceiro: transferência entre contas bancárias é operação de
// tesouraria, e o perfil VENDEDOR não acessa o financeiro.
// protegerBaixa: criar já EFETIVADA não move saldo nenhum, mas a exclusão
// estorna as duas pernas — inventando dinheiro na origem e destruindo no
// destino. Efetivar é operação do PUT, que roda em transação.
export const { GET, POST } = createCrudHandlers(
  'transferencias',
  ['conta_origem_id', 'conta_destino_id', 'status'],
  { somenteFinanceiro: true, protegerBaixa: true },
);
