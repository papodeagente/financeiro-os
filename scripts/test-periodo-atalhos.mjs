/**
 * Atalhos de período (06/11/2026, E7): Amanhã, Esta semana, Próximo mês,
 * Este ano, Próximos/Últimos 7 e 14 dias, Últimos 30 dias. E os de antes
 * continuam iguais (inclusive "Vencidos", que não é data).
 * Uso: node --no-warnings scripts/test-periodo-atalhos.mjs
 */
import { register } from 'node:module';

globalThis.__POOL_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
const { ROTULO_PERIODO, OPCOES_PERIODO_PADRAO, resolverPeriodoEm } = await import('../src/components/fin/PeriodPicker.tsx');

let falhas = 0;
let total = 0;
function eq(atual, esperado, label) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else console.log(`PASS  ${label}`);
}

// Quinta-feira, 06/11/2026.
const H = '2026-11-06';
eq(resolverPeriodoEm('AMANHA', H), { de: '2026-11-07', ate: '2026-11-07' }, 'Amanhã');
eq(resolverPeriodoEm('SEMANA_ATUAL', H), { de: '2026-11-01', ate: '2026-11-07' }, 'Esta semana: domingo a sábado');
eq(resolverPeriodoEm('SEMANA_ATUAL', '2026-11-01'), { de: '2026-11-01', ate: '2026-11-07' }, 'Esta semana num domingo começa nele');
eq(resolverPeriodoEm('SEMANA_ATUAL', '2026-11-07'), { de: '2026-11-01', ate: '2026-11-07' }, 'Esta semana num sábado termina nele');
eq(resolverPeriodoEm('SEMANA_ATUAL', '2026-12-31'), { de: '2026-12-27', ate: '2027-01-02' }, 'Esta semana atravessa o ano');
eq(resolverPeriodoEm('PROX_MES', H), { de: '2026-12-01', ate: '2026-12-31' }, 'Próximo mês');
eq(resolverPeriodoEm('PROX_MES', '2026-12-15'), { de: '2027-01-01', ate: '2027-01-31' }, 'Próximo mês em dezembro é janeiro do ano seguinte');
eq(resolverPeriodoEm('PROX_MES', '2027-01-31'), { de: '2027-02-01', ate: '2027-02-28' }, 'Próximo mês termina no último dia (fevereiro)');
eq(resolverPeriodoEm('ANO_ATUAL', H), { de: '2026-01-01', ate: '2026-12-31' }, 'Este ano');
eq(resolverPeriodoEm('PROX_7', H), { de: H, ate: '2026-11-13' }, 'Próximos 7 dias');
eq(resolverPeriodoEm('PROX_14', H), { de: H, ate: '2026-11-20' }, 'Próximos 14 dias');
eq(resolverPeriodoEm('ULT_7', H), { de: '2026-10-30', ate: H }, 'Últimos 7 dias');
eq(resolverPeriodoEm('ULT_14', H), { de: '2026-10-23', ate: H }, 'Últimos 14 dias');
eq(resolverPeriodoEm('ULT_30', '2026-03-01'), { de: '2026-01-30', ate: '2026-03-01' }, 'Últimos 30 dias atravessa fevereiro');

// Os de antes, iguais.
eq(resolverPeriodoEm('MES_ATUAL', H), { de: '2026-11-01', ate: '2026-11-30' }, 'Este mês (como antes)');
eq(resolverPeriodoEm('PROX_30', H), { de: H, ate: '2026-12-06' }, 'Próximos 30 dias (como antes)');
eq(resolverPeriodoEm('MES_PASSADO', H), { de: '2026-10-01', ate: '2026-10-31' }, 'Mês passado (como antes)');
eq(resolverPeriodoEm('VENCIDOS', H), { de: '', ate: '', somenteVencidos: true }, 'Vencidos continua sem data');
eq(resolverPeriodoEm('TUDO', H), { de: '', ate: '' }, 'Todo o período');
eq(resolverPeriodoEm('PERSONALIZADO', H, '2026-01-02', '2026-02-03'), { de: '2026-01-02', ate: '2026-02-03' }, 'Personalizado');

// Toda chave tem rótulo; a lista padrão das telas antigas não mudou.
const chaves = ['AMANHA', 'SEMANA_ATUAL', 'PROX_MES', 'ANO_ATUAL', 'PROX_7', 'PROX_14', 'ULT_7', 'ULT_14', 'ULT_30'];
eq(chaves.every(c => typeof ROTULO_PERIODO[c] === 'string' && ROTULO_PERIODO[c].length > 0), true, 'atalhos novos com rótulo');
eq(OPCOES_PERIODO_PADRAO, ['MES_ATUAL', 'PROX_30', 'PROX_90', 'VENCIDOS', 'MES_PASSADO', 'TUDO', 'PERSONALIZADO'], 'lista padrão das telas de antes intocada');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
