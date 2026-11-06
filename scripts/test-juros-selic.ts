/**
 * Juros da política pela Selic (E7, 06/11/2026): regras puras.
 *   · a conta de % ao ano para % ao mês (juros compostos);
 *   · as opções que o cache oferece (Selic do mês fechado e meta);
 *   · a referência (fonte e data) só vale enquanto o número for o dela;
 *   · normalizarPolitica sem referência sai exatamente como antes.
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-juros-selic.ts
 */
import { opcoesDeJurosPelaSelic, referenciaDaOpcao, referenciaValida, selicAnualParaMensal, textoDaReferencia } from '../src/lib/juros-selic.ts';
import { normalizarPolitica } from '../src/lib/baixa-calculo.ts';
import type { ValorDeIndice } from '../src/lib/cambio.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- Fórmula ---');
// (1,15)^(1/12) − 1 = 0,011714917… → 1,17% ao mês
eq(selicAnualParaMensal(15), 1.17, '15% ao ano = 1,17% ao mês (composto, não 15/12 = 1,25)');
eq(selicAnualParaMensal(12.68), 1, '12,68% ao ano ≈ 1,00% ao mês');
eq(selicAnualParaMensal(0), 0, 'zero');
eq(selicAnualParaMensal(-150), 0, 'valor sem sentido: zero');

console.log('--- Opções do cache ---');
const indices: ValorDeIndice[] = [
  { indice: 'selic_mes', referencia: '2026-09', valor: 1.22 },
  { indice: 'selic_mes', referencia: '2026-10', valor: 1.28 },
  { indice: 'selic_mes', referencia: '2026-11', valor: 0.31, parcial: true },
  { indice: 'selic_meta', referencia: '2026-11-05', valor: 15 },
  { indice: 'ipca', referencia: '2026-10', valor: 0.4 },
];
const op = opcoesDeJurosPelaSelic(indices);
eq(op.map(o => [o.indice, o.referencia, o.valor_am_pct, o.fonte]), [
  ['selic_mes', '2026-10', 1.28, 'Banco Central, série 4390'],
  ['selic_meta', '2026-11-05', 1.17, 'Banco Central, série 432'],
], 'Selic do último mês FECHADO (o mês em curso fica de fora) e a meta convertida');
eq(op[1].conta, 'Meta de 15,00% ao ano em 05/11/2026: (1 + 15,00%)^(1/12) − 1 = 1,17% ao mês.', 'a conta aparece por extenso');
eq(opcoesDeJurosPelaSelic([]), [], 'sem índice no cache: nenhuma opção (a tela diz que ainda não chegou)');

console.log('--- Referência guardada ---');
const ref = referenciaDaOpcao(op[0], new Date('2026-11-06T13:00:00Z'));
eq(ref, { indice: 'selic_mes', referencia: '2026-10', valor_am_pct: 1.28, fonte: 'Banco Central, série 4390', usado_em: '2026-11-06T13:00:00.000Z' }, 'fonte e data junto do valor');
eq(referenciaValida(ref, 1.28)?.referencia, '2026-10', 'vale com o mesmo número');
eq(referenciaValida(ref, 1.5), null, 'a pessoa digitou outro número: a referência some');
eq(referenciaValida({ indice: 'ipca', referencia: '2026-10', valor_am_pct: 1 }, 1), null, 'só Selic');
eq(textoDaReferencia(ref), 'Selic de out/2026 (Banco Central, série 4390), escolhida em 06/11/2026.', 'frase da tela');

console.log('--- Política ---');
eq(normalizarPolitica({ juros_am_pct: 2, multa_pct: 2 }),
  { juros_am_pct: 2, multa_pct: 2, tolerancia_dias: 0, desconto_antecipacao: null, aplicar_em_pagar: false },
  'sem referência: exatamente o objeto de antes');
eq(normalizarPolitica({ juros_am_pct: 1.28, juros_referencia: ref }).juros_referencia?.indice, 'selic_mes', 'com a Selic escolhida: guarda a referência');
eq('juros_referencia' in normalizarPolitica({ juros_am_pct: 3, juros_referencia: ref }), false, 'número trocado à mão: a referência não é gravada');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
