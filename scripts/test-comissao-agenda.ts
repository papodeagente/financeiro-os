/**
 * Agenda de pagamento de comissão (src/lib/comissao-agenda.ts).
 *
 * A agência escolhe em que dias do mês paga comissão. A comissão aprovada
 * vira conta a pagar com vencimento na próxima data dessa agenda. Errar
 * aqui adianta ou atrasa saída de dinheiro real, por isso o mês curto, a
 * virada de ano e a agenda ausente estão todos cobertos.
 *
 * Roda: node --experimental-strip-types scripts/test-comissao-agenda.ts
 */
import {
  normalizarDatas, diaNoMes, proximaDataPagamento, descreverAgenda,
} from '../src/lib/comissao-agenda.ts';

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

console.log('--- normalização da agenda ---');
eq(normalizarDatas([5, 20]), [5, 20], 'lista simples passa igual');
eq(normalizarDatas([20, 5]), [5, 20], 'ordena');
eq(normalizarDatas([5, 5, 20]), [5, 20], 'remove repetido');
eq(normalizarDatas(['5', 20.9, 0, 32, -3, null, 'x']), [5, 20], 'descarta o que não é dia válido');
eq(normalizarDatas(null), [], 'agenda nula vira lista vazia');
eq(normalizarDatas('5,20'), [], 'string não é lista de dias');

console.log('\n--- dia dentro do mês real ---');
eq(diaNoMes(2026, 2, 31), '2026-02-28', 'dia 31 em fevereiro vira o último dia');
eq(diaNoMes(2028, 2, 31), '2028-02-29', 'ano bissexto usa 29');
eq(diaNoMes(2026, 4, 31), '2026-04-30', 'dia 31 em mês de 30 vira 30');
eq(diaNoMes(2026, 9, 5), '2026-09-05', 'dia normal fica igual');

console.log('\n--- próxima data de pagamento ---');
eq(proximaDataPagamento([5, 20], '2026-09-01'), '2026-09-05', 'antes da primeira data do mês');
eq(proximaDataPagamento([5, 20], '2026-09-05'), '2026-09-05', 'no próprio dia de pagamento conta como hoje');
eq(proximaDataPagamento([5, 20], '2026-09-06'), '2026-09-20', 'passou a primeira, cai na segunda');
eq(proximaDataPagamento([5, 20], '2026-09-21'), '2026-10-05', 'passou todas, primeira do mês seguinte');
eq(proximaDataPagamento([5], '2026-12-31'), '2027-01-05', 'vira o ano corretamente');
eq(proximaDataPagamento([31], '2026-02-10'), '2026-02-28', 'dia 31 encurta no mês curto');
eq(proximaDataPagamento([31], '2026-03-01'), '2026-03-31', 'e volta ao 31 no mês cheio');
eq(proximaDataPagamento([10], '2026-09-30'), '2026-10-10', 'último dia do mês olha para o mês seguinte');
eq(proximaDataPagamento([1], '2026-09-01'), '2026-09-01', 'dia 1 no dia 1 é hoje');

console.log('\n--- agenda ausente ou inválida ---');
eq(proximaDataPagamento([], '2026-09-08'), null, 'sem agenda não inventa data');
eq(proximaDataPagamento(null, '2026-09-08'), null, 'agenda nula não inventa data');
eq(proximaDataPagamento([5, 20], ''), null, 'referência vazia não inventa data');

console.log('\n--- texto da agenda ---');
eq(descreverAgenda([5]), 'dia 5', 'uma data');
eq(descreverAgenda([5, 20]), 'dia 5 e dia 20', 'duas datas');
eq(descreverAgenda([5, 15, 25]), 'dia 5, dia 15 e dia 25', 'três datas');
eq(descreverAgenda([31]), 'último dia do mês', 'dia 31 tem nome próprio');
eq(descreverAgenda([]), '', 'sem agenda, texto vazio');

console.log(`\n${total - falhas}/${total} testes da agenda de comissão passaram`);
process.exit(falhas > 0 ? 1 : 0);
