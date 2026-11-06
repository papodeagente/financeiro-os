import { createCrudHandlers } from '@/lib/crud-api';
import { num, round2 } from '@/lib/money';
import pool from '@/lib/db';
import { garantirAberturaDaConta } from '@/lib/razao-servidor';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { conferirMoedaDoCadastro } from '@/lib/moedas';
import { lerCatalogoDaAgencia } from '@/lib/moedas-servidor';
import { normalizarDadosDaConta } from '@/lib/contas-bancarias-dados';

// Saldo atual é calculado pelo servidor (baixas, transferências, recálculo).
// No cadastro, nasce igual ao saldo inicial; na regravação, o valor do banco
// prevalece (ver sqlPreservarDerivados). Auditoria 04/11, FIN2-01.
//
// Conta criada depois da abertura do razão (05/11/2026): o saldo de partida
// dela entra no razão uma vez só. Nunca derruba o cadastro.
//
// A lista devolve TODAS as contas, inclusive as desativadas (06/11/2026):
// relatórios e extrato continuam com elas; os seletores de lançar, pagar e
// receber escondem as desativadas (contasParaEscolher).
export const { GET, POST } = createCrudHandlers('contas_bancarias', ['nome', 'banco'], {
  somenteFinanceiro: true,
  // Contas liberadas por perfil de acesso (05/11/2026); sem restrição, todas.
  filtroDeConta: { cadastro: true },
  // Aviso de edição simultânea (06/11/2026): cada conta lida leva `_versao`.
  versao: true,
  // Conta disponível por empresa (E7): a dela e as marcadas como disponíveis.
  filtroDeEmpresa: { tipo: 'conta_bancaria' },
  // Moeda da conta (05/11/2026, E6): ausente = real, como sempre. O saldo da
  // conta fica na moeda dela; a moeda não muda depois que a conta tem
  // movimento (gatilho fin_moeda_da_conta_fixa).
  normalizarCadastro: item => {
    item.saldo_atual = round2(num(item.saldo_inicial));
  },
  // Titular, dígitos e banco da lista oficial (06/11/2026).
  validarCadastro: normalizarDadosDaConta,
  // Moeda do catálogo da agência (E7, frente D): as oito do sistema e as que
  // ela cadastrou. Código desconhecido é recusado (antes virava real calado).
  conferirNoServidor: async (tenantId, item) => {
    if (!pool) return null;
    const r = conferirMoedaDoCadastro(item.moeda, await lerCatalogoDaAgencia(pool as unknown as ExecutorSQL, tenantId));
    if ('erro' in r) return r.erro;
    item.moeda = r.moeda;
    return null;
  },
  aposGravar: async (tenantId, item) => {
    if (!pool || typeof item.id !== 'string') return;
    await garantirAberturaDaConta(pool as unknown as ExecutorSQL, tenantId, item.id);
  },
});
