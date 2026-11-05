/**
 * Categorias, centros, rateio e relatórios por categoria/centro/rateio
 * (05/11/2026), só a lógica pura: rateio fecha 100% e os centavos, juntar troca a
 * categoria sem quebrar o rateio, fatias e relatório em caixa proporcional.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-dimensoes.ts
 */
import {
  validarRateio, dividirIgual, aplicarRegraDeRateio, normalizarTags, prepararDimensoesDaConta,
  dimensoesDoLancamento, valorMovimentadoDaConta, recusaDaJuncao, trocarCategoriaNaConta,
  trocarCategoriaNaRegra, criaCiclo, ordenarEmArvore, grupoDaCategoria,
} from '../src/lib/dimensoes.ts';
import {
  lerFiltros, montarLinhas, totalizar, agruparLinhas, ordenarLinhas, paginar, planilhaDasLinhas,
  situacaoDaConta, centroEDescendentes, ErroFiltro,
} from '../src/lib/lancamentos-por-dimensao.ts';
import { soma } from '../src/lib/money.ts';

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
const erroDe = (r: { ok: boolean; erro?: string }) => (r.ok ? null : r.erro);

console.log('--- rateio fecha 100% e os centavos ---');
{
  const r = validarRateio(100, [
    { centro_custo_id: 'sp', percentual: 33.34, valor: 999 },
    { centro_custo_id: 'rj', percentual: 33.33, valor: 0 },
    { centro_custo_id: 'bh', percentual: 33.33, valor: 0 },
  ]);
  eq(r.ok, true, 'três terços fecham 100%');
  if (r.ok) {
    eq(r.linhas.map(l => l.valor), [33.34, 33.33, 33.33], 'valores em centavos, o resíduo no maior');
    eq(soma(r.linhas.map(l => l.valor)), 100, 'a soma das linhas é o total exato');
  }
  const r2 = validarRateio(999.99, [{ centro_custo_id: 'a', percentual: 50 }, { centro_custo_id: 'b', percentual: 50 }]);
  eq(r2.ok && soma(r2.linhas.map(l => l.valor)), 999.99, 'centavo ímpar não some (999,99 em 50/50)');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: 'a', percentual: 60 }])), 'O rateio soma 60%. Faltam 40% para fechar 100%.', 'abaixo de 100% é recusado (o sistema anterior aceitava)');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: 'a', percentual: 60 }, { centro_custo_id: 'b', percentual: 50 }])), 'O rateio soma 110%. Passou 10% de 100%.', 'acima de 100% é recusado');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: '', percentual: 100 }])), 'Escolha o centro de custo da linha 1 do rateio.', 'linha sem centro é recusada');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: 'a', percentual: 0 }, { centro_custo_id: 'b', percentual: 100 }])), 'O percentual da linha 1 do rateio precisa ser maior que zero.', 'percentual zero é recusado');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: 'a', percentual: 50 }, { centro_custo_id: 'a', percentual: 50 }])), 'A linha 2 repete centro e categoria de outra linha. Junte as duas.', 'linha repetida é recusada');
  eq(validarRateio(100, [{ centro_custo_id: 'a', categoria_id: 'x', percentual: 50 }, { centro_custo_id: 'a', categoria_id: 'y', percentual: 50 }]).ok, true, 'mesmo centro com categorias diferentes vale (rateio por linha de categoria)');
  eq(validarRateio(100, []), { ok: true, linhas: [] }, 'vazio é válido: centro único');
  eq(validarRateio(100, undefined), { ok: true, linhas: [] }, 'ausente é válido');
  eq(dividirIgual(3), [33.34, 33.33, 33.33], 'dividir igual fecha 100,00');
  eq(soma(dividirIgual(7)), 100, 'dividir igual em 7 fecha 100');
  const regra = aplicarRegraDeRateio({ linhas: [{ centro_custo_id: 'sp', percentual: 50 }, { centro_custo_id: 'rj', percentual: 50 }] }, 4500.01);
  eq(regra.ok && regra.linhas.map(l => l.valor), [2250, 2250.01], 'regra salva "Aluguel 50/50" aplicada com um clique');
}

console.log('--- preparar a conta antes de gravar ---');
{
  const semNada: Record<string, unknown> = { valor_final: 10, rateio: [], descricao: 'x' };
  const copia = JSON.stringify(semNada);
  eq(prepararDimensoesDaConta(semNada), null, 'conta sem rateio passa');
  eq(JSON.stringify(semNada), copia, 'porteiro: conta sem rateio e sem tags fica intocada');
  const conta: Record<string, unknown> = { valor_final: 300, rateio: [{ centro_custo_id: 'a', percentual: 70, valor: 1 }, { centro_custo_id: 'b', percentual: 30, valor: 1 }], tags: [' viagem ', 'Viagem', '', 'evento'] };
  eq(prepararDimensoesDaConta(conta), null, 'rateio de 100% passa');
  eq((conta.rateio as Array<{ valor: number }>).map(l => l.valor), [210, 90], 'valor das linhas refeito sobre o valor final');
  eq(conta.tags, ['viagem', 'evento'], 'tags limpas e sem repetição');
  eq(prepararDimensoesDaConta({ valor_final: 10, rateio: [{ centro_custo_id: 'a', percentual: 99.99 }] }), 'O rateio soma 99,99%. Faltam 0,01% para fechar 100%.', 'faltando 0,01% é recusado');
  eq(normalizarTags('x'), [], 'tags que não são lista viram lista vazia');
}

console.log('--- fatias do lançamento ---');
const categorias = [
  { id: 'g2', codigo: '2', nome: 'DESPESAS', tipo: 'DESPESA' },
  { id: 'g22', codigo: '2.2', nome: 'Despesas Operacionais', tipo: 'DESPESA', categoria_pai_id: 'g2' },
  { id: 'alug', codigo: '2.2.01', nome: 'Aluguel', tipo: 'DESPESA', categoria_pai_id: 'g22' },
  { id: 'luz', codigo: '2.2.02', nome: 'Energia', tipo: 'DESPESA', categoria_pai_id: 'g22' },
  { id: 'rep', codigo: '2.9', nome: 'Repasse a fornecedor', tipo: 'DESPESA', repasse: true },
  { id: 'rec', codigo: '1.3', nome: 'Fee de Serviço', tipo: 'RECEITA' },
];
const centros = [
  { id: 'adm', nome: 'Administrativo', centro_pai_id: null },
  { id: 'sp', nome: 'Loja SP', centro_pai_id: 'adm' },
  { id: 'rj', nome: 'Loja RJ', centro_pai_id: 'adm' },
  { id: 'mkt', nome: 'Marketing', centro_pai_id: null },
];
{
  const unico = dimensoesDoLancamento({ valor_final: 1000, categoria_id: 'alug', centro_custo: 'loja sp', rateio: [], status: 'PENDENTE', fornecedor_nome: 'X' }, { categorias, centros });
  eq(unico.fatias.length, 1, 'sem rateio: uma fatia');
  eq([unico.fatias[0].percentual, unico.fatias[0].valor, unico.fatias[0].valor_caixa], [100, 1000, 0], 'centro único é um rateio de 100%; em aberto não tem caixa');
  eq([unico.fatias[0].centro_custo_id, unico.fatias[0].centro_custo_nome], ['sp', 'Loja SP'], 'texto antigo do centro acha o cadastro pelo nome');
  eq([unico.fatias[0].categoria_nome, unico.fatias[0].grupo_nome], ['Aluguel', 'Despesas Operacionais'], 'categoria e grupo resolvidos');
  const semCadastro = dimensoesDoLancamento({ valor_final: 50, centro_custo: 'Filial Velha', rateio: [] }, { centros });
  eq([semCadastro.fatias[0].centro_custo_id, semCadastro.fatias[0].centro_custo_nome], ['', 'Filial Velha'], 'texto sem cadastro continua aparecendo pelo nome');

  const parcial = { valor_final: 1000, categoria_id: 'alug', status: 'PARCIAL', valor_pago: 300, data_pagamento: '2026-11-04', fornecedor_nome: 'Imob',
    rateio: [{ centro_custo_id: 'sp', percentual: 50, valor: 500 }, { centro_custo_id: 'rj', categoria_id: 'luz', percentual: 50, valor: 500 }] };
  const d = dimensoesDoLancamento(parcial, { categorias, centros });
  eq(d.rateado, true, 'conta rateada');
  eq(d.fatias.map(f => [f.centro_custo_nome, f.categoria_nome, f.valor, f.valor_caixa]), [['Loja SP', 'Aluguel', 500, 150], ['Loja RJ', 'Energia', 500, 150]], 'linha sem categoria herda a da conta; caixa proporcional ao pago (300 de 1000)');
  eq(valorMovimentadoDaConta({ status: 'PAGO', valor_final: 80, fornecedor_nome: 'a' }), 80, 'quitada sem valor_pago vale o valor final');
  eq(valorMovimentadoDaConta({ status: 'RECEBIDO', valor_final: 80, valor_recebido: 79.9 }), 79.9, 'quitada vale o que entrou');
  eq(valorMovimentadoDaConta({ status: 'CANCELADO', valor_final: 80, valor_recebido: 80 }), 0, 'excluída não movimenta');
  const quebrado = dimensoesDoLancamento({ valor_final: 10, categoria_id: 'alug', rateio: [{ centro_custo_id: 'sp', percentual: 30 }] }, { categorias });
  eq([quebrado.rateado, quebrado.fatias.length, quebrado.fatias[0].valor], [false, 1, 10], 'rateio inválido gravado por fora vira fatia única (relatório não quebra)');
  eq(dimensoesDoLancamento({ valor_final: 10, categoria_id: '1.3', rateio: [] }, { categorias }).fatias[0].categoria_nome, 'Fee de Serviço', 'conta a receber antiga com o código digitado acha a categoria');
  eq(dimensoesDoLancamento({ valor_final: 10, categoria_id: 'rep', rateio: [] }, { categorias }).fatias[0].repasse, true, 'categoria de repasse marca a fatia');
  eq(grupoDaCategoria(categorias[2], categorias)?.id, 'g22', 'grupo pelo código sem o último nível');
}

console.log('--- juntar categorias ---');
{
  eq(recusaDaJuncao(categorias[2], categorias[2], categorias), 'Escolha outra categoria: uma categoria não pode ser juntada com ela mesma.', 'mesma categoria é recusada');
  eq(recusaDaJuncao(categorias[2], categorias[5], categorias), 'As duas categorias precisam ser do mesmo tipo (receita com receita, despesa com despesa).', 'receita com despesa é recusada');
  eq(recusaDaJuncao(categorias[1], categorias[4], categorias), 'Esta categoria tem subcategorias. Junte ou mova as subcategorias antes.', 'grupo com filhas é recusado');
  eq(recusaDaJuncao(categorias[2], categorias[3], categorias), null, 'Aluguel em Energia pode');
  eq(recusaDaJuncao(null, categorias[3], categorias), 'A categoria que seria excluída não existe mais.', 'origem sumida');

  const conta = { id: 'c1', categoria_id: 'alug', valor_final: 100, rateio: [
    { centro_custo_id: 'sp', categoria_id: 'alug', percentual: 40, valor: 40 },
    { centro_custo_id: 'sp', categoria_id: 'luz', percentual: 40, valor: 40 },
    { centro_custo_id: 'rj', percentual: 20, valor: 20 },
  ] };
  const nova = trocarCategoriaNaConta(conta, { id: 'alug', codigo: '2.2.01' }, 'luz');
  eq(nova?.categoria_id, 'luz', 'categoria da conta trocada');
  eq(nova?.rateio, [{ centro_custo_id: 'sp', categoria_id: 'luz', percentual: 80, valor: 80 }, { centro_custo_id: 'rj', percentual: 20, valor: 20 }], 'linhas que ficaram iguais se juntam (rateio continua válido)');
  eq(validarRateio(100, nova?.rateio).ok, true, 'rateio depois de juntar fecha 100%');
  eq(conta.categoria_id, 'alug', 'a conta original não é alterada (função pura)');
  eq(trocarCategoriaNaConta({ categoria_id: 'outra', rateio: [] }, { id: 'alug' }, 'luz'), null, 'conta sem a categoria não muda');
  eq(trocarCategoriaNaConta({ categoria_id: '2.2.01' }, { id: 'alug', codigo: '2.2.01' }, 'luz')?.categoria_id, 'luz', 'código digitado na conta a receber também é movido');
  eq(trocarCategoriaNaRegra([{ centro_custo_id: 'sp', categoria_id: 'alug', percentual: 100 }], { id: 'alug' }, 'luz'), [{ centro_custo_id: 'sp', categoria_id: 'luz', percentual: 100 }], 'regra salva também é movida');
}

console.log('--- árvore de centros ---');
{
  eq(criaCiclo('adm', 'sp', centros), true, 'pôr o pai dentro do filho é ciclo');
  eq(criaCiclo('sp', 'sp', centros), true, 'centro dentro dele mesmo é ciclo');
  eq(criaCiclo('mkt', 'adm', centros), false, 'mover para outro galho pode');
  eq(ordenarEmArvore(centros).map(c => `${c.nivel}:${c.nome}`), ['0:Administrativo', '1:Loja RJ', '1:Loja SP', '0:Marketing'], 'árvore em ordem, pai antes dos filhos');
  eq([...centroEDescendentes('adm', centros)].sort(), ['adm', 'rj', 'sp'], 'filtrar um centro traz os de baixo');
}

console.log('--- relatórios ---');
{
  const hoje = '2026-11-05';
  const f = (q: Record<string, string>) => lerFiltros(new URLSearchParams(q), hoje);
  eq([f({}).de, f({}).ate, f({}).data_de, f({}).situacao], ['2026-11-01', '2026-11-30', 'VENCIMENTO', 'TODAS'], 'padrão: mês atual por vencimento');
  let msg = '';
  try { f({ de: '2026-12-01', ate: '2026-11-01' }); } catch (e) { msg = e instanceof ErroFiltro ? e.message : 'outro'; }
  eq(msg, 'A data inicial do período vem depois da final.', 'período invertido é recusado');
  eq(f({ por_pagina: '9999' }).por_pagina, 200, 'página limitada a 200 linhas');
  eq(situacaoDaConta({ status: 'PENDENTE', data_vencimento: '2026-11-01' }, hoje), 'EM_ATRASO', 'vencida em aberto = em atraso');
  eq(situacaoDaConta({ status: 'CANCELADO' }, hoje), 'EXCLUIDO', 'cancelada = excluído');

  const contas = [
    { id: 'p1', lado: 'pagar' as const, data: { valor_final: 1000, categoria_id: 'alug', status: 'PARCIAL', valor_pago: 250, data_vencimento: '2026-11-10', data_emissao: '2026-11-01', data_pagamento: '2026-11-03', fornecedor_nome: 'Imobiliária', descricao: 'Aluguel nov', tags: ['sede'],
      rateio: [{ centro_custo_id: 'sp', percentual: 60, valor: 600 }, { centro_custo_id: 'rj', percentual: 40, valor: 400 }] } },
    { id: 'p2', lado: 'pagar' as const, data: { valor_final: 200, categoria_id: 'rep', status: 'PAGO', data_vencimento: '2026-11-12', data_pagamento: '2026-11-04', fornecedor_nome: 'Operadora', descricao: '=HYPERLINK("x")', rateio: [] } },
    { id: 'r1', lado: 'receber' as const, data: { valor_final: 500, categoria_id: 'rec', status: 'PENDENTE', data_vencimento: '2026-11-20', cliente_nome: 'Ana', descricao: 'Fee', centro_custo: 'Marketing', rateio: [] } },
    { id: 'p3', lado: 'pagar' as const, data: { valor_final: 70, categoria_id: 'luz', status: 'CANCELADO', data_vencimento: '2026-11-15', fornecedor_nome: 'Luz', rateio: [] } },
  ];
  const ctx = { categorias, centros, contasBancarias: new Map<string, string>(), vendas: new Map<string, string>() };
  const cat = montarLinhas(contas, ctx, f({}), hoje);
  eq(cat.map(l => [l.conta_id, l.categoria_nome, l.valor]), [['p1', 'Aluguel', 1000], ['r1', 'Fee de Serviço', 500]], 'por categoria, competência: repasse fora por padrão, excluído fora em "Todas"');
  eq(montarLinhas(contas, ctx, f({ incluir_repasse: '1' }), hoje).length, 3, '"Mostrar repasses" traz o repasse');
  const caixa = montarLinhas(contas, ctx, f({ data_de: 'MOVIMENTACAO', incluir_repasse: '1' }), hoje);
  eq(caixa.map(l => [l.conta_id, l.valor, l.valor_movimentacao]), [['p1', 250, 250], ['p2', 200, 200]], 'movimentação = regime de caixa, proporcional ao pago');
  const cen = montarLinhas(contas, ctx, f({ visao: 'centro', data_de: 'MOVIMENTACAO' }), hoje);
  eq(cen.map(l => [l.centro_custo_nome, l.percentual, l.valor]), [['Loja SP', 60, 150], ['Loja RJ', 40, 100]], 'por centro em caixa: % e valor do centro sobre o pago');
  eq(montarLinhas(contas, ctx, f({ visao: 'centro', centro_custo_id: 'adm' }), hoje).map(l => l.centro_custo_nome), ['Loja SP', 'Loja RJ'], 'filtro pelo centro de cima traz os de baixo');
  eq(montarLinhas(contas, ctx, f({ visao: 'rateio' }), hoje).map(l => l.conta_id), ['p1', 'p1'], 'por rateio: só as contas rateadas, uma linha por parte');
  eq(montarLinhas(contas, ctx, f({ tipo: 'RECEITA' }), hoje).map(l => l.conta_id), ['r1'], 'tipo receita');
  eq(montarLinhas(contas, ctx, f({ situacao: 'EXCLUIDO' }), hoje).map(l => l.conta_id), ['p3'], 'situação excluído');
  eq(montarLinhas(contas, ctx, f({ pesquisar: 'imobiliaria', em: 'PESSOA' }), hoje).map(l => l.conta_id), ['p1'], 'pesquisar em pessoa, sem acento');
  eq(montarLinhas(contas, ctx, f({ tag: 'SEDE' }), hoje).map(l => l.conta_id), ['p1'], 'filtro por tag');
  eq(montarLinhas(contas, ctx, f({ categoria_id: 'g22' }), hoje).map(l => l.conta_id), ['p1'], 'filtro pelo grupo de categoria');

  const t = totalizar(montarLinhas(contas, ctx, f({ visao: 'centro' }), hoje));
  eq([t.quantidade, t.lancamentos, t.valor, t.valor_lancamento], [3, 2, 1500, 1500], 'totais: conta rateada entra uma vez no valor do lançamento');
  const g = agruparLinhas(cat, { ...f({ agrupar: 'tipo' }) });
  eq(g.map(x => [x.rotulo, x.quantidade, x.valor]), [['Despesa', 1, 1000], ['Receita', 1, 500]], 'agrupar por tipo');
  eq(ordenarLinhas(cat, f({ ordenar: 'valor', direcao: 'asc' })).map(l => l.conta_id), ['r1', 'p1'], 'ordenar por valor');
  eq(paginar([1, 2, 3, 4, 5], 9, 2), { itens: [5], pagina: 3, paginas: 3 }, 'página além do fim vira a última');

  const csv = planilhaDasLinhas('categoria', montarLinhas(contas, ctx, f({ incluir_repasse: '1' }), hoje));
  eq(csv.startsWith('﻿"Número";"Nº da venda"'), true, 'planilha com BOM e ";"');
  eq(csv.includes(`"'=HYPERLINK(""x"")"`), true, 'fórmula na descrição sai neutralizada');
  eq(csv.includes('"1000,00"'), true, 'valor com vírgula decimal');
}

console.log(`\n${total - falhas}/${total} testes passaram`);
if (falhas > 0) {
  console.log(`${falhas} FALHAS`);
  process.exit(1);
}
