/**
 * Regra do custo (Bruno, 2026-09-08):
 *
 *   "No CRM deve pegar os dados de: preço de venda e preço de custo.
 *    A margem é a diferença. Apenas essa regra."
 *   Conta a pagar só nasce quando existe fornecedor real a quem pagar.
 *
 * Estes testes travam as duas metades dessa regra:
 *  1. sem fornecedor identificado NÃO existe conta a pagar;
 *  2. o custo continua valendo para a margem mesmo assim.
 *
 * Contexto do incidente: uma venda importada do CRM sem detalhamento de
 * fornecedor gerava "Custo OUTROS — Venda crm_deal_X — fornecedor(es) a
 * detalhar", com o custo de referência do cadastro do produto. Era uma dívida
 * que ninguém iria receber, e ela entrava no contas a pagar, no fluxo de caixa
 * e no caixa livre.
 *
 * Roda com: node --experimental-strip-types scripts/test-custo-fornecedor-real.ts
 */
import { gerarContasVenda } from '../src/lib/venda-financeiro.ts';
import { calcularResultado } from '../src/lib/resultado-financeiro.ts';
import { round2 } from '../src/lib/money.ts';

let falhas = 0;
let total = 0;

function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

type Any = Record<string, unknown>;

function item(over: Any = {}): Any {
  const { data: dataOver, ...resto } = over;
  return {
    id: 'item-' + Math.random().toString(36).slice(2, 8),
    venda_id: 'v1',
    fornecedor_id: 'f1',
    sequencia: 1,
    status: 'ativo',
    ...resto,
    data: {
      tipo: 'AEREO',
      descricao: 'Passagem',
      fornecedor_nome: 'CVC',
      meio_pagamento: 'proprio',
      valor_venda: 1000,
      valor_custo: 800,
      comissao_valor: 0,
      comissao_percentual: 0,
      moeda: 'BRL',
      cambio: 1,
      ...((dataOver as Any) || {}),
    },
  };
}

function venda(over: Any = {}): Any {
  return {
    id: 'v1',
    numero: 'VND-0001',
    cliente_id: 'c1',
    grupo_id: null,
    data_venda: '2026-09-08',
    desconto: 0,
    parcelas: 1,
    centro_custo: '',
    ...over,
  };
}

const gerar = (itens: Any[], fornecedores: Any[] = [{ id: 'f1', nome_fantasia: 'CVC', regras_faturamento: {} }]) =>
  gerarContasVenda({
    venda: venda() as never,
    itens: itens as never,
    fornecedores: fornecedores as never,
    cliente_nome: 'Cliente',
  });

// ══════════════════════════════════════════════════════════════════════
console.log('--- com fornecedor real: conta a pagar continua nascendo ---');
{
  const r = gerar([item({ data: { valor_venda: 1000, valor_custo: 800 } })]);
  eq(r.contas_pagar.length, 1, 'uma conta a pagar para o fornecedor');
  eq(r.contas_pagar[0].valor_final, 800, 'valor do custo');
  eq(r.contas_pagar[0].fornecedor_nome, 'CVC', 'fornecedor identificado');
  eq(r.contas_receber.length, 1, 'conta a receber do cliente');
  eq(r.resumo.total_custos, 800, 'custo entra no resumo');
  eq(r.resumo.lucro_previsto, 200, 'margem é venda menos custo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o incidente: sem fornecedor, sem conta a pagar ---');
{
  // Shape exato do item que o webhook cria quando o CRM não detalha
  // fornecedor: fornecedor_id vazio, fornecedor_nome vazio, tipo OUTROS.
  const r = gerar(
    [item({
      fornecedor_id: '',
      data: {
        tipo: 'OUTROS',
        descricao: 'Venda crm_deal_1106233 — fornecedor(es) a detalhar',
        fornecedor_nome: '',
        valor_venda: 15997,
        valor_custo: 1300,
      },
    })],
    [],
  );
  eq(r.contas_pagar.length, 0, 'NENHUMA conta a pagar sem fornecedor');
  eq(r.contas_receber.length, 1, 'a conta a receber do cliente continua');
  eq(r.contas_receber[0].valor_final, 15997, 'cliente deve o valor da venda');

  // A metade que não pode se perder: o custo continua na margem.
  eq(r.resumo.total_custos, 1300, 'custo continua contando');
  eq(r.resumo.total_cliente, 15997, 'venda registrada');
  eq(r.resumo.lucro_previsto, 14697, 'margem é venda menos custo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- custo zero não vira dívida de R$ 0,00 ---');
{
  const r = gerar([item({ data: { valor_venda: 500, valor_custo: 0 } })]);
  eq(r.contas_pagar.length, 0, 'sem conta a pagar de valor zero');
  eq(r.contas_receber.length, 1, 'conta a receber normal');
  eq(r.resumo.lucro_previsto, 500, 'venda inteira é margem');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- venda mista: só o item com fornecedor gera dívida ---');
{
  const r = gerar([
    item({ sequencia: 1, data: { descricao: 'Hotel', fornecedor_nome: 'Ibis', valor_venda: 4000, valor_custo: 3000 } }),
    item({ sequencia: 2, fornecedor_id: '', data: { tipo: 'OUTROS', descricao: 'a detalhar', fornecedor_nome: '', valor_venda: 2000, valor_custo: 900 } }),
  ]);
  eq(r.contas_pagar.length, 1, 'uma conta a pagar, do hotel');
  eq(r.contas_pagar[0].valor_final, 3000, 'só o custo do hotel vira dívida');
  eq(r.resumo.total_custos, 3900, 'a margem considera os dois custos');
  eq(r.resumo.total_cliente, 6000, 'cliente paga os dois itens');
  eq(r.resumo.lucro_previsto, 2100, 'margem = 6000 menos 3900');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- fornecedor identificado só pelo nome também gera dívida ---');
{
  // Sem cadastro no CRM (fornecedor_id vazio) mas com nome digitado: existe
  // alguém a quem pagar, então a conta nasce.
  const r = gerar(
    [item({ fornecedor_id: '', data: { fornecedor_nome: 'Pousada do Zé', valor_venda: 1000, valor_custo: 600 } })],
    [],
  );
  eq(r.contas_pagar.length, 1, 'nome livre conta como fornecedor real');
  eq(r.contas_pagar[0].fornecedor_nome, 'Pousada do Zé', 'nome preservado');
}
{
  // Nome só com espaços não é fornecedor.
  const r = gerar(
    [item({ fornecedor_id: '', data: { fornecedor_nome: '   ', valor_venda: 1000, valor_custo: 600 } })],
    [],
  );
  eq(r.contas_pagar.length, 0, 'nome em branco não é fornecedor');
  eq(r.resumo.total_custos, 600, 'mas o custo continua na margem');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- a margem da venda não infla sem a conta a pagar ---');
{
  // É o risco da mudança: o resultado da venda soma custo das contas a pagar.
  // Sem a dívida, o custo precisa entrar por custo_sem_conta, senão a tela
  // mostraria margem cheia numa venda que teve custo.
  const semCusto = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: [{ origem: 'VENDA', status: 'PENDENTE', valor_final: 15997, data_vencimento: '2026-10-08' }],
    contas_pagar: [],
  });
  eq(semCusto.margem_prevista, 15997, 'sem informar o custo, a margem vem cheia');

  const comCusto = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: [{ origem: 'VENDA', status: 'PENDENTE', valor_final: 15997, data_vencimento: '2026-10-08' }],
    contas_pagar: [],
    custo_sem_conta: 1300,
  });
  eq(comCusto.custo_previsto, 1300, 'custo sem conta entra no custo previsto');
  eq(comCusto.margem_prevista, 14697, 'margem = venda menos custo');
  eq(comCusto.custo_pendente, 0, 'não há nada a pagar a ninguém');
  eq(comCusto.custo_pago, 0, 'e nada foi pago');
  eq(comCusto.vencido_a_pagar, 0, 'não entra em vencidos');
}
{
  // Venda com fornecedor detalhado: custo_sem_conta é zero e nada muda.
  const r = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: [{ origem: 'VENDA', status: 'PENDENTE', valor_final: 20000, data_vencimento: '2026-10-08' }],
    contas_pagar: [{ status: 'PENDENTE', valor_final: 16500, data_vencimento: '2026-10-15' }],
    custo_sem_conta: 0,
  });
  eq(r.custo_previsto, 16500, 'custo vem só das contas a pagar');
  eq(r.margem_prevista, 3500, 'a viagem de 20 mil rende 3,5 mil');
  eq(r.custo_pendente, 16500, 'e há de fato 16,5 mil a pagar');
}
{
  // Venda mista: parte com dívida, parte só na margem.
  const r = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: [{ origem: 'VENDA', status: 'PENDENTE', valor_final: 6000, data_vencimento: '2026-10-08' }],
    contas_pagar: [{ status: 'PENDENTE', valor_final: 3000, data_vencimento: '2026-10-15' }],
    custo_sem_conta: 900,
  });
  eq(r.custo_previsto, 3900, 'soma dívida e custo sem dono');
  eq(r.margem_prevista, 2100, 'margem = 6000 menos 3900');
  eq(r.custo_pendente, 3000, 'só os 3000 são dívida com alguém');
}
{
  // Valor negativo ou lixo não deve virar crédito de custo.
  const r = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: [{ origem: 'VENDA', status: 'PENDENTE', valor_final: 1000, data_vencimento: '2026-10-08' }],
    contas_pagar: [],
    custo_sem_conta: -500,
  });
  eq(r.custo_previsto, 0, 'custo negativo é ignorado');
  eq(r.margem_prevista, 1000, 'margem não é inflada por custo negativo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o número do incidente, ponta a ponta ---');
{
  // Venda de R$ 15.997 (Vanessa) com custo de referência de R$ 1.300 vindo do
  // cadastro do produto, sem fornecedor. Antes: 1 conta a pagar fantasma.
  const gerado = gerar(
    [item({
      fornecedor_id: '',
      data: {
        tipo: 'OUTROS',
        descricao: 'Venda crm_deal_1106233 — fornecedor(es) a detalhar',
        fornecedor_nome: '',
        valor_venda: 15997,
        valor_custo: 1300,
      },
    })],
    [],
  );
  eq(gerado.contas_pagar.length, 0, 'nenhuma saída fantasma no fluxo de caixa');

  const custoSemConta = round2(gerado.resumo.total_custos - 0);
  const resultado = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: gerado.contas_receber,
    contas_pagar: gerado.contas_pagar,
    custo_sem_conta: custoSemConta,
  });
  eq(resultado.volume_liquido, 15997, 'venda registrada');
  eq(resultado.custo_previsto, 1300, 'custo registrado');
  eq(resultado.margem_prevista, 14697, 'margem é a diferença');
  eq(resultado.custo_pendente, 0, 'e nada a pagar a ninguém');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes da regra de custo passaram`);
if (falhas > 0) process.exit(1);
