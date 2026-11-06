import { createCrudHandlers } from '@/lib/crud-api';
import { num, round2 } from '@/lib/money';
import pool from '@/lib/db';
import { garantirAberturaDaConta } from '@/lib/razao-servidor';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { moedaDe } from '@/lib/cambio';

// Saldo atual é calculado pelo servidor (baixas, transferências, recálculo).
// No cadastro, nasce igual ao saldo inicial; na regravação, o valor do banco
// prevalece (ver sqlPreservarDerivados). Auditoria 04/11, FIN2-01.
//
// Conta criada depois da abertura do razão (05/11/2026): o saldo de partida
// dela entra no razão uma vez só. Nunca derruba o cadastro.
export const { GET, POST } = createCrudHandlers('contas_bancarias', ['nome', 'banco'], {
  somenteFinanceiro: true,
  // Contas liberadas por perfil de acesso (05/11/2026); sem restrição, todas.
  filtroDeConta: { cadastro: true },
  // Conta disponível por empresa (E7): a dela e as marcadas como disponíveis.
  filtroDeEmpresa: { tipo: 'conta_bancaria' },
  // Moeda da conta (05/11/2026, E6): ausente ou desconhecida = real, como
  // sempre. O saldo da conta fica na moeda dela; a moeda não muda depois que
  // a conta tem movimento (gatilho fin_moeda_da_conta_fixa).
  normalizarCadastro: item => {
    item.saldo_atual = round2(num(item.saldo_inicial));
    item.moeda = moedaDe(item.moeda);
  },
  aposGravar: async (tenantId, item) => {
    if (!pool || typeof item.id !== 'string') return;
    await garantirAberturaDaConta(pool as unknown as ExecutorSQL, tenantId, item.id);
  },
});
