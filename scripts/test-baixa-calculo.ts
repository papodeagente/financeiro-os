/**
 * Regra pura da liquidação (src/lib/baixa-calculo.ts), 05/11/2026.
 * Uso: node --experimental-strip-types scripts/run-tests.mjs scripts/test-baixa-calculo.ts
 */
import { calcularEncargos, planoDaBaixa, tituloDepoisDaBaixa, tituloDepoisDoEstorno, saldoDoTitulo } from '../src/lib/baixa-calculo.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const receber = (extra = {}) => ({ tabela: 'contas_receber' as const, status: 'PENDENTE', valor_final: 1000, valor_baixado: 0, data_vencimento: '2026-10-01', ...extra });
const politica = { juros_am_pct: 3, multa_pct: 2, tolerancia_dias: 0 };

console.log('--- Encargos ---');
eq(calcularEncargos(receber(), '2026-10-31', politica), { dias_atraso: 30, juros: 30, multa: 20, desconto_antecipacao: 0 }, '30 dias de atraso: 3% a.m. = R$ 30 + multa 2% = R$ 20');
eq(calcularEncargos(receber(), '2026-10-11', politica).juros, 10, 'juros simples proporcional por dia (10 dias = 1%)');
eq(calcularEncargos(receber(), '2026-10-03', { ...politica, tolerancia_dias: 5 }), { dias_atraso: 2, juros: 0, multa: 0, desconto_antecipacao: 0 }, 'dentro da tolerância não cobra nada');
eq(calcularEncargos(receber(), '2026-09-20', { desconto_antecipacao: { pct: 5, dias: 10 } }).desconto_antecipacao, 50, 'pagando 10 dias antes: desconto de 5%');
eq(calcularEncargos(receber(), '2026-09-25', { desconto_antecipacao: { pct: 5, dias: 10 } }).desconto_antecipacao, 0, 'só 6 dias antes: sem desconto');
eq(calcularEncargos(receber({ valor_baixado: 400 }), '2026-10-31', politica).juros, 18, 'encargo sobre o saldo, não sobre o total');
eq(calcularEncargos({ ...receber(), tabela: 'contas_pagar' }, '2026-10-31', politica).juros, 0, 'contas a pagar não sugerem encargos sem ligar na política');
eq(calcularEncargos(receber(), '2026-10-31', null), { dias_atraso: 30, juros: 0, multa: 0, desconto_antecipacao: 0 }, 'sem política: só informa o atraso');

console.log('--- Plano da baixa (igual à baixa de hoje) ---');
let p = planoDaBaixa(receber(), { valor: 1000, data: '2026-10-01' });
eq([p.status_depois, p.valor_baixado_depois, p.saldo_depois, p.erros], ['RECEBIDO', 1000, 0, []], 'pagou tudo: RECEBIDO, valor recebido = valor da conta');
p = planoDaBaixa(receber(), { valor: 300, data: '2026-10-01' });
eq([p.status_depois, p.valor_baixado_depois, p.saldo_depois], ['PARCIAL', 300, 700], 'pagou parte: PARCIAL e o saldo continua visível');
p = planoDaBaixa(receber({ status: 'PARCIAL', valor_baixado: 300 }), { valor: 700, data: '2026-10-02' });
eq([p.status_depois, p.valor_baixado_depois], ['RECEBIDO', 1000], 'segunda parcela quita, acumulando');
p = planoDaBaixa(receber(), { valor: 999.995, data: '2026-10-01' });
eq(p.status_depois, 'RECEBIDO', 'meio centavo de arredondamento não deixa a conta aberta');

console.log('--- Diferença ---');
p = planoDaBaixa(receber(), { valor: 950, data: '2026-10-01', tratamento_diferenca: 'desconto' });
eq([p.desconto, p.status_depois, p.valor_final_depois, p.valor_baixado_depois], [50, 'RECEBIDO', 950, 950], 'pagou menos e a diferença vira desconto: liquidada');
p = planoDaBaixa(receber(), { valor: 950, data: '2026-10-01', tratamento_diferenca: 'deixar_aberto' });
eq([p.desconto, p.status_depois, p.saldo_depois], [0, 'PARCIAL', 50], 'pagou menos e deixa em aberto');
p = planoDaBaixa(receber(), { valor: 1050, data: '2026-10-31' });
eq([p.juros, p.valor_final_depois, p.status_depois], [50, 1050, 'RECEBIDO'], 'pagou mais: a sobra vira acréscimo e o valor final acompanha');
p = planoDaBaixa(receber(), { valor: 1050, data: '2026-10-31', juros: 30, multa: 20 });
eq([p.juros, p.multa, p.diferenca, p.principal], [30, 20, 0, 1000], 'juros e multa informados batem com o pago');

console.log('--- Erros ---');
eq(planoDaBaixa(receber(), { valor: 0, data: '2026-10-01' }).erros[0], 'Informe um valor maior que zero.', 'valor zero recusado');
eq(planoDaBaixa(receber({ status: 'RECEBIDO', valor_baixado: 1000 }), { valor: 10, data: '2026-10-01' }).erros.includes('Esta conta já está liquidada.'), true, 'conta liquidada recusa nova baixa');
eq(planoDaBaixa(receber({ status: 'CANCELADO' }), { valor: 10, data: '2026-10-01' }).erros.includes('Esta conta está cancelada.'), true, 'conta cancelada recusa baixa');
eq(planoDaBaixa(receber(), { valor: 100, data: '2026-10-01', taxa: 150 }).erros.includes('A taxa não pode ser maior que o valor recebido.'), true, 'taxa maior que o recebido é recusada');

console.log('--- Título depois da baixa e do estorno ---');
const d = { id: 'x', valor_final: 1000, status: 'PENDENTE', valor_recebido: 0, taxa: 0 };
const t = receber();
const plano = planoDaBaixa(t, { valor: 1050, data: '2026-10-31', taxa: 5 });
const depois = tituloDepoisDaBaixa(d, t, plano, { data: '2026-10-31', conta_bancaria_id: 'b1' });
eq([depois.status, depois.valor_recebido, depois.juros, depois.valor_final, depois.valor_base_encargos, depois.data_recebimento, depois.conta_bancaria_id, depois.taxa],
  ['RECEBIDO', 1050, 50, 1050, 1000, '2026-10-31', 'b1', 5], 'título guarda pago, encargos, base, data, conta e taxa');
const volta = tituloDepoisDoEstorno(depois, 'contas_receber', { valor: 1050, juros: 50, multa: 0, desconto: 0, taxa: 5, credito: 0 });
eq([volta.status, volta.valor_recebido, volta.juros, volta.valor_final, volta.taxa], ['PENDENTE', 0, 0, 1000, 0], 'estornar volta o título ao estado anterior');
eq(saldoDoTitulo({ valor_final: 1000, valor_baixado: 1200 }), 0, 'saldo nunca fica negativo');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
