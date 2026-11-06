import { createCrudHandlers } from '@/lib/crud-api';
import { validarCadastroDoTitulo } from '@/lib/rota-do-titulo';

// protegerBaixa: o POST não movimenta caixa (só o PUT movimenta). Criar uma
// conta já RECEBIDA por aqui deixaria o saldo sem a entrada e, ao excluí-la,
// o estorno destruiria dinheiro que nunca entrou.
export const { GET, POST } = createCrudHandlers(
  'contas_receber',
  ['venda_id', 'cliente_id', 'status'],
  {
    somenteFinanceiro: true, protegerBaixa: true, validarCadastro: validarCadastroDoTitulo('contas_receber'),
    // Aviso de edição simultânea (06/11/2026): cada conta lida leva `_versao`.
    versao: true,
    // Recebido numa conta não liberada para a pessoa: some da lista (05/11/2026).
    filtroDeConta: { campos: ['conta_bancaria_id'], soBaixados: true },
    // Lançar numa conta que a pessoa só vê é recusado (E7).
    contasDaGravacao: { campos: ['conta_bancaria_id'] },
    // Várias empresas (E7): só as empresas marcadas e liberadas; rateio entre
    // empresas aparece em cada empresa que ele toca.
    filtroDeEmpresa: { tipo: 'registro' },
  },
);
