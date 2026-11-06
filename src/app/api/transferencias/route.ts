import { createCrudHandlers } from '@/lib/crud-api';

// somenteFinanceiro: transferência entre contas bancárias é operação de
// tesouraria, e o perfil VENDEDOR não acessa o financeiro.
// protegerBaixa: criar já EFETIVADA não move saldo nenhum, mas a exclusão
// estorna as duas pernas — inventando dinheiro na origem e destruindo no
// destino. Efetivar é operação do PUT, que roda em transação.
export const { GET, POST } = createCrudHandlers(
  'transferencias',
  ['conta_origem_id', 'conta_destino_id', 'status'],
  {
    somenteFinanceiro: true, protegerBaixa: true,
    // Transferência que toca conta não liberada não aparece (05/11/2026).
    filtroDeConta: { campos: ['conta_origem_id', 'conta_destino_id'] },
    // Nº do cheque (06/11/2026): opcional, só números.
    validarCadastro: item => {
      if (item.cheque_numero === undefined || item.cheque_numero === null || item.cheque_numero === '') return null;
      const n = String(item.cheque_numero).trim();
      if (!/^\d{1,20}$/.test(n)) return 'O número do cheque tem só números (até 20).';
      item.cheque_numero = n;
      return null;
    },
    // Aparece em quem vê alguma das duas contas (E7).
    filtroDeEmpresa: { tipo: 'por_conta', campos: ['conta_origem_id', 'conta_destino_id'] },
  },
);
