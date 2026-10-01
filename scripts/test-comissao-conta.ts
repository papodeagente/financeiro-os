/**
 * A comissão do vendedor vira conta a pagar (src/lib/comissao-conta.ts).
 *
 * O que estes testes guardam: a conta é UMA por comissão, vence na agenda,
 * e nunca é marcada como paga por um caminho que não move caixa.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-comissao-conta.ts
 */
import { contaDaComissao, idDaContaDaComissao, vencimentoDaComissao, PREFIXO_CONTA_COMISSAO } from '../src/lib/comissao-conta.ts';
import { escadaDoMes } from '../src/lib/lucro-real.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const comissao = (extra: Record<string, unknown> = {}) => ({
  id: 'com-1', venda_id: 'v-1', venda_numero: 'V-0042', vendedor_id: 'vend-1', vendedor_nome: 'Ana',
  plano_comissao_id: 'p1', plano_nome: 'Escala padrão', data_venda: '2026-09-03',
  valor_base: 3500, percentual_aplicado: 12, valor_comissao: 420, status: 'CALCULADA',
  data_aprovacao: null, data_pagamento: null, observacoes: '', ...extra,
}) as any;

const ctx = { datasPagamento: [1, 18], categoriaId: 'cat-26', hoje: '2026-09-10' };

{ // id determinístico: recalcular o mês regrava a MESMA conta
  eq(idDaContaDaComissao('com-1'), 'cp-comissao-com-1', 'id derivado da comissão');
  eq(contaDaComissao(comissao(), ctx)?.id, `${PREFIXO_CONTA_COMISSAO}com-1`, 'a conta usa esse id');
}

{ // vencimento pela agenda
  eq(vencimentoDaComissao([1, 18], '2026-09-03', '2026-09-10'), { data: '2026-09-18', semAgenda: false }, 'venda dia 3, hoje dia 10, agenda 1 e 18: vence dia 18');
  eq(vencimentoDaComissao([1, 18], '2026-09-03', '2026-09-25'), { data: '2026-10-01', semAgenda: false }, 'passou do 18: vence no 1º do mês seguinte');
  // Venda antiga recalculada hoje: a agência não paga comissão no passado.
  eq(vencimentoDaComissao([5], '2026-06-02', '2026-09-10'), { data: '2026-10-05', semAgenda: false }, 'venda de junho recalculada em setembro vence no próximo dia 5');
  // Venda no futuro (pré-venda): a referência é a venda, não hoje.
  eq(vencimentoDaComissao([5], '2026-11-20', '2026-09-10'), { data: '2026-12-05', semAgenda: false }, 'venda futura vence depois dela');
}

{ // sem agenda: a dívida existe mesmo assim, no fim do mês, e avisa
  const v = vencimentoDaComissao([], '2026-09-03', '2026-09-10');
  eq(v, { data: '2026-09-30', semAgenda: true }, 'sem agenda vence no último dia do mês');
  const c = contaDaComissao(comissao(), { ...ctx, datasPagamento: [] })!;
  eq(c.observacoes.includes('não configurada'), true, 'a conta avisa que falta configurar a agenda');
  eq(vencimentoDaComissao(null, '2026-02-10', '2026-02-10').data, '2026-02-28', 'fevereiro respeita o tamanho do mês');
}

{ // a conta em si
  const c = contaDaComissao(comissao(), ctx)!;
  eq([c.valor_original, c.valor_final, c.valor_brl], [420, 420, 420], 'valor da comissão nos três campos');
  eq(c.status, 'PENDENTE', 'nasce pendente');
  eq(c.categoria_id, 'cat-26', 'cai em Custos Comerciais (2.6)');
  eq([c.natureza_custo, c.is_custo_comercial], ['VARIAVEL', true], 'variável e comercial');
  eq([c.auto_gerado, c.origem_comissao_id, c.origem_venda_id], [true, 'com-1', 'v-1'], 'marcada como gerada pela comissão');
  eq(c.fornecedor_nome, 'Ana', 'o "fornecedor" é o vendedor');
  eq(c.descricao, 'Comissão · Ana · venda V-0042', 'descrição legível');
  eq(c.data_vencimento, '2026-09-18', 'vencimento da agenda');
  eq(c.data_emissao, '2026-09-10', 'emitida hoje');
}

{ // valor zero ou negativo: não existe dívida de R$ 0
  eq(contaDaComissao(comissao({ valor_comissao: 0 }), ctx), null, 'zero não gera conta');
  eq(contaDaComissao(comissao({ valor_comissao: -10 }), ctx), null, 'negativo não gera conta');
}

{ // status da comissão → status da conta
  eq(contaDaComissao(comissao({ status: 'APROVADA' }), ctx)!.status, 'PENDENTE', 'aprovada continua pendente de pagamento');
  eq(contaDaComissao(comissao({ status: 'CANCELADA' }), ctx)!.status, 'CANCELADO', 'cancelada cancela a conta');
  // O ponto que vale dinheiro: PAGA na tela de comissões NÃO vira PAGO aqui.
  // Upsert não move caixa; conta paga sem saída de banco é saldo sem lastro.
  const paga = contaDaComissao(comissao({ status: 'PAGA', data_pagamento: '2026-09-18' }), ctx)!;
  eq(paga.status, 'PENDENTE', 'comissão PAGA não marca a conta como paga por upsert');
  eq(paga.observacoes.includes('consta como paga em 2026-09-18'), true, 'mas a conta diz que a comissão consta como paga');
  eq(paga.data_pagamento, null, 'e não inventa data de pagamento');
}

{ // O LUCRO REAL não conta a comissão duas vezes
  const venda = { id: 'v-1', numero: 'V-0042', data_venda: '2026-09-03', valor_final: 20000, valor_total_custo: 16500, status: 'CONCLUIDA', cliente_id: 'c1', vendedor_id: 'vend-1', produtos: [] } as any;
  const cp = contaDaComissao(comissao(), ctx)!;
  const m = escadaDoMes({
    mes: '2026-09', hoje: '2026-10-01', vendas: [venda],
    contasReceber: [{ id: 'cr', origem: 'VENDA', venda_id: 'v-1', valor_final: 20000, taxa: 0, data_vencimento: '2026-09-10', status: 'RECEBIDO' } as any],
    contasPagar: [cp as any, { id: 'cp-alu', categoria_id: 'cat-22', valor_final: 1000, data_vencimento: '2026-09-15', status: 'PENDENTE', origem: 'DESPESA_FIXA' } as any],
    planoContas: [{ id: 'cat-22', codigo: '2.2' }, { id: 'cat-26', codigo: '2.6' }] as any,
    comissoes: [comissao()],
  });
  eq(m.custo_fixo, 1000, 'a conta da comissão NÃO entra no custo fixo');
  eq(m.comissao_vendedor, 420, 'ela entra uma vez, na linha do vendedor');
  eq(m.lucro, 3500 - 420 - 1000, 'lucro sem contagem dupla');
}

console.log(`\n${total - falhas}/${total} testes da conta da comissão passaram`);
if (falhas > 0) process.exit(1);
