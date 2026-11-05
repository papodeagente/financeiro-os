import { createCrudHandlers } from '@/lib/crud-api';
import { num, round2 } from '@/lib/money';

// Saldo atual é calculado pelo servidor (baixas, transferências, recálculo).
// No cadastro, nasce igual ao saldo inicial; na regravação, o valor do banco
// prevalece (ver sqlPreservarDerivados). Auditoria 04/11, FIN2-01.
export const { GET, POST } = createCrudHandlers('contas_bancarias', ['nome', 'banco'], {
  somenteFinanceiro: true,
  normalizarCadastro: item => { item.saldo_atual = round2(num(item.saldo_inicial)); },
});
