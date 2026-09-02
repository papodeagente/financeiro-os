/**
 * Testes das regras financeiras de negócio (geração de contas, comissão,
 * fatura de cartão, saldo bancário).
 * Roda sem dependências: `node --experimental-strip-types scripts/test-financeiro.ts`
 *
 * Estes testes travam os invariantes que a auditoria de 2026-09-01 encontrou
 * quebrados — se algum voltar a falhar, um erro de cálculo sistêmico voltou.
 */
import { gerarContasVenda, calcularComissao } from '../src/lib/venda-financeiro.ts';
import { calcFaturaPeriodo, calcLimiteUsado } from '../src/lib/cartoes-utils.ts';
import { calcularSaldoBancario } from '../src/lib/saldo-bancario.ts';
import { soma, round2 } from '../src/lib/money.ts';

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

// ── fixtures ────────────────────────────────────────────────────────────
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
    numero: '001',
    cliente_id: 'c1',
    data_venda: '2026-03-10',
    parcelas: 1,
    desconto: 0,
    centro_custo: '',
    grupo_id: '',
    ...over,
  };
}

function gerar(v: Any, itens: Any[], fornecedores: Any[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return gerarContasVenda({ venda: v, itens, fornecedores, cliente_nome: 'Cliente' } as any);
}

console.log('--- contas a receber: parcelas fecham o total ---');
{
  const r = gerar(venda({ parcelas: 3 }), [item({ data: { valor_venda: 1000 } })]);
  const crVenda = r.contas_receber.filter(c => c.origem === 'VENDA');
  eq(crVenda.length, 3, '3 parcelas geradas');
  eq(soma(crVenda.map(c => c.valor_final)), 1000, 'parcelas somam EXATAMENTE o total (1000/3)');
  eq(crVenda.map(c => c.parcela_numero), [1, 2, 3], 'numeração sequencial');
  eq(new Set(crVenda.map(c => c.data_vencimento)).size, 3, 'vencimentos distintos');
}
{
  const r = gerar(venda({ parcelas: 7 }), [item({ data: { valor_venda: 999.99 } })]);
  eq(soma(r.contas_receber.filter(c => c.origem === 'VENDA').map(c => c.valor_final)), 999.99,
     'centavos fecham em 7 parcelas');
}

console.log('--- desconto da venda entra nas contas ---');
{
  const r = gerar(
    venda({ parcelas: 2, desconto: 1000 }),
    [item({ data: { valor_venda: 6000 } }), item({ data: { valor_venda: 4000 } })],
  );
  const crVenda = r.contas_receber.filter(c => c.origem === 'VENDA');
  eq(soma(crVenda.map(c => c.valor_final)), 9000, 'desconto de 1000 sobre 10000 -> cobra 9000');
  eq(r.resumo.total_cliente, 9000, 'resumo.total_cliente já é líquido de desconto');
}
{
  const r = gerar(venda({ desconto: 0 }), [item({ data: { valor_venda: 500 } })]);
  eq(soma(r.contas_receber.map(c => c.valor_final)), 500, 'sem desconto cobra o bruto');
}

console.log('--- moeda estrangeira: câmbio aplicado UMA vez ---');
{
  const r = gerar(venda(), [item({ data: { valor_venda: 1000, valor_custo: 100, moeda: 'USD', cambio: 5 } })]);
  const cp = r.contas_pagar[0];
  eq(cp.valor_brl, 500, 'custo USD 100 x câmbio 5 = R$500 (não 2500)');
  eq(cp.valor_original, 100, 'valor_original preservado na moeda de origem');
  eq(r.resumo.total_custos, 500, 'resumo soma o custo em BRL');
}
{
  const r = gerar(venda(), [item({ data: { valor_custo: 800, moeda: 'BRL', cambio: 1 } })]);
  eq(r.contas_pagar[0].valor_brl, 800, 'BRL não é multiplicado');
}


console.log('--- CONTRATO DE MOEDA: valor_final é SEMPRE BRL (regressão 2026-09) ---');
{
  const r = gerar(venda(), [item({ data: { valor_venda: 2000, valor_custo: 100, moeda: 'USD', cambio: 5.4 } })]);
  const cp = r.contas_pagar[0];
  eq(cp.valor_final, 540, 'valor_final da CP em BRL (100 USD x 5,4) — o campo que todo relatório soma');
  eq(cp.valor_original, 100, 'valor_original guarda a moeda de origem');
  eq(cp.valor_brl, 540, 'valor_brl espelha valor_final');
  eq(cp.moeda, 'USD', 'moeda preservada');
  eq(cp.cambio, 5.4, 'câmbio preservado');
  // o invariante que a regressão quebrou: somar valor_final direto dá o valor certo
  eq(soma([cp.valor_final]), 540, 'somar valor_final direto (fluxo de caixa/hub/cartões) dá BRL correto');
}
{
  const r = gerar(venda(), [item({ data: { valor_custo: 800, moeda: 'BRL', cambio: 1 } })]);
  eq(r.contas_pagar[0].valor_final, 800, 'conta em BRL não é convertida');
}

console.log('--- comissão de fornecedor ---');
{
  const c = calcularComissao(
    { valor_venda: 1000, comissao_valor: 0, comissao_percentual: 10 } as never,
    undefined,
  );
  eq(c.comissao_valor, 100, '10% de 1000 = 100');
}
{
  const c = calcularComissao(
    { valor_venda: 0, comissao_valor: 0, comissao_percentual: 0 } as never,
    { regras_faturamento: { comissao_padrao: 8 } } as never,
  );
  eq(c.comissao_valor, 0, 'venda zerada não gera comissão (sem NaN)');
  eq(Number.isFinite(c.comissao_percentual), true, 'percentual finito mesmo com venda 0');
}
{
  const c = calcularComissao(
    { valor_venda: 0, comissao_valor: 50, comissao_percentual: 0 } as never,
    undefined,
  );
  eq(Number.isFinite(c.comissao_percentual), true, 'comissão manual com venda 0 não vira NaN/Infinity');
}
{
  // fluxo fornecedor: cliente paga direto, agência recebe comissão
  const r = gerar(venda(), [item({
    data: { meio_pagamento: 'fornecedor', valor_venda: 2000, valor_custo: 0, comissao_percentual: 12 },
  })]);
  eq(r.contas_pagar.length, 0, 'fluxo fornecedor não gera conta a pagar');
  eq(r.contas_receber.length, 1, 'gera 1 CR de comissão');
  eq(r.contas_receber[0].origem, 'COMISSAO_FORNECEDOR', 'origem correta');
  eq(r.contas_receber[0].valor_final, 240, '12% de 2000 = 240');
  eq(r.resumo.total_cliente, 0, 'cliente não deve nada à agência');
}

console.log('--- itens cancelados não entram ---');
{
  const r = gerar(venda(), [
    item({ data: { valor_venda: 1000 } }),
    item({ status: 'cancelado', data: { valor_venda: 5000 } }),
  ]);
  eq(r.resumo.total_cliente, 1000, 'item cancelado é ignorado no total');
}

console.log('--- lucro previsto ---');
{
  const r = gerar(venda(), [item({ data: { valor_venda: 1000, valor_custo: 700 } })]);
  eq(r.resumo.lucro_previsto, 300, 'lucro = receita - custo');
}

console.log('--- vencimentos não escorregam de dia (fuso) ---');
{
  const r = gerar(venda({ data_venda: '2026-01-31', parcelas: 2 }), [item()]);
  const vencs = r.contas_receber.filter(c => c.origem === 'VENDA').map(c => c.data_vencimento);
  eq(vencs.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v)), true, 'formato ISO válido');
  eq(vencs[0] > '2026-01-31', true, 'primeira parcela vence depois da venda');
  eq(vencs[1] > vencs[0], true, 'parcelas em ordem crescente');
  // 31/01 + 1 mês não pode virar 03/03
  eq(vencs[0].slice(0, 7), '2026-02', '31/01 + 1 mês cai em fevereiro (clamp), não em março');
}

console.log('--- fatura de cartão: nenhum lançamento some ---');
{
  const cartao = { id: 'cc1', dia_fechamento: 20, dia_vencimento: 28 } as never;
  const mk = (id: string, venc: string, valor: number) =>
    ({ id, cartao_id: 'cc1', data_vencimento: venc, data_pagamento: null, valor_final: valor, status: 'PENDENTE' } as never);
  // dia seguinte ao fechamento anterior (21/02) tem de entrar na fatura de março
  const contas = [mk('a', '2026-02-21', 100), mk('b', '2026-03-20', 200), mk('c', '2026-02-20', 999)];
  const f = calcFaturaPeriodo(cartao, contas, '2026-03');
  const ids = f.lancamentos.map((c: { id: string }) => c.id).sort();
  eq(ids, ['a', 'b'], 'inclui borda inicial (21/02) e final (20/03), exclui o fechamento anterior');
  eq(f.total, 300, 'total da fatura');
}
{
  const cartao = { id: 'cc1', dia_fechamento: 31, dia_vencimento: 10 } as never;
  const contas = [{ id: 'x', cartao_id: 'cc1', data_vencimento: '2026-02-15', data_pagamento: null, valor_final: 50, status: 'PENDENTE' } as never];
  const f = calcFaturaPeriodo(cartao, contas, '2026-02');
  eq(f.lancamentos.length, 1, 'fechamento dia 31 em fevereiro não perde lançamento');
}
{
  const contas = [
    { id: '1', cartao_id: 'cc1', valor_final: 100, status: 'PENDENTE' },
    { id: '2', cartao_id: 'cc1', valor_final: 50, status: 'CANCELADO' },
    { id: '3', cartao_id: 'outro', valor_final: 999, status: 'PENDENTE' },
  ] as never;
  eq(calcLimiteUsado('cc1', contas), 100, 'limite usado ignora cancelado e outro cartão');
}

console.log('--- saldo bancário ---');
{
  const contas = [{ saldo_inicial: 1000 }] as never;
  const receber = [
    { status: 'RECEBIDO', valor_recebido: 500, valor_final: 500 },
    { status: 'PENDENTE', valor_recebido: null, valor_final: 9999 },
  ] as never;
  const pagar = [
    { status: 'PAGO', valor_pago: 200, valor_final: 200 },
    { status: 'PENDENTE', valor_pago: null, valor_final: 7777 },
  ] as never;
  eq(calcularSaldoBancario(contas, receber, pagar), 1300, 'saldo = inicial + recebidos - pagos (pendentes fora)');
}
{
  // 300 movimentos de centavos não podem acumular erro de float
  const receber = Array.from({ length: 300 }, () => ({ status: 'RECEBIDO', valor_recebido: 0.01, valor_final: 0.01 })) as never;
  eq(calcularSaldoBancario([{ saldo_inicial: 0 }] as never, receber, []), 3, '300 x R$0,01 = R$3,00 exato');
}

console.log(`\n${total - falhas}/${total} testes passaram`);
if (falhas > 0) {
  console.log(`${falhas} FALHAS`);
  process.exit(1);
}
