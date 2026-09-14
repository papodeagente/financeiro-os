import assert from 'node:assert/strict';
import {
  criarPlanoCustosPadrao,
  hidratarPlanoCustos,
  mesPlanejamentoValido,
  validarPayloadPlanoCustos,
} from '../src/lib/planejamento-custos-schema.ts';

let checks = 0;
function testar(nome: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`PASS ${nome}`);
}

testar('plano padrão contém todas as linhas e bases auditáveis', () => {
  const plano = criarPlanoCustosPadrao('2026-09', 'novo-1');
  assert.equal(plano.custos_fixos.length, 5);
  assert.equal(plano.custos_variaveis.length, 4);
  assert.equal(plano.marketing.length, 6);
  assert.equal(plano.custos_variaveis.find(item => item.nome === 'Impostos')?.base, 'COMISSAO');
  assert.equal(plano.custos_variaveis.find(item => item.nome === 'Taxa cartão/boleto')?.base, 'VENDA');
});

testar('hidratação recompõe categorias sem apagar dados legados', () => {
  const plano = hidratarPlanoCustos({
    id: 'legado-1',
    custos_fixos: [
      { categoria: 'Aluguel', valor: '1.000,10', observacao: 'Sala' },
      { categoria: 'aluguel/sede', valor: 200.2, observacao: 'Garagem' },
      { categoria: 'Contabilidade', valor: 500, observacao: 'Contrato' },
    ],
    custos_variaveis: [
      { nome: 'Comissao vendedor', percentual: 7 },
      { nome: 'Imposto', percentual: 5.5 },
    ],
    marketing: [{ canal: 'Meta Ads', valor: 700 }],
    ticket_medio: '12.000,50',
    margem_comissao: 30,
    taxa_conversao: 12,
    lucro_desejado: 5000,
    dias_uteis: 20,
    vendedores_ativos: 2,
  }, '2026-10', 'novo-ignorado');

  assert.equal(plano.id, 'legado-1');
  assert.equal(plano.mes, '2026-10');
  assert.deepEqual(plano.custos_fixos.find(item => item.categoria === 'Aluguel/Sede'), {
    categoria: 'Aluguel/Sede', valor: 1200.3, observacao: 'Sala · Garagem',
  });
  assert.equal(plano.custos_fixos.some(item => item.categoria === 'Folha de pagamento'), true);
  assert.equal(plano.custos_fixos.find(item => item.categoria === 'Contabilidade')?.valor, 500);
  assert.deepEqual(plano.custos_variaveis.find(item => item.nome === 'Comissão vendedor'), {
    nome: 'Comissão vendedor', percentual: 7, base: 'COMISSAO',
  });
  assert.deepEqual(plano.custos_variaveis.find(item => item.nome === 'Impostos'), {
    nome: 'Impostos', percentual: 5.5, base: 'COMISSAO',
  });
  assert.equal(plano.custos_variaveis.find(item => item.nome === 'Taxa cartão/boleto')?.percentual, 4.5);
  assert.equal(plano.marketing.find(item => item.canal === 'Instagram Ads')?.valor, 700);
  assert.equal(plano.ticket_medio, 12000.5);
});

testar('valores zerados persistidos não são trocados pelos defaults', () => {
  const base = criarPlanoCustosPadrao('2026-09', 'p-zero');
  const plano = hidratarPlanoCustos({
    ...base,
    ticket_medio: 0,
    margem_comissao: 0,
    taxa_conversao: 0,
    lucro_desejado: 0,
  }, base.mes, 'outro');
  assert.equal(plano.ticket_medio, 0);
  assert.equal(plano.margem_comissao, 0);
  assert.equal(plano.taxa_conversao, 0);
  assert.equal(plano.lucro_desejado, 0);
});

testar('validação aceita contrato completo e normaliza centavos', () => {
  const base = criarPlanoCustosPadrao('2026-09', 'id-cliente-ignorado-pela-api');
  base.custos_fixos[0].valor = 100.125;
  const result = validarPayloadPlanoCustos(base);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.custos_fixos[0].valor, 100.13);
});

testar('validação rejeita mês, estruturas, números e bases inválidos', () => {
  const base = criarPlanoCustosPadrao('2026-09', 'p1');
  const invalidos: unknown[] = [
    null,
    { ...base, mes: '09/2026' },
    { ...base, custos_fixos: null },
    { ...base, ticket_medio: Number.NaN },
    { ...base, lucro_desejado: -1 },
    { ...base, margem_comissao: 101 },
    { ...base, dias_uteis: 0 },
    { ...base, vendedores_ativos: 1.5 },
    { ...base, custos_variaveis: [{ nome: 'Taxa', percentual: 10, base: 'TOTAL' }] },
    { ...base, marketing: [{ canal: 'Meta', valor: -1 }] },
  ];
  for (const invalido of invalidos) assert.equal(validarPayloadPlanoCustos(invalido).ok, false);
});

testar('competência mensal é validada sem depender de Date/fuso', () => {
  assert.equal(mesPlanejamentoValido('2026-01'), true);
  assert.equal(mesPlanejamentoValido('2026-12'), true);
  assert.equal(mesPlanejamentoValido('2026-00'), false);
  assert.equal(mesPlanejamentoValido('2026-13'), false);
  assert.equal(mesPlanejamentoValido('2026-1'), false);
});

console.log(`\n${checks}/${checks} testes passaram`);
