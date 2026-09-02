/**
 * Testes da aritmética financeira (src/lib/money.ts).
 * Roda sem dependências: `node --experimental-strip-types scripts/test-money.ts`
 */
import {
  round2, num, soma, somaPor, percentual, divSegura, variacaoPct,
  dividirParcelas, ratearDesconto, paraBRL, parseMoneyBR,
  dataLocal, paraISO, addDias, addMeses, dataSegura, estaVencido,
  mesDe, dentroDoPeriodo, ultimoDiaDoMes,
} from '../src/lib/money.ts';

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

console.log('--- dinheiro ---');
eq(round2(0.1 + 0.2), 0.3, 'round2 corrige 0.1+0.2');
eq(round2(1.005), 1.01, 'round2(1.005) = 1.01 (não trunca pra 1.00)');
eq(round2(-1.005), -1.01, 'round2 negativo simétrico');
eq(round2(NaN), 0, 'round2(NaN) = 0');
eq(num(undefined), 0, 'num(undefined) = 0');
eq(num('1.234,56'), 1234.56, 'num parseia string pt-BR');

// somatório longo: 1000 × 0.01 deve dar exatamente 10
eq(soma(Array(1000).fill(0.01)), 10, 'soma de 1000×0.01 = 10 exato');
eq(soma([0.1, 0.2, 0.3]), 0.6, 'soma sem erro de float');
eq(soma([1, null, undefined, NaN as unknown as number, 2]), 3, 'soma ignora nulos/NaN');
eq(somaPor([{ v: 10.555 }, { v: 20.444 }], x => x.v), 31, 'somaPor arredonda por item');

eq(percentual(1000, 12.5), 125, 'percentual 12.5% de 1000');
eq(percentual(99.99, 10), 10, 'percentual arredonda a 2 casas');
eq(divSegura(10, 0), 0, 'divSegura por zero = 0 (sem Infinity)');
eq(variacaoPct(150, 100), 50, 'variacaoPct +50%');
eq(variacaoPct(100, 0), null, 'variacaoPct sem base = null');
eq(variacaoPct(-50, -100), 50, 'variacaoPct com base negativa usa módulo');

console.log('--- parcelamento ---');
const p3 = dividirParcelas(100, 3);
eq(p3, [33.33, 33.33, 33.34], 'divide 100 em 3 com resíduo na última');
eq(soma(p3), 100, 'parcelas de 100/3 somam exatamente 100');
const p7 = dividirParcelas(1000, 7);
eq(soma(p7), 1000, 'parcelas de 1000/7 somam exatamente 1000');
eq(soma(dividirParcelas(0.05, 3)), 0.05, 'parcelas de centavos somam o total');
eq(dividirParcelas(500, 1), [500], 'parcela única = total');
eq(dividirParcelas(500, 0), [500], 'n=0 vira 1 parcela');

console.log('--- desconto rateado ---');
const rd = ratearDesconto([6000, 4000], 1000);
eq(soma(rd), 9000, 'desconto de 1000 sobre 10000 → soma 9000');
eq(rd, [5400, 3600], 'desconto proporcional 60/40');
const rd2 = ratearDesconto([33.33, 33.33, 33.34], 10);
eq(soma(rd2), 90, 'rateio com resíduo fecha exato');
eq(ratearDesconto([100, 200], 0), [100, 200], 'desconto zero não altera');

console.log('--- moeda estrangeira ---');
eq(paraBRL(100, 'USD', 5.5), 550, 'USD × câmbio');
eq(paraBRL(100, 'BRL', 5.5), 100, 'BRL ignora câmbio');
eq(paraBRL(100, 'USD', 0), 100, 'câmbio 0 não zera o valor');
eq(paraBRL(100, undefined, undefined), 100, 'sem moeda = BRL');

console.log('--- parser de moeda ---');
eq(parseMoneyBR('1.234,56'), 1234.56, 'pt-BR completo');
eq(parseMoneyBR('1,234.56'), 1234.56, 'en-US completo');
eq(parseMoneyBR('1.500'), 1500, '"1.500" = mil e quinhentos (milhar)');
eq(parseMoneyBR('1.50'), 1.5, '"1.50" = um e cinquenta (decimal)');
eq(parseMoneyBR('1500'), 1500, 'sem separador');
eq(parseMoneyBR('R$ 99,90'), 99.9, 'com símbolo');
eq(parseMoneyBR('-1.234,56'), -1234.56, 'negativo');
eq(parseMoneyBR('1.234.567,89'), 1234567.89, 'múltiplos milhares');
eq(parseMoneyBR('1.234.567'), 1234567, 'múltiplos milhares sem decimal');
eq(parseMoneyBR(''), null, 'vazio = null');
eq(parseMoneyBR('abc'), null, 'texto = null');
eq(parseMoneyBR(42), 42, 'número passa direto');

console.log('--- datas civis ---');
eq(paraISO(dataLocal('2026-03-15')), '2026-03-15', 'ida e volta sem perder o dia');
eq(dataLocal('2026-03-15')!.getHours(), 12, 'ancorado ao meio-dia');
eq(dataLocal('2026-01-01')!.getDate(), 1, 'primeiro do ano não volta pra 31/12');
eq(addDias('2026-01-31', 1), '2026-02-01', 'vira o mês');
eq(addDias('2026-03-01', -1), '2026-02-28', 'volta um dia (2026 não é bissexto)');
eq(addDias('2024-03-01', -1), '2024-02-29', 'ano bissexto');
eq(addMeses('2026-01-31', 1), '2026-02-28', '31/01 + 1 mês = 28/02 (clamp)');
eq(addMeses('2026-01-31', 3), '2026-04-30', '31/01 + 3 meses = 30/04 (clamp)');
eq(addMeses('2026-12-15', 1), '2027-01-15', 'vira o ano');
eq(addMeses('2026-03-15', -3), '2025-12-15', 'meses negativos');
eq(dataSegura(2026, 2, 31), '2026-02-28', 'dataSegura clampa 31/02');
eq(dataSegura(2024, 2, 31), '2024-02-29', 'dataSegura em ano bissexto');
eq(ultimoDiaDoMes(2026, 2), 28, 'fevereiro 2026');
eq(ultimoDiaDoMes(2024, 2), 29, 'fevereiro 2024');
eq(estaVencido('2020-01-01'), true, 'data antiga vencida');
eq(estaVencido('2999-01-01'), false, 'data futura não vencida');
eq(estaVencido(null), false, 'sem data não vence');
eq(estaVencido('2026-05-10', '2026-05-10'), false, 'vence hoje ainda NÃO está vencido');
eq(mesDe('2026-01-31'), '2026-01', 'mês do dia 31 não escorrega');
eq(mesDe('2026-12-01'), '2026-12', 'mês do dia 1 não escorrega');
eq(dentroDoPeriodo('2026-01-01', '2026-01-01', '2026-01-31'), true, 'borda inicial inclusiva');
eq(dentroDoPeriodo('2026-01-31', '2026-01-01', '2026-01-31'), true, 'borda final inclusiva');
eq(dentroDoPeriodo('2026-02-01', '2026-01-01', '2026-01-31'), false, 'fora do período');

console.log(`\n${total - falhas}/${total} testes passaram`);
if (falhas > 0) {
  console.log(`${falhas} FALHAS`);
  process.exit(1);
}
