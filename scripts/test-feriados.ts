/**
 * Feriados nacionais e dia útil (05/11/2026), de 2025 a 2030.
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-feriados.ts
 */
import {
  pascoa, feriadosDoAno, criarCalendario, ehDiaUtil, proximoDiaUtil, diaUtilAnterior,
  ultimoDiaUtilDoMes, motivoDeNaoSerUtil, CALENDARIO_NACIONAL,
} from '../src/lib/feriados.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else console.log(`PASS  ${label}`);
}

console.log('--- Páscoa e feriados móveis, 2025 a 2030 ---');
const MOVEIS: Record<number, { pascoa: string; carnavalSeg: string; carnavalTer: string; sexta: string; corpus: string }> = {
  2025: { pascoa: '2025-04-20', carnavalSeg: '2025-03-03', carnavalTer: '2025-03-04', sexta: '2025-04-18', corpus: '2025-06-19' },
  2026: { pascoa: '2026-04-05', carnavalSeg: '2026-02-16', carnavalTer: '2026-02-17', sexta: '2026-04-03', corpus: '2026-06-04' },
  2027: { pascoa: '2027-03-28', carnavalSeg: '2027-02-08', carnavalTer: '2027-02-09', sexta: '2027-03-26', corpus: '2027-05-27' },
  2028: { pascoa: '2028-04-16', carnavalSeg: '2028-02-28', carnavalTer: '2028-02-29', sexta: '2028-04-14', corpus: '2028-06-15' },
  2029: { pascoa: '2029-04-01', carnavalSeg: '2029-02-12', carnavalTer: '2029-02-13', sexta: '2029-03-30', corpus: '2029-05-31' },
  2030: { pascoa: '2030-04-21', carnavalSeg: '2030-03-04', carnavalTer: '2030-03-05', sexta: '2030-04-19', corpus: '2030-06-20' },
};
for (const [anoStr, m] of Object.entries(MOVEIS)) {
  const ano = Number(anoStr);
  eq(pascoa(ano), m.pascoa, `Páscoa de ${ano}`);
  const datas = feriadosDoAno(ano).map(f => f.data);
  eq(datas.includes(m.carnavalSeg) && datas.includes(m.carnavalTer), true, `Carnaval de ${ano} (segunda e terça)`);
  eq(datas.includes(m.sexta), true, `Sexta-feira Santa de ${ano}`);
  eq(datas.includes(m.corpus), true, `Corpus Christi de ${ano}`);
  for (const mmdd of ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']) {
    eq(datas.includes(`${ano}-${mmdd}`), true, `fixo ${mmdd}/${ano}`);
  }
  eq(new Set(datas).size, datas.length, `${ano}: nenhum dia repetido`);
  eq([...datas].sort(), datas, `${ano}: em ordem de data`);
}
eq(feriadosDoAno(2030).filter(f => f.data === '2030-04-21').length, 1, '2030: Tiradentes e Páscoa no mesmo dia viram um só');
eq(feriadosDoAno(2026).length, 13, '2026: 9 fixos + Sexta Santa + 2 de Carnaval + Corpus Christi');

console.log('--- Carnaval e Corpus Christi configuráveis ---');
const semFacultativos = criarCalendario({ carnaval: false, corpusChristi: false });
eq(ehDiaUtil('2026-02-17', semFacultativos), true, 'sem Carnaval: terça de Carnaval é dia útil');
eq(ehDiaUtil('2026-02-17'), false, 'calendário padrão: terça de Carnaval não é dia útil');
eq(ehDiaUtil('2026-06-04', semFacultativos), true, 'sem Corpus Christi: dia útil');
eq(ehDiaUtil('2026-04-03', semFacultativos), false, 'Sexta-feira Santa nunca é útil');
const comExtra = criarCalendario({ extras: ['2026-01-25'] });
eq(ehDiaUtil('2026-01-26', comExtra), true, 'feriado extra não afeta outro dia');
eq(comExtra.ehFeriado('2026-01-25'), true, 'feriado extra da agência entra');

console.log('--- Dia útil ---');
eq(ehDiaUtil('2026-11-05'), true, 'quinta comum é útil');
eq(ehDiaUtil('2026-11-07'), false, 'sábado não é útil');
eq(ehDiaUtil('2026-11-08'), false, 'domingo não é útil');
eq(ehDiaUtil('2026-11-20'), false, 'Consciência Negra (sexta) não é útil');
eq(proximoDiaUtil('2026-11-05'), '2026-11-05', 'próximo dia útil de um dia útil é ele mesmo');
eq(proximoDiaUtil('2026-11-20'), '2026-11-23', 'sexta feriado → segunda');
eq(proximoDiaUtil('2026-02-14'), '2026-02-18', 'sábado antes do Carnaval → quarta de cinzas');
eq(diaUtilAnterior('2026-02-17'), '2026-02-13', 'terça de Carnaval antecipa para a sexta');
eq(diaUtilAnterior('2026-11-15'), '2026-11-13', 'domingo 15/11 antecipa para sexta 13/11');
eq(proximoDiaUtil('2025-12-25'), '2025-12-26', 'Natal 2025 (quinta) → sexta');
eq(proximoDiaUtil('2027-12-31'), '2027-12-31', 'sexta 31/12/2027 é útil');
eq(proximoDiaUtil('2028-12-30'), '2029-01-02', 'sábado 30/12/2028 → terça 02/01/2029 (atravessa o ano)');

console.log('--- Último dia útil do mês ---');
eq(ultimoDiaUtilDoMes(2026, 1), '2026-01-30', 'jan/2026 termina num sábado → sexta 30');
eq(ultimoDiaUtilDoMes(2026, 2), '2026-02-27', 'fev/2026 → sexta 27');
eq(ultimoDiaUtilDoMes(2028, 2), '2028-02-25', 'fev/2028: 28 e 29 são Carnaval → sexta 25');
eq(ultimoDiaUtilDoMes(2028, 2, criarCalendario({ carnaval: false })), '2028-02-29', 'fev/2028 sem Carnaval → terça 29 (bissexto)');
eq(ultimoDiaUtilDoMes(2026, 5), '2026-05-29', 'mai/2026 termina num domingo → sexta 29');
eq(ultimoDiaUtilDoMes(2025, 12), '2025-12-31', 'dez/2025 → quarta 31');
eq(ultimoDiaUtilDoMes(2029, 3), '2029-03-29', 'mar/2029: 30 é Sexta-feira Santa, 31 sábado → quinta 29');

console.log('--- Motivo ---');
eq(motivoDeNaoSerUtil('2026-11-07'), 'sábado', 'motivo: sábado');
eq(motivoDeNaoSerUtil('2026-12-25'), 'Natal', 'motivo: Natal');
eq(motivoDeNaoSerUtil('2026-11-05'), null, 'dia útil não tem motivo');
eq(CALENDARIO_NACIONAL.nomeDoFeriado('2026-02-16'), 'Carnaval (segunda-feira)', 'nome do Carnaval');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
