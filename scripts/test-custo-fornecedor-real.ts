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
import { montarLinhasDeCusto, DESCRICAO_SEM_FORNECEDOR } from '../src/lib/venda-crm-itens.ts';
import { soma } from '../src/lib/money.ts';

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
console.log(`\n${total - falhas}/${total} testes da regra de custo passaram`);
if (falhas > 0) process.exit(1);
