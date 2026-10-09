/**
 * Regras de comissão por produto.
 *
 * O caso que motivou: "a comissão é 3%, mas cada venda do Produto X paga
 * R$ 500". Os três testes que mandam estão no primeiro bloco — são as três
 * decisões do Bruno em 08/10/2026 viradas em número.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-comissao-regras.ts
 */
import {
  normalizarRegras, regraDoProduto, quantidadeDoProduto, repartirVenda,
  type RegraDeProduto,
} from '../src/lib/comissao-regras.ts';
import { calcularComissaoDoMes } from '../src/lib/comissao-acumulada.ts';
import { produtosDoPayload, identidadeDoProduto, PREFIXO_CRM } from '../src/lib/venda-crm-produtos.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

const FIXO_500: RegraDeProduto = {
  produto_id: 'prod-x', produto_nome: 'Produto X',
  pagamento: { forma: 'VALOR_FIXO', valor: 500, por: 'VENDA' },
};
const FIXO_500_UNIDADE: RegraDeProduto = {
  ...FIXO_500, pagamento: { forma: 'VALOR_FIXO', valor: 500, por: 'UNIDADE' },
};

console.log('--- o caso do Bruno: 3% no plano, R$ 500 no Produto X ---');
{
  // Venda de 5.000: 1.000 do Produto X + 4.000 de outros. Base = 5.000.
  const r = repartirVenda({
    base: 5000,
    produtos: [
      { produto_id: 'prod-x', tipo: 'PACOTE', valor_venda: 1000 },
      { produto_id: 'prod-y', tipo: 'HOTEL', valor_venda: 4000 },
    ],
    regras: [FIXO_500],
    percentual_padrao: 3,
  });
  eq(r.bonus_fixo, 500, 'o Produto X paga os R$ 500');
  eq(r.base_percentual, 4000, 'e sai da base percentual: sobram os R$ 4.000 dos outros');
  eq(r.pct_fallback, 3, 'o resto segue os 3% do plano');
  // 500 + 3% de 4.000 = 500 + 120 = 620.
  eq(round(r.base_percentual * r.pct_fallback / 100 + r.bonus_fixo), 620, 'a venda paga R$ 620: 500 + 3% dos outros 4.000');
}
function round(n: number) { return Math.round(n * 100) / 100; }

console.log('--- decisão 1: por venda × por unidade ---');
{
  const comQtd = (regra: RegraDeProduto, quantidade: number) => repartirVenda({
    base: 1000, produtos: [{ produto_id: 'prod-x', valor_venda: 1000, quantidade }],
    regras: [regra], percentual_padrao: 3,
  }).bonus_fixo;
  eq(comQtd(FIXO_500, 3), 500, 'por VENDA paga uma vez, mesmo com 3 unidades');
  eq(comQtd(FIXO_500_UNIDADE, 3), 1500, 'por UNIDADE multiplica: 3 × 500');
  eq(comQtd(FIXO_500_UNIDADE, 1), 500, 'uma unidade paga uma vez nas duas formas');
  // Venda manual não registra quantidade: ausente vale 1, nunca 0.
  eq([undefined, null, 0, -2, 1.7].map(q => quantidadeDoProduto({ quantidade: q })), [1, 1, 1, 1, 1], 'quantidade ausente, zero, negativa ou quebrada vale 1');
  eq(quantidadeDoProduto({ quantidade: 4 }), 4, 'e a quantidade de verdade é respeitada');
}

console.log('--- decisão 2: a regra convive, não substitui ---');
{
  // Duas regras na mesma venda somam.
  const r = repartirVenda({
    base: 6000,
    produtos: [
      { produto_id: 'prod-x', valor_venda: 1000 },
      { produto_id: 'prod-z', valor_venda: 2000 },
      { produto_id: 'prod-y', valor_venda: 3000 },
    ],
    regras: [FIXO_500, { produto_id: 'prod-z', pagamento: { forma: 'VALOR_FIXO', valor: 300, por: 'VENDA' } }],
    percentual_padrao: 3,
  });
  eq(r.bonus_fixo, 800, 'duas regras fixas na mesma venda somam: 500 + 300');
  eq(r.base_percentual, 3000, 'e as duas saem da base: sobra o produto sem regra');

  // Regra percentual convive do mesmo jeito: cada produto com o seu.
  const p = repartirVenda({
    base: 10000,
    produtos: [
      { produto_id: 'prod-x', valor_venda: 5000 },
      { produto_id: 'prod-y', valor_venda: 5000 },
    ],
    regras: [{ produto_id: 'prod-x', pagamento: { forma: 'PERCENTUAL', percentual: 9 } }],
    percentual_padrao: 3,
  });
  eq(p.bonus_fixo, 0, 'regra percentual não gera bônus');
  eq(p.base_percentual, 10000, 'nem encolhe a base');
  eq(p.pct_fallback, 6, 'o percentual é ponderado: metade a 9% e metade a 3% dá 6%');
}

console.log('--- decisão 3: o fixo fica FORA da escada do mês ---');
{
  // Escada: até 10.000 paga 5%, acima paga 10%.
  const plano = { percentual_padrao: 3, faixas: [{ de: 0, ate: 10000, percentual: 5 }, { de: 10001, ate: 0, percentual: 10 }] };
  // Duas vendas, base percentual 4.000 cada = 8.000 acumulados. Bônus de
  // 500 em cada. Se o bônus entrasse no acumulado (8.000 + 1.000 = 9.000)
  // ainda seria a mesma faixa; o teste abaixo usa valores que mudariam.
  const perto = calcularComissaoDoMes(
    [
      { venda_id: 'v1', base: 5000, pct_fallback: 3, bonus_fixo: 500 },
      { venda_id: 'v2', base: 5000, pct_fallback: 3, bonus_fixo: 500 },
    ],
    plano,
  );
  eq(perto.base_acumulada, 10000, 'o bônus NÃO entra no acumulado do mês');
  eq(perto.origem, 'FAIXA', 'a faixa é escolhida pela base, sem o bônus');
  eq(perto.percentual, 5, 'e com 10.000 a faixa é a de 5% — o bônus não empurrou para a de 10%');
  eq(perto.total_bonus, 1000, 'o bônus do mês é somado à parte');
  eq(perto.total, 1500, 'o total do mês é 5% de 10.000 mais os R$ 1.000 de bônus');
  eq(perto.itens.map(i => i.valor), [750, 750], 'e cada venda leva o seu percentual mais o seu bônus');
  eq(perto.itens.map(i => i.bonus), [500, 500], 'o bônus fica visível por venda');
}

console.log('--- os centavos continuam fechando ---');
{
  const plano = { percentual_padrao: 3, faixas: [{ de: 0, ate: 0, percentual: 13.5 }] };
  const r = calcularComissaoDoMes(
    [
      { venda_id: 'v1', base: 333.33, pct_fallback: 3, bonus_fixo: 0.01 },
      { venda_id: 'v2', base: 333.33, pct_fallback: 3, bonus_fixo: 0.01 },
      { venda_id: 'v3', base: 333.34, pct_fallback: 3, bonus_fixo: 0.01 },
    ],
    plano,
  );
  const somaItens = Math.round(r.itens.reduce((a, i) => a + i.valor, 0) * 100) / 100;
  eq(somaItens, r.total, 'a soma dos itens bate exatamente com o total do mês, com bônus no meio');
  eq(r.total_bonus, 0.03, 'e os três centavos de bônus sobrevivem');
}

console.log('--- sem regra, nada muda (o sistema de hoje) ---');
{
  const r = repartirVenda({ base: 5000, produtos: [{ tipo: 'HOTEL', valor_venda: 5000 }], regras: [], percentual_padrao: 3 });
  eq([r.base_percentual, r.pct_fallback, r.bonus_fixo], [5000, 3, 0], 'plano sem regra entrega a base inteira no percentual padrão');
  const semProduto = repartirVenda({ base: 5000, produtos: [], regras: [FIXO_500], percentual_padrao: 3 });
  eq([semProduto.base_percentual, semProduto.bonus_fixo], [5000, 0], 'regra sem produto na venda não inventa bônus');
  const semValor = repartirVenda({ base: 5000, produtos: [{ produto_id: 'prod-x', valor_venda: 0 }], regras: [FIXO_500], percentual_padrao: 3 });
  eq([semValor.base_percentual, semValor.bonus_fixo], [5000, 0], 'produto sem valor não reparte nada');
}

console.log('--- a venda inteira paga fixo ---');
{
  const r = repartirVenda({
    base: 1000, produtos: [{ produto_id: 'prod-x', valor_venda: 1000 }],
    regras: [FIXO_500], percentual_padrao: 3,
  });
  eq(r.base_percentual, 0, 'não sobra base percentual');
  eq(r.bonus_fixo, 500, 'e a comissão é só o fixo');
}

console.log('--- produto específico ganha do tipo ---');
{
  const regras: RegraDeProduto[] = [
    { tipo_produto: 'PACOTE', pagamento: { forma: 'PERCENTUAL', percentual: 5 } },
    FIXO_500,
  ];
  eq(regraDoProduto(regras, { produto_id: 'prod-x', tipo: 'PACOTE' })?.pagamento.forma, 'VALOR_FIXO', 'o Produto X usa a regra dele, não a do tipo PACOTE');
  eq(regraDoProduto(regras, { produto_id: 'outro', tipo: 'PACOTE' })?.pagamento.forma, 'PERCENTUAL', 'outro pacote cai na regra do tipo');
  eq(regraDoProduto(regras, { produto_id: 'outro', tipo: 'HOTEL' }), null, 'hotel não casa com nada');
  eq(regraDoProduto(regras, { tipo: 'pacote' })?.pagamento.forma, 'PERCENTUAL', 'o tipo casa sem olhar caixa');
}

console.log('--- o formato antigo continua valendo ---');
{
  // Planos gravados antes de 08/10/2026: { tipo_produto, percentual }.
  const antigas = normalizarRegras([{ tipo_produto: 'AEREO', percentual: 7 }]);
  eq(antigas, [{ tipo_produto: 'AEREO', pagamento: { forma: 'PERCENTUAL', percentual: 7 } }], 'regra antiga vira regra percentual nova');
  const r = repartirVenda({ base: 1000, produtos: [{ tipo: 'AEREO', valor_venda: 1000 }], regras: antigas, percentual_padrao: 3 });
  eq(r.pct_fallback, 7, 'e paga o mesmo que pagava antes');

  eq(normalizarRegras([{ produto_id: 'p1', pagamento: { forma: 'VALOR_FIXO', valor: 500, por: 'UNIDADE' } }])[0].pagamento, { forma: 'VALOR_FIXO', valor: 500, por: 'UNIDADE' }, 'o formato novo passa inteiro');
  eq(normalizarRegras([{ produto_id: 'p1', pagamento: { forma: 'VALOR_FIXO', valor: 500 } }])[0].pagamento, { forma: 'VALOR_FIXO', valor: 500, por: 'VENDA' }, 'fixo sem "por" é por venda');
  eq(normalizarRegras([{ produto_id: 'p1', pagamento: { forma: 'VALOR_FIXO', valor: 0, por: 'VENDA' } }]), [], 'regra que paga zero é descartada: não é regra');
  eq(normalizarRegras([{ percentual: 7 }]), [], 'regra sem alvo é descartada');
  eq([null, undefined, 'x', 42, {}].map(v => normalizarRegras(v).length), [0, 0, 0, 0, 0], 'lixo no JSONB não derruba o cálculo');
  eq(normalizarRegras([null, { tipo_produto: ' HOTEL ', percentual: '4' }]).length, 1, 'item nulo some e o texto é aparado');
}

console.log('--- os produtos que o CRM manda viram alvo de regra ---');
{
  // Grupo publicado por esta agência: a identidade é o id do grupo AQUI,
  // porque é esse que aparece na lista da tela do plano.
  eq(identidadeDoProduto({ produto_id: '77', produto_externo_id: 'grupo-natal' }), 'grupo-natal', 'grupo do Financeiro ganha do id do catálogo do CRM');
  eq(identidadeDoProduto({ produto_id: '77' }), `${PREFIXO_CRM}77`, 'produto nascido no CRM vem prefixado');
  eq(identidadeDoProduto({}), '', 'produto sem identidade fica sem id');
  // O prefixo existe para um id de grupo nunca colidir com um id do CRM.
  eq(identidadeDoProduto({ produto_id: 'grupo-natal' }) === identidadeDoProduto({ produto_externo_id: 'grupo-natal' }), false, 'o prefixo evita a colisão entre os dois mundos');

  const produtos = produtosDoPayload({
    produtos: [
      { produto_id: '77', produto_externo_id: 'grupo-natal', nome: 'Grupo Natal', tipo: 'GRUPO', quantidade: 2, valor_total: 8000, custo_total: 6000 },
      { produto_id: '91', nome: 'Seguro', tipo: 'seguro', quantidade: 3, valor_unitario: 100 },
      { nome: 'Taxa sem cadastro', valor_total: 50 },
    ],
  });
  eq(produtos.map(p => p.produto_id), ['grupo-natal', `${PREFIXO_CRM}91`, ''], 'cada produto ganha a identidade certa');
  eq(produtos.map(p => p.quantidade), [2, 3, 1], 'a quantidade viaja; ausente vale 1');
  eq(produtos.map(p => p.valor_venda), [8000, 300, 50], 'valor_total manda; sem ele, unitário × quantidade');
  eq(produtos.map(p => p.tipo), ['GRUPO', 'SEGURO', 'OUTROS'], 'o tipo é normalizado e o desconhecido vira OUTROS');
  // Produto sem identidade NÃO some: ele conta para o total vendido.
  eq(produtos.length, 3, 'o produto sem cadastro continua na lista');

  // Moeda estrangeira vira BRL na entrada: o cálculo não compara moedas.
  const emUSD = produtosDoPayload({ produtos: [{ produto_id: '1', valor_total: 100, moeda: 'USD', cambio: 5 }] });
  eq([emUSD[0].valor_venda, emUSD[0].moeda], [500, 'BRL'], 'produto em dólar chega convertido');

  eq([null, undefined, {}, { produtos: 'x' }, { produtos: [null, 7] }].map(v => produtosDoPayload(v as never).length), [0, 0, 0, 0, 0], 'payload sem produtos ou com lixo não quebra');
}

console.log('--- a ponta a ponta: venda do CRM com o Produto X ---');
{
  // O CRM manda 1 Grupo Natal (8.000) + 1 Seguro (300). A agência paga 3%,
  // mas o Grupo Natal paga R$ 500 fixos por venda.
  const produtos = produtosDoPayload({
    produtos: [
      { produto_externo_id: 'grupo-natal', nome: 'Grupo Natal', tipo: 'GRUPO', valor_total: 8000 },
      { produto_id: '91', nome: 'Seguro', tipo: 'SEGURO', valor_total: 2000 },
    ],
  });
  const r = repartirVenda({
    base: 10000,
    produtos: produtos.map(p => ({ produto_id: p.produto_id, tipo: p.tipo, quantidade: p.quantidade, valor_venda: p.valor_venda })),
    regras: normalizarRegras([{ produto_id: 'grupo-natal', pagamento: { forma: 'VALOR_FIXO', valor: 500, por: 'VENDA' } }]),
    percentual_padrao: 3,
  });
  eq(r.bonus_fixo, 500, 'o Grupo Natal paga os R$ 500');
  eq(r.base_percentual, 2000, 'e a base percentual fica com os 2.000 do seguro');
  eq(round(r.base_percentual * r.pct_fallback / 100 + r.bonus_fixo), 560, 'a venda paga R$ 560: 500 do grupo + 3% dos 2.000 do seguro');
}

console.log(`\n${total - falhas}/${total} testes das regras por produto passaram`);
if (falhas > 0) process.exit(1);
