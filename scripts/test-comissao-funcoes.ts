/**
 * Comissões por função (E5, parte F), lógica pura: plano em matriz (faixa ×
 * produto × função), faixa por degrau e progressiva, cálculo com
 * intermediário e valor retido, liberar no recebimento (proporcional), o que
 * entra em cada fechamento (complemento e estorno), pagamento parcial e a
 * explicação "por que recebi isto?".
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-comissao-funcoes.ts
 */
import { normalizarVenda } from '../src/lib/venda-modelo.ts';
import { normalizarConfigReceita } from '../src/lib/venda-receita.ts';
import {
  calcularComissoesPorFuncao, pesosDasFaixas, regraDaFaixa, normalizarPlano, normalizarSobre, errosDoPlano, normalizarConfigComissao,
  itensAFechar, linhasDoFechamento, repartirPagamento, frasesDaExplicacao, situacaoDoItem, assinaturaDaPrevia, baseDoProduto,
  CONFIG_COMISSAO_PADRAO, funcoesDoSistema,
  type EntradaDoCalculo, type PessoaDaFuncao, type LancamentoGravado,
} from '../src/lib/comissao-funcoes.ts';
// A regra de hoje continua igual (congelada): os módulos dela não mudaram.
import { calcularComissaoDoMes } from '../src/lib/comissao-acumulada.ts';

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

// Venda de R$ 2.000 de hotel com Comissão de R$ 200 e RAV de R$ 50, e um aéreo com Taxa DU de R$ 40.
const venda = (o: Record<string, unknown> = {}) => normalizarVenda({
  id: 'v1', numero: 'VND-0001', data_venda: '2026-11-03', cliente: { id: 'c1', nome: 'Ana Lima' },
  vendedor: { id: 'u-bia', nome: 'Bia' },
  produtos: [
    { id: 'p-hotel', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f1', nome: 'Hotel Mar' }, quantidade: 1, valor_unitario_centavos: 200000,
      componentes: [{ tipo: 'COMISSAO', valor_centavos: 20000 }, { tipo: 'RAV', valor_centavos: 5000 }] },
    { id: 'p-aereo', tipo: 'AEREO', descricao: 'GRU-LIS', fornecedor: { id: 'f2', nome: 'Cia' }, quantidade: 1, valor_unitario_centavos: 300000,
      componentes: [{ tipo: 'TAXA_DU', valor_centavos: 4000 }] },
  ],
  ...o,
}).venda;

const [VENDEDOR, INTERMEDIARIO] = funcoesDoSistema();
const bia: PessoaDaFuncao = { id: 'fn-vendedor:u-bia', funcao_id: VENDEDOR.id, pessoa_id: 'u-bia', pessoa_nome: 'Bia', plano_id: 'pl1', data_inicio: '', nao_comissionado: false };
const config = { ...CONFIG_COMISSAO_PADRAO, regra: 'FUNCOES' as const, meta_sobre: normalizarSobre(['RECEITA']) };

// Plano em matriz: faixa 0% e 100%; hotel ganha sobre a Comissão, o resto sobre a receita.
const plano = normalizarPlano({
  id: 'pl1', nome: 'Plano Vendas', modo_faixa: 'DEGRAU',
  faixas: [
    { percentual_meta: 0, regras: [
      { produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 10, sobre: ['RECEITA'] } },
      { produto: 'HOSPEDAGEM', funcao_id: VENDEDOR.id, calculo: { tipo: 'PERCENTUAL', percentual: 20, sobre: ['COMISSAO'] },
        com_intermediario: { tipo: 'PERCENTUAL', percentual: 10, sobre: ['COMISSAO'] } },
      { produto: '*', funcao_id: INTERMEDIARIO.id, calculo: { tipo: 'VALOR', valor_centavos: 1500 } },
    ] },
    { percentual_meta: 100, regras: [
      { produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 20, sobre: ['RECEITA'] } },
      { produto: 'HOSPEDAGEM', funcao_id: VENDEDOR.id, calculo: { tipo: 'PERCENTUAL', percentual: 30, sobre: ['COMISSAO'] } },
    ] },
  ],
});

const entrada = (o: Partial<EntradaDoCalculo> = {}): EntradaDoCalculo => ({
  vendas: [{ venda: venda(), cancelada: false, situacao: 'ABERTA' }],
  funcoes: funcoesDoSistema(), pessoas: [bia], planos: [plano],
  metas: [{ pessoa_funcao_id: bia.id, mes: '2026-11', centavos: 50000 }],
  config, ate: '2026-11-30', ...o,
});

console.log('--- Base e regras ---');
const v = venda();
eq(baseDoProduto(v.produtos[0], ['RECEITA']), 25000, 'receita do hotel = Comissão + RAV');
eq(baseDoProduto(v.produtos[0], ['COMISSAO', 'RAV']), 25000, 'componentes escolhidos somam com sinal');
eq(baseDoProduto(v.produtos[0], ['RECEITA'], normalizarConfigReceita({ componentes: { RAV: false } })), 20000, 'receita segue Configurações › Vendas');
eq(normalizarSobre(['COMISSAO', 'RECEITA', 'RAV']), ['RECEITA'], 'atalho é a base inteira (não soma duas vezes)');
eq(regraDaFaixa(plano.faixas[0], 'HOSPEDAGEM', VENDEDOR.id)?.calculo.percentual, 20, 'produto + função exatos vencem');
eq(regraDaFaixa(plano.faixas[0], 'AEREO', VENDEDOR.id)?.calculo.percentual, 10, 'sem regra do produto: vale "todos os produtos"');
eq(regraDaFaixa(plano.faixas[0], 'AEREO', INTERMEDIARIO.id)?.calculo.tipo, 'VALOR', 'função exata vence "todas as funções"');
eq(errosDoPlano(normalizarPlano({ faixas: [{ percentual_meta: 0, regras: [{ produto: '*', calculo: { tipo: 'PERCENTUAL', percentual: 5, sobre: [] } }] }] })).length, 1, 'percentual sem base é recusado');
eq(errosDoPlano(normalizarPlano({ faixas: [] })), ['O plano precisa de pelo menos uma faixa de meta.'], 'plano sem faixa é recusado');
eq(normalizarConfigComissao({}).regra, 'ATUAL', 'padrão: a regra de hoje');

console.log('--- Faixa por degrau e progressiva ---');
const faixas = [{ percentual_meta: 0 }, { percentual_meta: 100 }];
eq(pesosDasFaixas(faixas, 80, 'DEGRAU'), [{ percentual_meta: 0, peso: 1 }], 'degrau: 80% fica na faixa 0');
eq(pesosDasFaixas(faixas, 120, 'DEGRAU'), [{ percentual_meta: 100, peso: 1 }], 'degrau: 120% leva o mês inteiro para a faixa 100');
eq(pesosDasFaixas(faixas, 125, 'PROGRESSIVA').map(p => [p.percentual_meta, Math.round(p.peso * 1000) / 1000]), [[0, 0.8], [100, 0.2]], 'progressiva: 100/125 na faixa 0 e 25/125 na faixa 100');
eq(pesosDasFaixas([{ percentual_meta: 80 }], 50, 'DEGRAU'), [], 'abaixo da primeira faixa: meta não atingida');
eq(pesosDasFaixas([{ percentual_meta: 0 }], null, 'DEGRAU'), [{ percentual_meta: 0, peso: 1 }], 'plano sem meta: faixa única');

// Meta 500 e receita do mês 290 (hotel 250 + DU 40) = 58% → faixa 0.
let r = calcularComissoesPorFuncao(entrada());
eq(r.resumos.map(x => [x.percentual, x.faixa_atual, x.proxima_faixa, x.falta_para_proxima_centavos]), [[58, 0, 100, 21000]], 'faltam R$ 210 para a próxima faixa');
eq(r.itens.map(i => [i.produto_id, i.valor_centavos]), [['p-hotel', 4000], ['p-aereo', 400]], 'matriz na faixa 0: hotel 20% da Comissão, aéreo 10% da receita');

// Meta 250: 116% → degrau leva tudo à faixa 100.
r = calcularComissoesPorFuncao(entrada({ metas: [{ pessoa_funcao_id: bia.id, mes: '2026-11', centavos: 25000 }] }));
eq(r.itens.map(i => i.valor_centavos), [6000, 800], 'degrau: o mês inteiro na faixa 100 (30% e 20%)');
eq(r.resumos[0].falta_para_proxima_centavos, null, 'no topo não há próxima faixa');

const progressivo = normalizarPlano({ ...plano, modo_faixa: 'PROGRESSIVA' });
r = calcularComissoesPorFuncao(entrada({ planos: [progressivo], metas: [{ pessoa_funcao_id: bia.id, mes: '2026-11', centavos: 25000 }] }));
// 116% → pesos 100/116 e 16/116: hotel 4000·0,862 + 6000·0,138 = 4276; aéreo 400·0,862 + 800·0,138 = 455.
eq(r.itens.map(i => i.valor_centavos), [4276, 455], 'progressiva: só o que passou de 100% ganha a taxa maior');
eq(r.itens[0].explicacao.faixas.length, 2, 'progressiva: a explicação mostra as duas faixas');

console.log('--- Erros não travam os outros ---');
const leo: PessoaDaFuncao = { ...bia, id: 'fn-vendedor:u-leo', pessoa_id: 'u-leo', pessoa_nome: 'Leo' };
const vendaLeo = venda({ id: 'v2', numero: 'VND-0002', vendedor: { id: 'u-leo', nome: 'Leo' } });
r = calcularComissoesPorFuncao(entrada({ pessoas: [bia, leo], vendas: [{ venda: venda(), cancelada: false, situacao: 'ABERTA' }, { venda: vendaLeo, cancelada: false, situacao: 'ABERTA' }] }));
eq(r.resumos.map(x => [x.pessoa_nome, x.erros]), [['Bia', []], ['Leo', ['Meta de 11/2026 não definida.']]], 'Leo sem meta: erro só dele');
eq(r.itens.every(i => i.pessoa_id === 'u-bia'), true, 'Bia calcula normalmente');
r = calcularComissoesPorFuncao(entrada({ pessoas: [{ ...bia, plano_id: 'nao-existe' }] }));
eq(r.resumos[0].erros, ['Plano não definido.'], 'sem plano: erro');
r = calcularComissoesPorFuncao(entrada({ pessoas: [{ ...bia, nao_comissionado: true }] }));
eq([r.itens.length, r.resumos[0].erros], [0, []], 'sem comissão: nada e sem erro');

console.log('--- Intermediário e valor retido ---');
const comInter = venda({
  intermediario: { id: 'f-parc', nome: 'Agência Parceira' },
  produtos: [{ id: 'p-hotel', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', quantidade: 1, valor_unitario_centavos: 200000,
    componentes: [{ tipo: 'COMISSAO', valor_centavos: 20000 }, { tipo: 'REPASSE_INTERMEDIARIO', valor_centavos: 3000 }] }],
  pagamentos: [{ id: 'g1', forma: 'RETIDO_INTERMEDIARIO', valor_centavos: 200000 }],
});
const parc: PessoaDaFuncao = { id: 'fn-intermediario:f-parc', funcao_id: INTERMEDIARIO.id, pessoa_id: 'f-parc', pessoa_nome: 'Agência Parceira', plano_id: 'pl1', data_inicio: '', nao_comissionado: false };
r = calcularComissoesPorFuncao(entrada({
  vendas: [{ venda: comInter, cancelada: false, situacao: 'ABERTA' }], pessoas: [bia, parc],
  metas: [{ pessoa_funcao_id: bia.id, mes: '2026-11', centavos: 50000 }, { pessoa_funcao_id: parc.id, mes: '2026-11', centavos: 50000 }],
}));
const itBia = r.itens.find(i => i.pessoa_id === 'u-bia')!;
const itParc = r.itens.find(i => i.pessoa_id === 'f-parc')!;
eq([itBia.valor_centavos, itBia.explicacao.com_intermediario], [2000, true], 'venda com intermediário: vale o cálculo próprio (10% da Comissão)');
eq([itParc.valor_centavos, itParc.retido_centavos, itParc.valor_centavos - itParc.retido_centavos], [1500, 3000, -1500], 'intermediário: R$ 15 do plano, já reteve R$ 30, saldo −R$ 15');

console.log('--- Liberar no recebimento (proporcional) ---');
const cfgRec = { ...config, liberar: 'RECEBIMENTO' as const };
const rec = { v1: { total_centavos: 100000, movimentos: [{ data: '2026-11-10', centavos: 40000 }, { data: '2026-12-10', centavos: 60000 }] } };
r = calcularComissoesPorFuncao(entrada({ config: cfgRec, recebimentos: rec, ate: '2026-11-30' }));
eq(r.itens.map(i => i.liberado_centavos), [1600, 160], 'cliente pagou 40%: 40% liberado');
const frases = frasesDaExplicacao(r.itens[0].explicacao, r.itens[0].valor_centavos).map(f => f.replace(/\u00a0/g, ' '));
eq(frases.some(f => f.includes('Liberado 40%') && f.includes('R$ 400,00 de R$ 1.000,00')), true, '"por que recebi isto?" mostra o recebido');
eq(frases.some(f => f.includes('Base: Comissão R$ 200,00') && f.includes('20% da base')), true, '"por que recebi isto?" mostra a base e o percentual');
const r2 = calcularComissoesPorFuncao(entrada({ config: cfgRec, recebimentos: rec, ate: '2026-12-31' }));
eq(r2.itens.map(i => i.liberado_centavos), [4000, 400], 'pagou tudo: liberado inteiro');
const estornado = { v1: { total_centavos: 100000, movimentos: [...rec.v1.movimentos, { data: '2026-12-20', centavos: -60000 }] } };
const r3 = calcularComissoesPorFuncao(entrada({ config: cfgRec, recebimentos: estornado, ate: '2026-12-31' }));
eq(r3.itens.map(i => i.liberado_centavos), [1600, 160], 'recebimento estornado: o liberado volta a 40%');

console.log('--- Fechar: complemento, nada em dobro, estorno ---');
const calc1 = calcularComissoesPorFuncao(entrada({ config: cfgRec, recebimentos: rec, ate: '2026-11-30' }));
let af = itensAFechar(calc1.itens, []);
eq(af.map(i => i.valor_centavos), [160, 1600], '1º fechamento: o liberado');
const gravado = (chave: string, fechado: number): LancamentoGravado => ({
  chave, pessoa_funcao_id: bia.id, pessoa_id: 'u-bia', pessoa_nome: 'Bia', funcao_nome: 'Vendedor', venda_id: 'v1', venda_numero: 'VND-0001',
  data_venda: '2026-11-03', mes: '2026-11', descricao: '', fechado_centavos: fechado, fechado_retido_centavos: 0,
});
const g1 = [gravado('v1|p-hotel|fn-vendedor:u-bia', 1600), gravado('v1|p-aereo|fn-vendedor:u-bia', 160)];
eq(itensAFechar(calc1.itens, g1).length, 0, 'fechar de novo na mesma data: nada');
af = itensAFechar(r2.itens, g1);
eq(af.map(i => i.valor_centavos), [240, 2400], 'cliente pagou o resto: entra o complemento');
const cancelada = calcularComissoesPorFuncao(entrada({ vendas: [{ venda: venda(), cancelada: true, situacao: 'ABERTA' }] }));
af = itensAFechar(cancelada.itens, g1);
eq(af.map(i => [i.valor_centavos, i.estorno]), [[-160, true], [-1600, true]], 'venda cancelada: estorno automático do que foi fechado');
eq(frasesDaExplicacao(cancelada.itens[0].explicacao, 0)[0].startsWith('A venda foi cancelada'), true, 'explicação do estorno');
af = itensAFechar([], g1);
eq(af.map(i => i.valor_centavos), [-160, -1600], 'venda que saiu do cálculo: estorno');
const linhas = linhasDoFechamento(calc1.resumos, itensAFechar(calc1.itens, []));
eq(linhas.map(l => [l.pessoa_nome, l.saldo_centavos, l.erros.length]), [['Bia', 1760, 0]], 'uma linha por pessoa');
eq(assinaturaDaPrevia('2026-11-30', linhas) === assinaturaDaPrevia('2026-11-30', linhas), true, 'assinatura estável');
eq(assinaturaDaPrevia('2026-11-30', linhas) === assinaturaDaPrevia('2026-12-01', linhas), false, 'assinatura muda com a data');

console.log('--- Pagar total ou parcial ---');
const itensFechados = [
  { id: 'a', data_venda: '2026-11-01', saldo_centavos: 5000, pago_centavos: 0 },
  { id: 'b', data_venda: '2026-11-05', saldo_centavos: 3000, pago_centavos: 0 },
  { id: 'c', data_venda: '2026-11-07', saldo_centavos: -1000, pago_centavos: 0 },
];
eq(repartirPagamento(itensFechados, null), [{ id: 'a', centavos: 5000 }, { id: 'b', centavos: 3000 }, { id: 'c', centavos: -1000 }], 'total: tudo em aberto, estorno incluído');
eq(repartirPagamento(itensFechados, 6000), [{ id: 'c', centavos: -1000 }, { id: 'a', centavos: 5000 }, { id: 'b', centavos: 2000 }], 'parcial: estorno primeiro, depois o mais antigo');
eq(repartirPagamento([{ ...itensFechados[1], pago_centavos: 2000 }], null), [{ id: 'b', centavos: 1000 }], 'o já pago não se paga de novo');
eq(situacaoDoItem({ valor_centavos: 100, liberado_centavos: 100, fechado_centavos: 100, pago_centavos: 100 }), 'PAGA', 'situação paga');
eq(situacaoDoItem({ valor_centavos: 100, liberado_centavos: 40, fechado_centavos: 0, pago_centavos: 0 }), 'LIBERADA', 'situação liberada');
eq(situacaoDoItem({ valor_centavos: 100, liberado_centavos: 0, fechado_centavos: 0, pago_centavos: 0 }), 'PREVISTA', 'situação prevista');

console.log('--- Função "ganha sobre" e datas ---');
const gerente = { id: 'fn-gerente', nome: 'Gerente', sistema: null, sobre_pessoas: ['u-bia'], sobre_unidades: [], ativo: true };
const ger: PessoaDaFuncao = { id: 'fn-gerente:u-ger', funcao_id: 'fn-gerente', pessoa_id: 'u-ger', pessoa_nome: 'Gil', plano_id: 'pl-ger', data_inicio: '', nao_comissionado: false };
const planoGer = normalizarPlano({ id: 'pl-ger', nome: 'Gerência', faixas: [{ percentual_meta: 0, regras: [{ produto: '*', funcao_id: 'fn-gerente', calculo: { tipo: 'PERCENTUAL', percentual: 2, sobre: ['VALOR_VENDA'] } }] }] });
r = calcularComissoesPorFuncao(entrada({ funcoes: [...funcoesDoSistema(), gerente], pessoas: [ger], planos: [plano, planoGer], metas: [] }));
eq([r.itens.length, r.itens.reduce((a, i) => a + i.valor_centavos, 0), r.resumos[0].erros], [2, 10180, []], 'gerente ganha 2% do valor de venda (R$ 5.090) das vendas da Bia, sem meta (faixa única)');
r = calcularComissoesPorFuncao(entrada({ pessoas: [{ ...bia, data_inicio: '2026-11-10' }] }));
eq(r.itens.length, 0, 'venda antes do início da pessoa não entra');

console.log('--- A regra de hoje continua igual ---');
const mes = calcularComissaoDoMes([{ venda_id: 'a', base: 10000, pct_fallback: 5 }, { venda_id: 'b', base: 200, pct_fallback: 5 }], { faixas: [{ de: 0, ate: 5000, percentual: 10 }, { de: 5000.01, ate: 0, percentual: 13.5 }], percentual_padrao: 5 });
eq([mes.percentual, mes.total], [13.5, 1377], 'faixa retroativa pelo acumulado do mês (regra de hoje)');

console.log('--- Vocabulário ---');
const todas = [...frases, ...frasesDaExplicacao(itParc.explicacao, itParc.valor_centavos)].join(' ');
const proibidos = ['Gerar Lançamento', 'Taxa de Serviço Oculta', 'Taxa de Serviço Destacada', 'Saldo Excluído', 'Lei Kandir', 'Fornecimento', 'Representação', 'Gerar Fatura'];
eq(proibidos.filter(t => todas.includes(t)), [], 'nenhum termo proibido');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
