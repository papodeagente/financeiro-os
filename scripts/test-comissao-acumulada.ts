/**
 * Faixa de comissão pelo acumulado do mês (src/lib/comissao-acumulada.ts).
 *
 * Caso que motivou: Bruno fez R$ 10.000 numa venda e R$ 200 em outra. Pela
 * venda individual caía em 10% e no padrão de 5%. Pelo acumulado de
 * R$ 10.200 tem que cair em 13,5%, e o mês inteiro sobe para essa faixa.
 */
import {
  faixaDoValor, calcularComissaoDoMes, chaveAcumulado, posicaoNaEscala,
} from '../src/lib/comissao-acumulada.ts';
import { soma } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

// Tabela real do plano "Setembro 2027" do Bruno.
const FAIXAS = [
  { de: 3000, ate: 5000, percentual: 5 },
  { de: 5001, ate: 7000, percentual: 7 },
  { de: 7001, ate: 10000, percentual: 10 },
  { de: 10001, ate: 14999, percentual: 13.5 },
  { de: 15000, ate: 19999, percentual: 16 },
  { de: 20000, ate: 100000, percentual: 20 },
];
const PLANO = { faixas: FAIXAS, percentual_padrao: 5 };
const v = (id: string, base: number, pct = 5) => ({ venda_id: id, base, pct_fallback: pct });

console.log('--- o caso relatado ---');
{
  const r = calcularComissaoDoMes([v('VND-0008', 10000), v('VND-0007', 200)], PLANO);
  eq(r.base_acumulada, 10200, 'acumula as duas vendas do mês');
  eq(r.percentual, 13.5, 'R$ 10.200 acumulado cai na faixa de 13,5%');
  eq(r.total, 1377, 'a comissão do mês é 13,5% sobre TODO o acumulado');
  eq(soma(r.itens.map(i => i.valor)), r.total, 'a soma das vendas bate com o total do mês');
  eq(r.itens.map(i => i.percentual), [13.5, 13.5], 'as duas vendas ficam na mesma alíquota');
}

console.log('\n--- a faixa é escolhida pelo acumulado, não pela venda ---');
{
  // Isoladas: 3 vendas de R$ 4.000 dariam 5% cada = R$ 600.
  // Acumuladas: R$ 12.000 caem em 13,5% = R$ 1.620.
  const r = calcularComissaoDoMes([v('a', 4000), v('b', 4000), v('c', 4000)], PLANO);
  eq([r.base_acumulada, r.percentual, r.total], [12000, 13.5, 1620],
     'três vendas pequenas somam e sobem de faixa juntas');
}

console.log('\n--- limites das faixas ---');
eq(faixaDoValor(FAIXAS, 3000)?.percentual, 5, 'início da faixa entra nela');
eq(faixaDoValor(FAIXAS, 5000)?.percentual, 5, 'fim da faixa ainda é dela');
eq(faixaDoValor(FAIXAS, 5001)?.percentual, 7, 'o centavo seguinte já é da próxima');
eq(faixaDoValor(FAIXAS, 10000)?.percentual, 10, 'topo da faixa de 10%');
eq(faixaDoValor(FAIXAS, 10001)?.percentual, 13.5, 'entrada da faixa de 13,5%');
eq(faixaDoValor(FAIXAS, 2999)?.percentual, undefined, 'abaixo da primeira faixa não casa');
eq(faixaDoValor(FAIXAS, 250000)?.percentual, 20,
   'acima do topo da tabela vale a última faixa, senão vender mais pagaria menos');
eq(faixaDoValor([], 5000), null, 'plano sem faixa nenhuma devolve null');
{
  const abertas = [{ de: 0, ate: 1000, percentual: 2 }, { de: 1001, ate: 0, percentual: 9 }];
  eq(faixaDoValor(abertas, 999999)?.percentual, 9, 'ate igual a 0 significa faixa sem teto');
}

console.log('\n--- buraco entre faixas cai no padrão ---');
{
  // R$ 200 sozinho no mês: nenhuma faixa começa abaixo de R$ 3.000.
  const r = calcularComissaoDoMes([v('so', 200)], PLANO);
  eq([r.origem, r.percentual, r.total], ['PADRAO', 5, 10],
     'mês inteiro abaixo da tabela usa o percentual das regras de produto');
}

console.log('\n--- centavos ---');
{
  // 3 bases iguais e um total que não divide redondo.
  const r = calcularComissaoDoMes([v('a', 3401), v('b', 3401), v('c', 3401)], PLANO);
  eq(r.base_acumulada, 10203, 'acumulado');
  eq(r.percentual, 13.5, 'faixa de 13,5%');
  eq(r.total, 1377.41, 'total do mês arredondado a duas casas');
  eq(soma(r.itens.map(i => i.valor)), 1377.41, 'a distribuição não perde nem inventa centavo');
}
{
  const r = calcularComissaoDoMes([v('grande', 10000), v('mirrada', 0.01)], PLANO);
  eq(soma(r.itens.map(i => i.valor)), r.total, 'resíduo com item de valor mínimo');
  eq(r.itens.find(i => i.venda_id === 'grande')!.valor >= r.itens.find(i => i.venda_id === 'mirrada')!.valor,
     true, 'o resíduo vai para o maior item, não distorce o pequeno');
}

console.log('\n--- casos de borda ---');
eq(calcularComissaoDoMes([], PLANO).total, 0, 'mês sem venda não gera comissão');
eq(calcularComissaoDoMes([], PLANO).percentual, 0, 'e não divide por zero');
{
  const r = calcularComissaoDoMes([v('a', 0), v('b', 0)], PLANO);
  eq([r.base_acumulada, r.total], [0, 0], 'bases zeradas não viram comissão');
}
{
  // Venda com base negativa (estorno) reduz o acumulado do mês.
  const r = calcularComissaoDoMes([v('a', 12000), v('estorno', -2000)], PLANO);
  eq([r.base_acumulada, r.percentual], [10000, 10],
     'estorno derruba o acumulado e pode baixar a faixa');
}

console.log('\n--- chave de agrupamento ---');
eq(chaveAcumulado('u1', '2026-09'), 'u1::2026-09', 'um acumulado por vendedor e mês');

console.log('\n--- posição na escada de comissão ---');
{
  const p = posicaoNaEscala(FAIXAS, 10200);
  eq([p.indice, p.total, p.atual?.percentual], [4, 6, 13.5], 'faixa 4 de 6, a 13,5%');
  eq(p.proxima?.percentual, 16, 'a próxima é a de 16%');
  eq(p.falta_para_proxima, 4800, 'faltam R$ 4.800 de base para chegar em R$ 15.000');
  // Hoje: 10.200 x 13,5% = 1.377. Cruzando: 15.000 x 16% = 2.400.
  eq(p.ganho_na_proxima, 1023, 'cruzar a faixa vale R$ 1.023 a mais no mês inteiro');
}
{
  const p = posicaoNaEscala(FAIXAS, 200);
  eq([p.indice, p.atual], [0, null], 'abaixo da tabela não está em faixa nenhuma');
  eq([p.proxima?.percentual, p.falta_para_proxima], [5, 2800], 'e faltam R$ 2.800 para a primeira');
}
{
  const p = posicaoNaEscala(FAIXAS, 50000);
  eq([p.indice, p.atual?.percentual, p.proxima], [6, 20, null], 'no topo não há próxima faixa');
  eq([p.falta_para_proxima, p.ganho_na_proxima], [null, null], 'e não há o que faltar');
}
{
  const p = posicaoNaEscala(FAIXAS, 15000);
  eq([p.indice, p.atual?.percentual, p.falta_para_proxima], [5, 16, 5000],
     'exatamente no início da faixa já conta como dentro dela');
}
eq(posicaoNaEscala([], 9999).total, 0, 'plano sem faixa não quebra');

console.log(`\n${total - falhas}/${total} testes da comissão acumulada passaram`);
process.exit(falhas > 0 ? 1 : 0);
