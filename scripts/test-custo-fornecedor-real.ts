/**
 * Regra do custo (Bruno, 2026-09-08):
 *
 *   "No CRM deve pegar os dados de: preço de venda e preço de custo.
 *    A margem é a diferença. Apenas essa regra."
 *
 *   "Preciso receber no financeiro o total a pagar e o fornecedor. Caso não
 *    tenha colocado o fornecedor dentro do CRM, informar que está sem
 *    fornecedor no CRM. Permitir inserir manualmente no financeiro."
 *
 * Estes testes travam as três metades dessa regra:
 *  1. todo custo vira conta a pagar — a agência vai desembolsar o dinheiro;
 *  2. sem fornecedor identificado a conta nasce MARCADA, não some;
 *  3. a margem continua sendo venda menos custo, com ou sem fornecedor.
 *
 * Contexto: uma venda importada do CRM com fornecedores detalhados não gerava
 * conta nenhuma (nem a pagar nem a receber), porque os itens entravam como
 * meio_pagamento='fornecedor' e o CRM manda comissão zero. Sem detalhamento,
 * o custo virava uma dívida genérica que ninguém sabia a quem pagar — e a
 * correção anterior, de omitir a dívida, escondia uma saída de caixa real.
 *
 * Roda com: node --experimental-strip-types scripts/test-custo-fornecedor-real.ts
 */
import { gerarContasVenda } from '../src/lib/venda-financeiro.ts';
import { calcularResultado } from '../src/lib/resultado-financeiro.ts';
import { montarLinhasDeCusto, DESCRICAO_SEM_FORNECEDOR, DESCRICAO_PROPRIO } from '../src/lib/venda-crm-itens.ts';
import { soma, round2 } from '../src/lib/money.ts';
import { readFileSync } from 'node:fs';

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
console.log('--- com fornecedor: conta a pagar com nome de quem recebe ---');
{
  const r = gerar([item({ data: { valor_venda: 1000, valor_custo: 800 } })]);
  eq(r.contas_pagar.length, 1, 'uma conta a pagar para o fornecedor');
  eq(r.contas_pagar[0].valor_final, 800, 'valor do custo');
  eq(r.contas_pagar[0].fornecedor_nome, 'CVC', 'fornecedor identificado');
  eq(r.contas_pagar[0].fornecedor_pendente, false, 'não está pendente de fornecedor');
  eq(r.contas_pagar[0].observacoes, '', 'sem aviso na observação');
  eq(r.contas_receber.length, 1, 'conta a receber do cliente');
  eq(r.resumo.total_custos, 800, 'custo entra no resumo');
  eq(r.resumo.lucro_previsto, 200, 'margem é venda menos custo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- sem fornecedor: a conta NASCE, marcada ---');
{
  // Shape exato do item que o webhook cria quando o CRM não detalha
  // fornecedor: fornecedor_id vazio, fornecedor_nome vazio, tipo OUTROS.
  const r = gerar(
    [item({
      fornecedor_id: '',
      data: {
        tipo: 'OUTROS',
        descricao: DESCRICAO_SEM_FORNECEDOR,
        fornecedor_nome: '',
        valor_venda: 15997,
        valor_custo: 1300,
      },
    })],
    [],
  );
  eq(r.contas_pagar.length, 1, 'a dívida existe mesmo sem saber a quem pagar');
  eq(r.contas_pagar[0].valor_final, 1300, 'valor a pagar preservado');
  eq(r.contas_pagar[0].fornecedor_nome, '', 'fornecedor em branco');
  eq(r.contas_pagar[0].fornecedor_pendente, true, 'marcada como sem fornecedor');
  eq(
    r.contas_pagar[0].observacoes,
    'Sem fornecedor no CRM. Edite esta conta para informar a quem pagar.',
    'a observação diz o que fazer',
  );
  eq(r.contas_pagar[0].status, 'PENDENTE', 'entra em aberto, como qualquer dívida');
  eq(r.contas_receber.length, 1, 'a conta a receber do cliente continua');
  eq(r.contas_receber[0].valor_final, 15997, 'cliente deve o valor da venda');

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
console.log('--- venda mista: duas dívidas, uma delas marcada ---');
{
  const r = gerar([
    item({ sequencia: 1, data: { descricao: 'Hotel', fornecedor_nome: 'Ibis', valor_venda: 4000, valor_custo: 3000 } }),
    item({ sequencia: 2, fornecedor_id: '', data: { tipo: 'OUTROS', descricao: DESCRICAO_SEM_FORNECEDOR, fornecedor_nome: '', valor_venda: 2000, valor_custo: 900 } }),
  ]);
  eq(r.contas_pagar.length, 2, 'os dois custos viram dívida');
  eq(soma(r.contas_pagar.map(c => c.valor_final)), 3900, 'total a pagar é a soma dos custos');
  eq(r.contas_pagar.filter(c => c.fornecedor_pendente).length, 1, 'só uma está sem fornecedor');
  eq(r.contas_pagar.find(c => c.fornecedor_pendente)?.valor_final, 900, 'a marcada é a de 900');
  eq(r.resumo.total_custos, 3900, 'a margem considera os dois custos');
  eq(r.resumo.total_cliente, 6000, 'cliente paga os dois itens');
  eq(r.resumo.lucro_previsto, 2100, 'margem = 6000 menos 3900');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- fornecedor identificado só pelo nome não fica marcado ---');
{
  // Sem cadastro no CRM (fornecedor_id vazio) mas com nome digitado: já se
  // sabe a quem pagar, então nada fica pendente.
  const r = gerar(
    [item({ fornecedor_id: '', data: { fornecedor_nome: 'Pousada do Zé', valor_venda: 1000, valor_custo: 600 } })],
    [],
  );
  eq(r.contas_pagar.length, 1, 'conta a pagar normal');
  eq(r.contas_pagar[0].fornecedor_nome, 'Pousada do Zé', 'nome preservado');
  eq(r.contas_pagar[0].fornecedor_pendente, false, 'nome livre já resolve o pendente');
}
{
  // Nome só com espaços não é fornecedor: a conta nasce marcada.
  const r = gerar(
    [item({ fornecedor_id: '', data: { fornecedor_nome: '   ', valor_venda: 1000, valor_custo: 600 } })],
    [],
  );
  eq(r.contas_pagar.length, 1, 'a dívida existe');
  eq(r.contas_pagar[0].fornecedor_nome, '', 'espaço em branco vira vazio');
  eq(r.contas_pagar[0].fornecedor_pendente, true, 'nome em branco fica pendente');
  eq(r.resumo.total_custos, 600, 'e o custo continua na margem');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- linhas de custo montadas a partir do payload do CRM ---');
{
  // Caso normal: dois fornecedores detalhados, custo_total bate com a soma.
  const linhas = montarLinhasDeCusto({
    fornecedores: [
      { fornecedor_id: 'f1', fornecedor_nome: 'CVC', servico: 'AEREO', valor_custo: 6000 },
      { fornecedor_id: 'f2', fornecedor_nome: 'Ibis', servico: 'HOTEL', valor_custo: 4000 },
    ],
    custo_total: 10000,
    valor_total: 14000,
  });
  eq(linhas.length, 2, 'uma linha por fornecedor');
  eq(linhas.map(l => l.sem_fornecedor), [false, false], 'nenhuma pendente');
  eq(linhas.map(l => l.tipo), ['AEREO', 'HOTEL'], 'serviço vira tipo do item');
  eq(soma(linhas.map(l => l.valor_custo)), 10000, 'custo total preservado');
  eq(soma(linhas.map(l => l.valor_venda)), 14000, 'venda rateada fecha com o total');
  eq(linhas.map(l => l.valor_venda), [8400, 5600], 'rateio proporcional ao custo');
}
{
  // O CRM manda `servico` como token fechado (só para tipar a conta) e o texto
  // que a pessoa lê em `descricao`. A descrição legível tem que ganhar, senão
  // toda conta a pagar se chama "AEREO" ou "OUTROS" e ninguém sabe a que se
  // refere na hora de pagar.
  const linhas = montarLinhasDeCusto({
    fornecedores: [
      { fornecedor_id: 'f1', fornecedor_nome: 'CVC', servico: 'AEREO', descricao: 'Aereo internacional (bilhete), Italia 2027', valor_custo: 6000 },
      { fornecedor_id: 'f2', fornecedor_nome: 'Marco', servico: 'OUTROS', descricao: 'Guia local em Roma, Italia 2027', valor_custo: 4000 },
    ],
    custo_total: 10000,
    valor_total: 14000,
  });
  eq(linhas.map(l => l.tipo), ['AEREO', 'OUTROS'], 'o token continua tipando a conta');
  eq(linhas[0].descricao, 'Aereo internacional (bilhete), Italia 2027', 'a descricao legivel ganha do token');
  eq(linhas[1].descricao, 'Guia local em Roma, Italia 2027', 'dois OUTROS deixam de ser indistinguiveis');
}
{
  // Retrocompatibilidade: venda antiga não manda `descricao`, e o texto que o
  // CRM colocava em `servico` continua sendo o que aparece.
  const linhas = montarLinhasDeCusto({
    fornecedores: [{ fornecedor_id: 'f1', fornecedor_nome: 'CVC', servico: 'Pacote Roma, Seguro', valor_custo: 6000 }],
    custo_total: 6000,
    valor_total: 9000,
  });
  eq(linhas[0].descricao, 'Pacote Roma, Seguro', 'payload antigo segue lendo servico');
  eq(linhas[0].tipo, 'OUTROS', 'texto livre continua caindo em OUTROS');
}
{
  // O buraco do emissor do CRM: custo_total maior que a soma dos fornecedores.
  // O produto sem fornecedor entrou no total mas não no detalhamento.
  const linhas = montarLinhasDeCusto({
    fornecedores: [{ fornecedor_id: 'f1', fornecedor_nome: 'CVC', servico: 'AEREO', valor_custo: 6000 }],
    custo_total: 7300,
    valor_total: 15997,
  });
  eq(linhas.length, 2, 'nasce a linha do custo sem dono');
  eq(linhas[1].sem_fornecedor, true, 'marcada como sem fornecedor');
  eq(linhas[1].fornecedor_nome, '', 'sem nome de fornecedor');
  eq(linhas[1].valor_custo, 1300, 'o resíduo é exatamente o custo sem dono');
  eq(linhas[1].descricao, DESCRICAO_SEM_FORNECEDOR, 'a descrição avisa');
  eq(soma(linhas.map(l => l.valor_custo)), 7300, 'nada de custo se perde');
  eq(soma(linhas.map(l => l.valor_venda)), 15997, 'venda fecha com o total');
}
{
  // Nenhum fornecedor detalhado: todo o custo é sem dono.
  const linhas = montarLinhasDeCusto({
    fornecedores: [],
    custo_total: 1300,
    valor_total: 15997,
    referencia: 'crm_deal_1106233',
  });
  eq(linhas.length, 1, 'uma linha só');
  eq(linhas[0].sem_fornecedor, true, 'toda ela sem fornecedor');
  eq(linhas[0].valor_custo, 1300, 'custo inteiro');
  eq(linhas[0].valor_venda, 15997, 'venda inteira');
}
{
  // Venda sem custo nenhum: ainda precisa carregar o valor do cliente.
  const linhas = montarLinhasDeCusto({
    fornecedores: [],
    custo_total: 0,
    valor_total: 2500,
    referencia: 'crm_deal_9',
  });
  eq(linhas.length, 1, 'existe item para a conta a receber');
  eq(linhas[0].valor_custo, 0, 'sem custo');
  eq(linhas[0].valor_venda, 2500, 'o cliente paga o valor da venda');
  eq(linhas[0].sem_fornecedor, false, 'não há custo pendente de fornecedor');
  eq(linhas[0].descricao, 'Venda crm_deal_9', 'descrição referencia a venda');
}
{
  // custo_total MENOR que a soma detalhada (payload inconsistente): manda o
  // detalhamento, que é a informação com nome e CNPJ.
  const linhas = montarLinhasDeCusto({
    fornecedores: [{ fornecedor_id: 'f1', fornecedor_nome: 'CVC', servico: 'AEREO', valor_custo: 6000 }],
    custo_total: 1000,
    valor_total: 9000,
  });
  eq(linhas.length, 1, 'não inventa linha negativa');
  eq(linhas[0].valor_custo, 6000, 'vale o custo detalhado');
  eq(linhas[0].valor_venda, 9000, 'venda inteira na única linha');
}
{
  // Centavos: o rateio não pode perder nem sobrar um centavo.
  const linhas = montarLinhasDeCusto({
    fornecedores: [
      { fornecedor_id: 'f1', fornecedor_nome: 'A', servico: 'AEREO', valor_custo: 333.33 },
      { fornecedor_id: 'f2', fornecedor_nome: 'B', servico: 'HOTEL', valor_custo: 333.33 },
      { fornecedor_id: 'f3', fornecedor_nome: 'C', servico: 'CARRO', valor_custo: 333.34 },
    ],
    custo_total: 1000,
    valor_total: 1000.01,
  });
  eq(soma(linhas.map(l => l.valor_venda)), 1000.01, 'a soma do rateio é exata');
  eq(linhas.length, 3, 'sem linha de resíduo (custo bate)');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o resultado da venda vê a dívida ---');
{
  // Agora o custo chega pelas contas a pagar, não mais por custo_sem_conta.
  const r = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: [{ origem: 'VENDA', status: 'PENDENTE', valor_final: 15997, data_vencimento: '2026-10-08' }],
    contas_pagar: [{ status: 'PENDENTE', valor_final: 1300, data_vencimento: '2026-10-15' }],
  });
  eq(r.custo_previsto, 1300, 'custo vem da conta a pagar');
  eq(r.margem_prevista, 14697, 'margem é a diferença');
  eq(r.custo_pendente, 1300, 'e há de fato 1.300 a pagar');
}
{
  // custo_sem_conta continua sendo a rede de proteção para vendas antigas,
  // geradas quando a dívida sem fornecedor era omitida.
  const r = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: [{ origem: 'VENDA', status: 'PENDENTE', valor_final: 6000, data_vencimento: '2026-10-08' }],
    contas_pagar: [{ status: 'PENDENTE', valor_final: 3000, data_vencimento: '2026-10-15' }],
    custo_sem_conta: 900,
  });
  eq(r.custo_previsto, 3900, 'soma dívida e custo sem conta');
  eq(r.margem_prevista, 2100, 'margem = 6000 menos 3900');
  eq(r.custo_pendente, 3000, 'só os 3000 são dívida lançada');
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
  // Venda de R$ 15.997 com custo de R$ 1.300 vindo do cadastro do produto,
  // sem fornecedor. O financeiro precisa ver a dívida E saber que falta o
  // fornecedor.
  const linhas = montarLinhasDeCusto({
    fornecedores: [],
    custo_total: 1300,
    valor_total: 15997,
    referencia: 'crm_deal_1106233',
  });
  const gerado = gerar(
    linhas.map((l, i) => item({
      fornecedor_id: l.fornecedor_id,
      sequencia: i + 1,
      data: {
        tipo: l.tipo,
        descricao: l.descricao,
        fornecedor_nome: l.fornecedor_nome,
        valor_venda: l.valor_venda,
        valor_custo: l.valor_custo,
      },
    })),
    [],
  );
  eq(gerado.contas_pagar.length, 1, 'a saída de caixa aparece no fluxo');
  eq(gerado.contas_pagar[0].valor_final, 1300, 'total a pagar recebido do CRM');
  eq(gerado.contas_pagar[0].fornecedor_pendente, true, 'avisando que falta o fornecedor');
  eq(gerado.contas_receber[0].valor_final, 15997, 'e o cliente deve a venda inteira');

  const resultado = calcularResultado({
    hoje: '2026-09-08',
    contas_receber: gerado.contas_receber,
    contas_pagar: gerado.contas_pagar,
  });
  eq(resultado.volume_liquido, 15997, 'venda registrada');
  eq(resultado.custo_previsto, 1300, 'custo registrado');
  eq(resultado.margem_prevista, 14697, 'margem é a diferença');
  eq(resultado.custo_pendente, 1300, 'com 1.300 ainda a pagar');
}

// ══════════════════════════════════════════════════════════════════════
// A VENDA ATRIBUÍDA POR FORNECEDOR (Bruno, 2026-09-09)
//
//   "A ideia é gerar uma conta a pagar e uma a receber para cada fornecedor /
//    item do produto. Caso tenha mais de um produto com o mesmo fornecedor,
//    agrupe os itens por fornecedor."
//
// A escolha foi RECEITA CHEIA: a conta a receber de um fornecedor é a parte da
// venda que entra por causa dele, e a conta a pagar é o custo dele. A margem é
// a diferença entre as duas. Receber só a margem quebraria o caixa: o cliente
// paga o total, não a margem.
// ══════════════════════════════════════════════════════════════════════
const fornecedorPayload = (over: Any = {}): Any => ({
  fornecedor_id: 'f1',
  fornecedor_nome: 'CVC',
  servico: 'AEREO',
  descricao: 'Aéreo GRU/LIS',
  valor_custo: 3000,
  localizador: '',
  data_inicio: '',
  data_fim: '',
  ...over,
});

const gerarPF = (itens: Any[], fornecedores: Any[], overVenda: Any = {}) =>
  gerarContasVenda({
    receberPorFornecedor: true,
    venda: venda(overVenda) as never,
    itens: itens as never,
    fornecedores: fornecedores as never,
    cliente_nome: 'Cliente',
  });

const doisFornecedores = [
  { id: 'f1', nome_fantasia: 'CVC', regras_faturamento: {} },
  { id: 'f2', nome_fantasia: 'Passeios Roma', regras_faturamento: {} },
];

console.log('\n--- a venda que o CRM atribuiu manda sobre o rateio por custo ---');
{
  // Margens desiguais: o aéreo foi comprado quase a preço de custo e o passeio
  // tem margem alta. Ratear por custo daria ao aéreo receita que ele não trouxe.
  const linhas = montarLinhasDeCusto({
    fornecedores: [
      fornecedorPayload({ valor_custo: 3000, valor_venda: 3200 }),
      fornecedorPayload({ fornecedor_id: 'f2', fornecedor_nome: 'Passeios Roma', servico: 'PASSEIO', descricao: 'Passeios', valor_custo: 1000, valor_venda: 4000 }),
    ],
    custo_total: 4000,
    valor_total: 7200,
  });
  eq(linhas.length, 2, 'um fornecedor, uma linha');
  eq(linhas[0].valor_venda, 3200, 'o aéreo recebe o que o CRM atribuiu, não os 5400 do rateio por custo');
  eq(linhas[1].valor_venda, 4000, 'e o passeio fica com a margem que é dele');
  eq(soma(linhas.map(l => l.valor_venda)), 7200, 'a soma continua fechando com a venda');
}
{
  // Venda antiga, gravada antes de 09/09: o payload não traz valor_venda.
  const linhas = montarLinhasDeCusto({
    fornecedores: [
      fornecedorPayload({ valor_custo: 3000 }),
      fornecedorPayload({ fornecedor_id: 'f2', valor_custo: 1000 }),
    ],
    custo_total: 4000,
    valor_total: 7200,
  });
  eq(linhas[0].valor_venda, 5400, 'sem atribuição, o rateio proporcional ao custo continua valendo');
  eq(linhas[1].valor_venda, 1800, 'como sempre foi');
}
{
  // Metade atribuída: o resto é rateado sobre quem ficou sem.
  const linhas = montarLinhasDeCusto({
    fornecedores: [
      fornecedorPayload({ valor_custo: 3000, valor_venda: 3200 }),
      fornecedorPayload({ fornecedor_id: 'f2', valor_custo: 1000 }),
    ],
    custo_total: 4000,
    valor_total: 7200,
  });
  eq(linhas[0].valor_venda, 3200, 'quem foi atribuído fica com o que recebeu');
  eq(linhas[1].valor_venda, 4000, 'quem não foi divide a sobra');
  eq(soma(linhas.map(l => l.valor_venda)), 7200, 'e a soma fecha');
}

console.log('\n--- a receita que não é de fornecedor nenhum não pode evaporar ---');
{
  // Serviço próprio da agência com custo zero: não existe linha "sem
  // fornecedor" para carregar a sobra, porque sobra é de RECEITA, não de custo.
  const linhas = montarLinhasDeCusto({
    fornecedores: [fornecedorPayload({ valor_custo: 3000, valor_venda: 3200 })],
    custo_total: 3000,
    valor_total: 5000,
  });
  eq(linhas.length, 2, 'a sobra ganhou uma linha própria');
  eq(linhas[1].descricao, DESCRICAO_PROPRIO, 'e ela diz que é serviço da casa');
  eq(linhas[1].valor_custo, 0, 'sem custo: não há a quem pagar');
  eq(linhas[1].valor_venda, 1800, 'com os 1.800 que o fornecedor não trouxe');
  eq(soma(linhas.map(l => l.valor_venda)), 5000, 'o cliente continua devendo a venda inteira');
}
{
  // Venda editada no CRM depois de emitida: o atribuído ficou maior que o total.
  const linhas = montarLinhasDeCusto({
    fornecedores: [
      fornecedorPayload({ valor_custo: 3000, valor_venda: 6000 }),
      fornecedorPayload({ fornecedor_id: 'f2', valor_custo: 1000, valor_venda: 2000 }),
    ],
    custo_total: 4000,
    valor_total: 5000,
  });
  eq(soma(linhas.map(l => l.valor_venda)), 5000, 'a soma é trazida de volta para o total, sem receita inventada');
}

console.log('\n--- uma conta a pagar e uma a receber por fornecedor ---');
{
  const itens = [
    item({ fornecedor_id: 'f1', sequencia: 1, data: { fornecedor_nome: 'CVC', descricao: 'Aéreo', valor_venda: 3200, valor_custo: 3000 } }),
    item({ fornecedor_id: 'f2', sequencia: 2, data: { fornecedor_nome: 'Passeios Roma', descricao: 'Passeios', valor_venda: 4000, valor_custo: 1000 } }),
  ];
  const r = gerarPF(itens, doisFornecedores);
  eq(r.contas_receber.length, 2, 'duas contas a receber, uma por fornecedor');
  eq(r.contas_pagar.length, 2, 'e duas a pagar');
  eq(soma(r.contas_receber.map(c => c.valor_final)), 7200, 'o cliente deve o total da venda, nem mais nem menos');
  const cvcR = r.contas_receber.find(c => c.descricao.includes('CVC'));
  const cvcP = r.contas_pagar.find(c => c.fornecedor_id === 'f1');
  eq(cvcR?.valor_final, 3200, 'a receita cheia do fornecedor entra a receber');
  eq(cvcP?.valor_final, 3000, 'e o custo dele sai a pagar');
  eq(round2((cvcR?.valor_final ?? 0) - (cvcP?.valor_final ?? 0)), 200, 'a margem do fornecedor é a diferença entre as duas');
  eq(r.resumo.total_cliente, 7200, 'o resumo não muda de tamanho por quebrar a conta');
}
{
  // Dois itens do mesmo fornecedor: uma conta a receber só, como pediu o Bruno.
  const itens = [
    item({ fornecedor_id: 'f1', sequencia: 1, data: { fornecedor_nome: 'CVC', descricao: 'Ida', valor_venda: 1200, valor_custo: 1000 } }),
    item({ fornecedor_id: 'f1', sequencia: 2, data: { fornecedor_nome: 'CVC', descricao: 'Volta', valor_venda: 800, valor_custo: 700 } }),
  ];
  const r = gerarPF(itens, [doisFornecedores[0]]);
  eq(r.contas_receber.length, 1, 'itens do mesmo fornecedor viram uma conta a receber');
  eq(r.contas_receber[0].valor_final, 2000, 'somando os dois');
  eq(r.contas_pagar.length, 2, 'o que se paga continua item a item, com localizador próprio');
}
{
  // Desconto e parcelamento juntos: o desconto sai da margem da agência, e
  // cada fornecedor parcela a parte dele.
  const itens = [
    item({ fornecedor_id: 'f1', sequencia: 1, data: { fornecedor_nome: 'CVC', valor_venda: 3200, valor_custo: 3000 } }),
    item({ fornecedor_id: 'f2', sequencia: 2, data: { fornecedor_nome: 'Passeios Roma', valor_venda: 4000, valor_custo: 1000 } }),
  ];
  const r = gerarPF(itens, doisFornecedores, { desconto: 720, parcelas: 3 });
  eq(r.contas_receber.length, 6, 'duas contas de três parcelas');
  eq(soma(r.contas_receber.map(c => c.valor_final)), 6480, 'e o total recebido é a venda menos o desconto');
  eq(r.resumo.total_cliente, 6480, 'igual ao resumo');
}
{
  // Item sem fornecedor não tem a quem se juntar: fica por conta própria.
  const itens = [
    item({ fornecedor_id: '', sequencia: 1, data: { fornecedor_nome: '', descricao: 'Serviço da casa', valor_venda: 1800, valor_custo: 0 } }),
    item({ fornecedor_id: '', sequencia: 2, data: { fornecedor_nome: '', descricao: 'Outro da casa', valor_venda: 900, valor_custo: 0 } }),
  ];
  const r = gerarPF(itens, []);
  eq(r.contas_receber.length, 2, 'cada item sem fornecedor guarda a própria linha');
  eq(soma(r.contas_receber.map(c => c.valor_final)), 2700, 'e a soma continua fechando');
  eq(r.contas_pagar.length, 0, 'custo zero não vira dívida de R$ 0,00');
}

console.log('\n--- a conta a receber do fornecedor sobrevive ao reprocessamento ---');
{
  // O webhook apaga e recria os itens da venda a cada reentrega do evento, com
  // ids NOVOS. Se a conta a receber fosse identificada pelo item, a conta já
  // RECEBIDA (que é preservada, e com razão) não casaria com a recém-gerada e a
  // mesma receita entraria duas vezes.
  const linhasDe = () => [
    item({ fornecedor_id: 'f1', sequencia: 1, data: { fornecedor_nome: 'CVC', valor_venda: 3200, valor_custo: 3000 } }),
    item({ fornecedor_id: 'f2', sequencia: 2, data: { fornecedor_nome: 'Passeios Roma', valor_venda: 4000, valor_custo: 1000 } }),
  ];
  const primeira = gerarPF(linhasDe(), doisFornecedores);
  const segunda = gerarPF(linhasDe(), doisFornecedores);
  const idsItem = (r: typeof primeira) => r.contas_receber.map(c => c.origem_item_id).sort();
  const idsForn = (r: typeof primeira) => r.contas_receber.map(c => c.origem_fornecedor_id).sort();
  eq(JSON.stringify(idsItem(primeira)) === JSON.stringify(idsItem(segunda)), false, 'o id do item muda entre as duas gerações');
  eq(idsForn(primeira), ['f1', 'f2'], 'mas o fornecedor identifica a conta');
  eq(idsForn(segunda), ['f1', 'f2'], 'e é o mesmo na segunda vez');

  // Item sem fornecedor cai na sequência, que também é estável.
  const semForn = gerarPF([item({ fornecedor_id: '', sequencia: 3, data: { fornecedor_nome: '', valor_venda: 900, valor_custo: 0 } })], []);
  eq(semForn.contas_receber[0].origem_fornecedor_id, 'seq:3', 'sem fornecedor, a sequência do item identifica');
}
{
  // E os dois caminhos casam a conta preservada por essa identidade, com a
  // parcela junto: sem ela, a parcela 2 seria confundida com a 1.
  const chave = /origem_fornecedor_id[\s\S]{0,120}fornecedor:\$\{forn\}\|parcela:/;
  for (const arquivo of ['src/lib/crm-integration.ts', 'src/app/api/vendas-crm/route.ts']) {
    const src = readFileSync(new URL('../' + arquivo, import.meta.url), 'utf8');
    eq(chave.test(src), true, `${arquivo}: a chave natural prefere o fornecedor e inclui a parcela`);
  }
}

console.log('\n--- a venda criada no financeiro não muda de forma ---');
{
  // /vendas/nova não passa a opção: continua com a conta única do cliente.
  const itens = [
    item({ fornecedor_id: 'f1', sequencia: 1, data: { fornecedor_nome: 'CVC', valor_venda: 3200, valor_custo: 3000 } }),
    item({ fornecedor_id: 'f2', sequencia: 2, data: { fornecedor_nome: 'Passeios Roma', valor_venda: 4000, valor_custo: 1000 } }),
  ];
  const r = gerar(itens, doisFornecedores);
  eq(r.contas_receber.length, 1, 'uma conta a receber para o cliente, como sempre');
  eq(r.contas_receber[0].valor_final, 7200, 'com o total da venda');
}

console.log('\n--- venda antiga que já recebeu não muda de forma ---');
{
  // Quebrar a conta a receber por fornecedor muda a CHAVE NATURAL dela (passa a
  // ter item de origem). Numa reentrega do evento, a conta agrupada já baixada
  // é preservada e as novas entrariam ao lado: a mesma receita, duas vezes.
  // Os dois caminhos do CRM decidem a forma pelo que já existe baixado.
  const guarda = /receberPorFornecedor = !\w+\.some\(\s*r => !String\(\(r\.data as Record<string, unknown>\)\?\.origem_item_id \?\? ''\),\s*\)/;
  for (const arquivo of ['src/lib/crm-integration.ts', 'src/app/api/vendas-crm/route.ts']) {
    const src = readFileSync(new URL('../' + arquivo, import.meta.url), 'utf8');
    eq(guarda.test(src), true, `${arquivo}: a forma da conta olha o que já foi baixado`);
    // e a leitura das baixadas acontece ANTES de gerar, senão a decisão chega tarde
    const iBaixadas = src.indexOf("FROM contas_receber\n");
    const iGerar = src.indexOf('gerarContasVenda({');
    eq(iBaixadas > 0 && iBaixadas < iGerar, true, `${arquivo}: lê as baixadas antes de gerar`);
  }
  // /vendas/nova continua sem a opção: venda criada no financeiro é conta única.
  const nova = readFileSync(new URL('../src/app/vendas/nova/page.tsx', import.meta.url), 'utf8');
  eq(nova.includes('receberPorFornecedor'), false, 'a venda manual não passa a opção');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes da regra de custo passaram`);
if (falhas > 0) process.exit(1);
