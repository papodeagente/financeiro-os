/**
 * Janela de projeção do fluxo de caixa (src/lib/janela-fluxo.ts).
 *
 * O horizonte deixou de ser só um tamanho: agora tem deslocamento, para
 * "próximo mês" existir, e aceita período escolhido à mão.
 */
import {
  mesesDaJanela, inicioDaJanela, fimDaJanela, semanasDaJanela,
  descreverJanela, acharPreset, PRESETS, MAX_MESES,
} from '../src/lib/janela-fluxo.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const HOJE = '2026-09-14';
const preset = (id: string) => ({ tipo: 'preset' as const, id });

console.log('--- presets curtos, que é o que faltava ---');
eq(mesesDaJanela(preset('atual'), HOJE), ['2026-09'], 'este mês traz só o mês corrente');
eq(mesesDaJanela(preset('proximo'), HOJE), ['2026-10'], 'próximo mês PULA o corrente');
eq(mesesDaJanela(preset('2'), HOJE), ['2026-09', '2026-10'], '2 meses é o corrente mais o seguinte');

console.log('--- presets que já existiam continuam iguais ---');
eq(mesesDaJanela(preset('3'), HOJE), ['2026-09', '2026-10', '2026-11'], '3 meses');
eq(mesesDaJanela(preset('6'), HOJE).length, 6, '6 meses');
eq(mesesDaJanela(preset('12'), HOJE).length, 12, '12 meses');
eq(mesesDaJanela(preset('12'), HOJE)[11], '2027-08', '12 meses vira o ano corretamente');

console.log('--- período escolhido à mão ---');
eq(mesesDaJanela({ tipo: 'personalizado', de: '2026-11-10', ate: '2027-01-20' }, HOJE),
   ['2026-11', '2026-12', '2027-01'], 'do mês da data inicial ao mês da final, inclusive');
eq(mesesDaJanela({ tipo: 'personalizado', de: '2026-11-01', ate: '2026-11-30' }, HOJE),
   ['2026-11'], 'mesmo mês nas duas pontas devolve um mês');
eq(mesesDaJanela({ tipo: 'personalizado', de: '2027-01-20', ate: '2026-11-10' }, HOJE),
   ['2026-11', '2026-12', '2027-01'], 'datas invertidas não zeram a janela: quem escolheu quis o intervalo');
eq(mesesDaJanela({ tipo: 'personalizado', de: '2026-06-01', ate: '2027-06-01' }, HOJE).length, 13,
   'intervalo longo é respeitado');
eq(mesesDaJanela({ tipo: 'personalizado', de: '2020-01-01', ate: '2030-01-01' }, HOJE).length, MAX_MESES,
   'intervalo absurdo é limitado, em vez de travar a tela');

console.log('--- entrada inválida não vira data estranha ---');
eq(mesesDaJanela({ tipo: 'personalizado', de: '', ate: '2026-11-01' }, HOJE), [], 'data inicial vazia');
eq(mesesDaJanela({ tipo: 'personalizado', de: 'ontem', ate: 'amanhã' }, HOJE), [], 'texto que não é data');
eq(mesesDaJanela(preset('inexistente'), HOJE).length, 6, 'preset desconhecido cai no padrão de 6 meses');
eq(acharPreset('zzz').id, '6', 'acharPreset devolve o padrão');

console.log('--- limites da janela ---');
eq(inicioDaJanela(preset('proximo'), HOJE), '2026-10-01', 'a janela começa no primeiro dia do mês inicial');
eq(fimDaJanela(preset('proximo'), HOJE), '2026-10-31', 'e termina no último dia do mês final');
eq(fimDaJanela({ tipo: 'personalizado', de: '2027-02-05', ate: '2027-02-10' }, HOJE), '2027-02-28',
   'fevereiro termina em 28');
eq(fimDaJanela({ tipo: 'personalizado', de: '2028-02-05', ate: '2028-02-10' }, HOJE), '2028-02-29',
   'e em 29 no ano bissexto');

console.log('--- semanas ---');
{
  const s = semanasDaJanela(preset('atual'), HOJE);
  eq(s[0].inicio, '2026-08-30', 'a primeira semana começa no domingo que contém o dia 1');
  eq(s[0].fim, '2026-09-05', 'e termina no sábado');
  eq(s[s.length - 1].inicio <= '2026-09-30', true, 'a última semana começa dentro da janela');
  eq(s.length >= 4 && s.length <= 6, true, 'um mês tem de 4 a 6 semanas');
}
eq(semanasDaJanela({ tipo: 'personalizado', de: 'x', ate: 'y' }, HOJE), [], 'janela inválida não gera semana');

console.log('--- texto da janela ---');
eq(descreverJanela(preset('atual'), HOJE), 'este mês', 'preset usa o próprio rótulo');
eq(descreverJanela({ tipo: 'personalizado', de: '2026-11-01', ate: '2027-01-01' }, HOJE),
   'nov/2026 a jan/2027', 'personalizado diz o intervalo');
eq(descreverJanela({ tipo: 'personalizado', de: '2026-11-01', ate: '2026-11-30' }, HOJE),
   'nov/2026', 'um mês só não repete o nome');
eq(descreverJanela({ tipo: 'personalizado', de: '', ate: '' }, HOJE), 'período inválido', 'e avisa quando não dá');

console.log('--- os presets pedidos existem ---');
eq(PRESETS.map(p => p.id), ['atual', 'proximo', '2', '3', '6', '12'], 'seis opções, da mais curta à mais longa');

console.log(`\n${total - falhas}/${total} testes da janela passaram`);
process.exit(falhas > 0 ? 1 : 0);
