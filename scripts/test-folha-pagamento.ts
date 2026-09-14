/**
 * Folha de pagamento (src/lib/folha-pagamento.ts).
 *
 * Custo de pessoa não é salário. Estes testes fixam o que entra no custo,
 * quem está na folha em cada mês, e o que acontece quando não há
 * faturamento para comparar.
 */
import {
  custoMensal, montarFolha, montarEvolucao, estaNaFolhaNoMes,
  contaFolhaId, ENCARGO_SUGERIDO, eventosFolhaPrevistos, dataPagamentoDaFolha,
} from '../src/lib/folha-pagamento.ts';
import { soma } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const vinculo = (extra = {}) => ({
  tipo_contrato: 'CLT', cargo: 'Consultor', data_admissao: '2026-01-10',
  data_desligamento: '', salario_base: 3000, beneficios: [],
  encargos_pct: 0, provisiona_13_ferias: false, na_folha: true, observacoes: '',
  ...extra,
}) as never;

const pessoa = (id: string, nome: string, extra = {}) => ({ id, nome, vinculo: vinculo(extra) });

console.log('--- custo de uma pessoa ---');
eq(custoMensal(vinculo()).total, 3000, 'só salário quando não há encargo nem benefício');
{
  const c = custoMensal(vinculo({ beneficios: [{ nome: 'VR', valor: 600 }, { nome: 'Plano', valor: 400 }] }));
  eq([c.beneficios, c.total], [1000, 4000], 'benefícios somam ao custo');
}
{
  const c = custoMensal(vinculo({ encargos_pct: 36.8 }));
  eq([c.encargos, c.total], [1104, 4104], 'encargo é percentual sobre o salário');
}
{
  // 13º = 3000/12 = 250. Férias = 3000 * 1,3333/12 = 333,33. Soma 583,33.
  const c = custoMensal(vinculo({ provisiona_13_ferias: true }));
  eq(c.provisoes, 583.33, '13º e férias rateados por mês');
  eq(c.total, 3583.33, 'e entram no custo, para dezembro não dar salto');
}
{
  const c = custoMensal(vinculo({ provisiona_13_ferias: false }));
  eq(c.provisoes, 0, 'PJ não provisiona');
}
eq(custoMensal(undefined).total, 0, 'pessoa sem vínculo custa zero, não quebra');
eq(custoMensal(vinculo({ salario_base: -500 })).total, 0, 'salário negativo não vira crédito');
eq(ENCARGO_SUGERIDO.PJ, 0, 'PJ sugere encargo zero');

console.log('\n--- quem está na folha no mês ---');
eq(estaNaFolhaNoMes(vinculo({ data_admissao: '2026-09-20' }), '2026-09'), true,
   'admitido no meio do mês conta nesse mês, porque houve pagamento');
eq(estaNaFolhaNoMes(vinculo({ data_admissao: '2026-10-01' }), '2026-09'), false,
   'quem ainda não foi admitido não conta');
eq(estaNaFolhaNoMes(vinculo({ data_desligamento: '2026-09-03' }), '2026-09'), true,
   'desligado no meio do mês ainda conta nesse mês');
eq(estaNaFolhaNoMes(vinculo({ data_desligamento: '2026-08-31' }), '2026-09'), false,
   'desligado no mês anterior sai da folha');
eq(estaNaFolhaNoMes(vinculo({ na_folha: false }), '2026-09'), false,
   'marcado fora da folha não conta mesmo sem desligamento');
eq(estaNaFolhaNoMes(undefined, '2026-09'), false, 'sem vínculo não está na folha');

console.log('\n--- resumo da folha ---');
{
  const pessoas = [
    pessoa('u1', 'Ana', { salario_base: 5000, encargos_pct: 36.8, provisiona_13_ferias: true, beneficios: [{ nome: 'VR', valor: 600 }] }),
    pessoa('u2', 'Bia', { salario_base: 3000, tipo_contrato: 'PJ', encargos_pct: 0 }),
    pessoa('u3', 'Caio', { salario_base: 9000, na_folha: false }),
  ];
  const f = montarFolha(pessoas, '2026-09');
  eq(f.quantidade, 2, 'quem está fora da folha não entra');
  eq(f.salarios, 8000, 'soma dos salários');
  eq(f.beneficios, 600, 'soma dos benefícios');
  eq(f.encargos, 1840, 'soma dos encargos');
  eq(f.provisoes, 972.22, 'soma das provisões');
  eq(f.total, 11412.22, 'custo total da folha');
  eq(soma(f.pessoas.map(p => p.custo.total)), f.total, 'o total bate com a soma das pessoas');
  eq(f.pessoas.map(p => p.nome), ['Ana', 'Bia'], 'ordena da pessoa mais cara para a mais barata');
  eq(f.custo_medio, 5706.11, 'custo médio por pessoa');
  eq(f.por_contrato.map(c => [c.tipo, c.quantidade]), [['CLT', 1], ['PJ', 1]], 'agrupa por contrato');
  eq(f.por_contrato[0].share_pct, 73.71, 'participação de cada contrato no custo');
}
{
  const f = montarFolha([], '2026-09');
  eq([f.quantidade, f.total, f.custo_medio], [0, 0, 0], 'folha vazia não divide por zero');
}

console.log('\n--- folha contra faturamento ---');
{
  const pessoas = [pessoa('u1', 'Ana', { salario_base: 5000 })];
  const fat = new Map([['2026-08', 50000], ['2026-09', 25000], ['2026-10', 0]]);
  const ev = montarEvolucao(pessoas, fat, ['2026-08', '2026-09', '2026-10']);
  eq(ev.map(p => p.folha_sobre_faturamento_pct), [10, 20, 0],
     'percentual sobe quando a receita cai');
  eq(ev[2].faturamento, 0, 'mês sem faturamento não inventa receita');
  eq(ev.map(p => p.pessoas), [1, 1, 1], 'conta as pessoas de cada mês');
}
{
  // Contratação no meio da série: a folha do mês anterior não pode subir.
  const pessoas = [
    pessoa('u1', 'Ana', { salario_base: 5000 }),
    pessoa('u2', 'Novo', { salario_base: 4000, data_admissao: '2026-09-01' }),
  ];
  const ev = montarEvolucao(pessoas, new Map(), ['2026-08', '2026-09']);
  eq(ev.map(p => [p.pessoas, p.folha]), [[1, 5000], [2, 9000]],
     'quem entrou em setembro não aparece em agosto');
}

console.log('\n--- id da conta a pagar ---');
eq(contaFolhaId('2026-09', 'u1'), 'folha-2026-09-u1', 'id determinístico por mês e pessoa');

console.log('\n--- data em que o dinheiro sai ---');
eq(dataPagamentoDaFolha('2026-09', 5), '2026-10-05', 'a folha de setembro sai em outubro');
eq(dataPagamentoDaFolha('2026-12', 5), '2027-01-05', 'dezembro vira o ano');
eq(dataPagamentoDaFolha('2026-01', 31), '2026-02-28', 'dia 31 encurta em fevereiro');
eq(dataPagamentoDaFolha('2028-01', 31), '2028-02-29', 'e respeita o ano bissexto');
eq(dataPagamentoDaFolha('2026-09', 1), '2026-10-01', 'dia 1');

console.log('\n--- previsão da folha no fluxo de caixa ---');
{
  const pessoas = [pessoa('u1', 'Ana', { salario_base: 5000 }), pessoa('u2', 'Bia', { salario_base: 3000 })];
  const ev = eventosFolhaPrevistos(pessoas, ['2026-09', '2026-10'], 5);
  eq(ev.map(e => [e.competencia, e.data_pagamento, e.valor, e.pessoas]),
     [['2026-09', '2026-10-05', 8000, 2], ['2026-10', '2026-11-05', 8000, 2]],
     'um evento por competência, pagando no mês seguinte');
  eq(ev[0].descricao, 'Folha de 2026-09 · 2 pessoas', 'descrição diz de que mês é');
}
{
  // O ponto que evita contar duas vezes: se a folha do mês já virou conta
  // a pagar, a previsão sai de cena e quem manda é a conta real.
  const pessoas = [pessoa('u1', 'Ana', { salario_base: 5000 })];
  const jaLancada = [contaFolhaId('2026-09', 'u1')];
  const ev = eventosFolhaPrevistos(pessoas, ['2026-09', '2026-10'], 5, jaLancada);
  eq(ev.map(e => e.competencia), ['2026-10'],
     'mês já lançado como conta a pagar não entra de novo na previsão');
}
{
  const pessoas = [pessoa('u1', 'Ana', { salario_base: 5000, na_folha: false })];
  eq(eventosFolhaPrevistos(pessoas, ['2026-09'], 5).length, 0, 'ninguém na folha, nenhum evento');
}
{
  const pessoas = [pessoa('u1', 'Novo', { salario_base: 4000, data_admissao: '2026-10-01' })];
  eq(eventosFolhaPrevistos(pessoas, ['2026-09', '2026-10'], 5).map(e => e.competencia), ['2026-10'],
     'quem entra em outubro não aparece na folha de setembro');
}
eq(eventosFolhaPrevistos([], ['2026-09'], 5), [], 'sem pessoas não gera previsão');
eq(eventosFolhaPrevistos([pessoa('u1', 'Ana', { salario_base: 5000 })], ['setembro'], 5), [],
   'competência com formato inválido é ignorada, não vira data estranha');
{
  const pessoas = [pessoa('u1', 'Ana', { salario_base: 5000 })];
  eq(eventosFolhaPrevistos(pessoas, ['2026-09'], 0)[0].data_pagamento, '2026-10-05',
     'dia zero cai no padrão em vez de virar data inválida');
  eq(eventosFolhaPrevistos(pessoas, ['2026-09'], 99)[0].data_pagamento, '2026-10-31',
     'dia acima de 31 é limitado ao fim do mês');
}

console.log(`\n${total - falhas}/${total} testes da folha passaram`);
process.exit(falhas > 0 ? 1 : 0);
