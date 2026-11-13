/**
 * Recibo da venda (src/lib/recibo-da-venda.ts): valor por extenso e a
 * descrição dos valores sempre fechando com o total.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-recibo-da-venda.ts
 */
import { montarRecibo, valorPorExtenso, vendaTemRecibo } from '../src/lib/recibo-da-venda.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- valor por extenso ---');
eq([valorPorExtenso(1), valorPorExtenso(0.01), valorPorExtenso(0.5), valorPorExtenso(0)],
  ['um real', 'um centavo', 'cinquenta centavos', 'zero real'], 'um real, um centavo, centavos sozinhos e zero');
eq(valorPorExtenso(100), 'cem reais', 'cem');
eq(valorPorExtenso(101.1), 'cento e um reais e dez centavos', 'cento e um com centavos');
eq(valorPorExtenso(1234.56), 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos', 'milhar');
eq(valorPorExtenso(1200), 'mil e duzentos reais', 'mil e duzentos (centena redonda leva "e")');
eq(valorPorExtenso(2050), 'dois mil e cinquenta reais', 'dois mil e cinquenta');
eq(valorPorExtenso(15990.9), 'quinze mil novecentos e noventa reais e noventa centavos', 'pacote típico');
eq(valorPorExtenso(1000000), 'um milhão de reais', 'um milhão de reais');
eq(valorPorExtenso(2500000.01), 'dois milhões e quinhentos mil reais e um centavo', 'milhões com centavo');

console.log('--- quando há recibo ---');
eq(['ORCAMENTO', 'RESERVADO', 'CONFIRMADO', 'CONCLUIDO', 'CANCELADO'].map(vendaTemRecibo), [false, true, true, true, false], 'só venda realizada: reservada, confirmada ou concluída');

console.log('--- descrição dos valores ---');
const base = { forma_pagamento: 'CARTAO', parcelas: 10, pagamento_detalhado: [] } as never;
const p = (o: Record<string, unknown>) => ({ id: 'x', tipo: 'OUTROS', descricao: '', valor_venda: 0, cambio: 1, moeda: 'BRL', ...o });
let r = montarRecibo({ ...(base as object), produtos: [
  p({ tipo: 'AEREO', descricao: 'Aéreo GRU-LIS', trecho: 'GRU → LIS', data_inicio: '2026-12-10', data_fim: '2026-12-20', localizador: 'ABC123', valor_venda: 4200 }),
  p({ tipo: 'HOTEL', hotel_nome: 'Hotel Mar', data_inicio: '2026-12-10', data_fim: '2026-12-20', valor_venda: 3100.5 }),
], valor_total_venda: 7300.5, desconto: 300.5, valor_final: 7000 } as never);
eq(r.linhas.map(l => [l.descricao, l.valor]), [['Aéreo GRU-LIS', 4200], ['Hospedagem', 3100.5]], 'cada item com o valor; sem descrição usa o tipo');
eq(r.linhas[0].detalhe, 'Aéreo · GRU → LIS · 10/12/2026 a 20/12/2026 · Localizador ABC123', 'o detalhe do item tem tipo, trecho, período e localizador');
eq([r.subtotal, r.desconto, r.total, r.totalPorExtenso], [7300.5, 300.5, 7000, 'sete mil reais'], 'subtotal, desconto e total por extenso');
eq(r.pagamento, 'Cartão em 10x', 'forma de pagamento com parcelas');

r = montarRecibo({ ...(base as object), produtos: [p({ descricao: 'Ingresso Disney', moeda: 'USD', valor_venda: 150, cambio: 5.1 })],
  valor_total_venda: 765, desconto: 0, valor_final: 765, pagamento_detalhado: [{ forma: 'AVISTA_PIX', valor: 265, parcelas: 1 }, { forma: 'CARTAO', valor: 500, parcelas: 3 }] } as never);
eq([r.linhas[0].valor, r.linhas[0].detalhe.includes('USD 150,00 × câmbio 5,1')], [765, true], 'item em dólar entra em reais e mostra a conta do câmbio');
eq(r.pagamento.replace(/\u00a0/g, ' '), 'À vista / Pix R$ 265,00 + Cartão R$ 500,00 em 3x', 'pagamento dividido em formas');

r = montarRecibo({ ...(base as object), produtos: [p({ descricao: 'Pacote Natal', valor_venda: 5000 })], valor_total_venda: 5250, desconto: 0, valor_final: 5250 } as never);
eq(r.linhas.map(l => [l.descricao, l.valor]), [['Pacote Natal', 5000], ['Outros valores da venda', 250]], 'itens que não somam o total: a diferença vira linha, nunca some');
eq(r.linhas.reduce((s, l) => s + l.valor, 0) - r.desconto, r.total, 'a descrição fecha com o total');

r = montarRecibo({ ...(base as object), produtos: [], valor_total_venda: 1800, desconto: 0, valor_final: 1800 } as never);
eq(r.linhas.map(l => [l.descricao, l.valor]), [['Serviços de viagem', 1800]], 'venda sem itens: uma linha com o total');

r = montarRecibo({ ...(base as object), produtos: [p({ descricao: 'Seguro', valor_venda: 100 })], valor_total_venda: 100, desconto: 0, valor_final: 120 } as never);
eq([r.linhas.map(l => l.descricao), r.subtotal, r.desconto, r.total], [['Seguro', 'Acréscimos'], 120, 0, 120], 'total acima dos itens: acréscimo explícito, sem desconto negativo');

r = montarRecibo({ ...(base as object), produtos: [p({ valor_venda: 0.1 }), p({ valor_venda: 0.2 })], valor_total_venda: 0.3, desconto: 0, valor_final: 0.3 } as never);
eq([r.linhas.length, r.total], [2, 0.3], '0,10 + 0,20 fecha em 0,30 (centavos, sem erro de ponto flutuante)');

console.log(`\n${total - falhas}/${total} testes do recibo da venda passaram`);
if (falhas > 0) process.exit(1);
