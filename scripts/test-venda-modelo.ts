/**
 * A venda completa (E5, parte A), lógica pura: modelo, receita aberta por
 * componente e configurável, contas que nascem sozinhas por forma de
 * pagamento e a posição da venda.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-venda-modelo.ts
 */
import { normalizarVenda, totaisDoProduto, totaisDaVenda, type Venda } from '../src/lib/venda-modelo.ts';
import { receitaDaVenda, normalizarConfigReceita, CONFIG_RECEITA_PADRAO } from '../src/lib/venda-receita.ts';
import { contasDaVenda } from '../src/lib/venda-contas.ts';
import { posicaoDaVenda } from '../src/lib/venda-posicao.ts';
import { vendaDoV1 } from '../src/lib/venda-modelo-v1.ts';
import { gerarContasVenda } from '../src/lib/venda-financeiro.ts';
import { VENDAS_V1 } from './fixture-venda-v1.ts';

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

const HOJE = '2026-11-05';
const base = (o: Record<string, unknown> = {}) => normalizarVenda({
  id: 'vx', numero: 'VND-0100', data_venda: '2026-11-01',
  cliente: { id: 'cli-1', nome: 'Ana Lima' },
  intermediario: { id: 'int-1', nome: 'Agência Parceira' },
  produtos: [
    {
      id: 'p-hotel', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar 4 noites', quem_cobra: 'AGENCIA',
      fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' },
      passageiros: [
        { id: 'px1', nome: 'Ana', tarifa_centavos: 100000, taxas_centavos: 5000 },
        { id: 'px2', nome: 'Beto', tarifa_centavos: 100000, taxas_centavos: 5000 },
      ],
      componentes: [
        { tipo: 'MARKUP', valor_centavos: 20000 },
        { tipo: 'RAV', valor_centavos: 3000, passageiro_id: 'px1' },
        { tipo: 'RAV', valor_centavos: 3000, passageiro_id: 'px2' },
        { tipo: 'COMISSAO', percentual: 10 },
      ],
    },
    {
      id: 'p-aereo', tipo: 'AEREO', descricao: 'GRU-LIS', quem_cobra: 'FORNECEDOR',
      fornecedor: { id: 'f-cia', nome: 'Cia Aérea' }, representante: { id: 'r-cons', nome: 'Consolidadora' },
      quantidade: 1, valor_unitario_centavos: 300000, taxas_centavos: 30000,
      componentes: [
        { tipo: 'TAXA_DU', valor_centavos: 10000 },
        { tipo: 'COMISSAO', valor_centavos: 15000 },
        { tipo: 'TAXA_CC', valor_centavos: 500 },
        { tipo: 'REPASSE_INTERMEDIARIO', valor_centavos: 5000 },
      ],
    },
  ],
  pagamentos: [
    { id: 'pg-pix', forma: 'PIX', valor_centavos: 50000 },
    { id: 'pg-bol', forma: 'BOLETO', valor_centavos: 100000, parcelas: 2, primeiro_vencimento: '2026-12-10' },
    { id: 'pg-car', forma: 'CARTAO', valor_centavos: 36000, parcelas: 3, cartao_tipo: 'credito', detalhe: 'cartão 4111 1111 1111 1111 aut 123' },
    { id: 'pg-cre', forma: 'CREDITO_CLIENTE', valor_centavos: 20000, venda_origem_credito: 'VND-0007' },
    { id: 'pg-fat', forma: 'FATURAR', valor_centavos: 30000 },
  ],
  ...o,
}).venda;

console.log('--- Modelo e totais ---');
const v = base();
const th = totaisDoProduto(v.produtos[0]);
eq([th.tarifa, th.taxas, th.componentes.COMISSAO, th.valor_cliente, th.valor_fornecedor, th.receita_bruta], [200000, 10000, 20000, 236000, 190000, 46000],
  'hotel: comissão de 10% sobre a tarifa; cliente 2.360, fornecedor 1.900, receita 460');
const ta = totaisDoProduto(v.produtos[1]);
eq([ta.valor_cliente, ta.valor_fornecedor, ta.repasse, ta.receita_bruta], [340000, 315500, 5000, 19500], 'aéreo: cliente 3.400, fornecedor 3.155, repasse 50, receita 195');
const tv = totaisDaVenda(v);
eq([tv.valor_cliente, tv.cobrado_pelo_fornecedor, tv.pagamentos, tv.saldo_sem_forma], [576000, 340000, 236000, 0], 'venda: o que o fornecedor cobra + pagamentos = total');
eq(v.pagamentos[2].detalhe, 'cartão •••• 1111 aut 123', 'número de cartão nunca é guardado');
const { erros } = normalizarVenda({ produtos: [{ componentes: [{ tipo: 'GORJETA' }] }], pagamentos: [{ forma: 'PIX', valor_centavos: 0 }] });
eq(erros.map(e => e.campo), ['cliente', 'data_venda', 'produtos[0].componentes', 'pagamentos[0].valor_centavos'], 'erros que impedem gravar');
const cancelado = normalizarVenda({ produtos: [{ passageiros: [{ id: 'a', tarifa_centavos: 1000, cancelado_em: '2026-11-02' }, { id: 'b', tarifa_centavos: 500 }], componentes: [{ tipo: 'RAV', valor_centavos: 99, passageiro_id: 'a' }] }] }).venda;
eq([totaisDoProduto(cancelado.produtos[0]).tarifa, totaisDoProduto(cancelado.produtos[0]).componentes.RAV], [500, 0], 'passageiro cancelado e o componente dele saem das contas');

console.log('--- Receita aberta e configurável ---');
const r = receitaDaVenda(v);
eq(r.linhas.map(l => [l.tipo, l.valor, l.sinal]), [['COMISSAO', 35000, 1], ['TAXA_DU', 10000, 1], ['RAV', 6000, 1], ['MARKUP', 20000, 1], ['TAXA_CC', 500, -1], ['REPASSE_INTERMEDIARIO', 5000, -1]], 'linhas por componente, na ordem do mercado');
eq([r.receita, r.fora_da_receita, r.faturamento, r.percentual], [65500, 0, 576000, 11.37], 'receita = soma dos componentes com sinal');
eq(r.por_produto.map(p => [p.produto_id, p.receita]), [['p-hotel', 46000], ['p-aereo', 19500]], 'aberta por produto');
const semDu = normalizarConfigReceita({ componentes: { TAXA_DU: false, OVER: 'x' } });
const r2 = receitaDaVenda(v, semDu);
eq([r2.receita, r2.fora_da_receita, r2.linhas.find(l => l.tipo === 'TAXA_DU')?.entra, semDu.componentes.OVER], [55500, 10000, false, true], 'sem a Taxa DU: sai da receita e aparece fora dela');
eq(r2.receita + r2.fora_da_receita, totaisDaVenda(v).receita_bruta, 'receita + fora da receita = receita bruta');

console.log('--- Contas por forma de pagamento (v2) ---');
const c = contasDaVenda({ versao: 2, venda: v, hoje: HOJE, fornecedores: [{ id: 'f-hotel', nome_fantasia: 'Hotel Mar', regras_faturamento: { prazo_pagamento_dias: 15 } as never }] });
const cr = c.contas_receber.map(x => [x.origem, x.descricao, x.valor_final, x.data_vencimento, x.forma_recebimento, x.origem_item_id, x.parcela_numero]);
eq(cr, [
  ['VENDA', 'Venda VND-0100 - Pix', 500, '2026-11-01', 'PIX', 'v2:pag:pg-pix', 1],
  ['VENDA', 'Venda VND-0100 - Boleto - Parcela 1/2', 500, '2026-12-10', 'BOLETO', 'v2:pag:pg-bol', 1],
  ['VENDA', 'Venda VND-0100 - Boleto - Parcela 2/2', 500, '2027-01-10', 'BOLETO', 'v2:pag:pg-bol', 2],
  ['VENDA', 'Venda VND-0100 - Cartão - Parcela 1/3', 120, '2026-12-01', 'CARTAO_CREDITO', 'v2:pag:pg-car', 1],
  ['VENDA', 'Venda VND-0100 - Cartão - Parcela 2/3', 120, '2027-01-01', 'CARTAO_CREDITO', 'v2:pag:pg-car', 2],
  ['VENDA', 'Venda VND-0100 - Cartão - Parcela 3/3', 120, '2027-02-01', 'CARTAO_CREDITO', 'v2:pag:pg-car', 3],
  ['VENDA', 'Venda VND-0100 - Faturar', 300, '2026-12-01', 'FATURAR', 'v2:pag:pg-fat', 1],
  ['COMISSAO_FORNECEDOR', 'Comissão a receber - Consolidadora - Venda VND-0100', 245, '2026-12-01', '', 'v2:comissao:id:r-cons', 1],
], 'a receber: uma conta por parcela de cada forma; a comissão vem da consolidadora');
eq(c.contas_receber.find(x => x.origem_item_id === 'v2:pag:pg-fat')?.faturar, true, 'Faturar: conta marcada para a fatura do cliente');
eq(c.contas_pagar.map(x => [x.fornecedor_id, x.descricao, x.valor_final, x.data_vencimento, x.origem_item_id, x.is_custo_comercial]), [
  ['f-hotel', 'Venda VND-0100 - Hotel Mar (Hospedagem)', 1900, '2026-11-16', 'v2:forn:id:f-hotel:BRL', false],
  ['int-1', 'Venda VND-0100 - Repasse ao intermediário Agência Parceira', 50, '2026-12-01', 'v2:repasse:int-1', true],
], 'a pagar: o líquido do hotel no prazo do cadastro, e o repasse ao intermediário');
eq(c.pendencias.map(p => [p.tipo, p.chave, p.valor_centavos, p.pessoa.id, p.venda_origem_credito]), [['CREDITO_CLIENTE', 'v2:credito:pg-cre', 20000, 'cli-1', 'VND-0007']], 'Crédito do cliente: pendência para a carteira (parte D), nenhuma conta');
eq(c.avisos.map(a => a.codigo), [], 'venda completa e coberta: sem aviso');
eq([c.resumo.total_cliente, c.resumo.total_comissoes, c.resumo.total_custos, c.resumo.lucro_previsto, c.resumo.itens_proprio, c.resumo.itens_fornecedor], [2160, 245, 5055, 655, 1, 1], 'resumo no formato de sempre');
eq(new Set(c.contas_receber.map(x => `${x.origem_item_id}|${x.parcela_numero}`)).size, c.contas_receber.length, 'chave natural única por conta');

// Pago direto ao fornecedor abate o que a agência deve a ele.
const vPd = base({ pagamentos: [{ id: 'pd', forma: 'PAGO_DIRETO_FORNECEDOR', valor_centavos: 50000, fornecedor: { id: 'f-hotel' } }, { id: 'px', forma: 'PIX', valor_centavos: 186000 }] });
const cPd = contasDaVenda({ versao: 2, venda: vPd, hoje: HOJE });
eq(cPd.contas_pagar.find(x => x.fornecedor_id === 'f-hotel')?.valor_final, 1400, 'Pago direto ao fornecedor: a conta a pagar cai de 1.900 para 1.400');
eq(cPd.contas_receber.filter(x => x.origem === 'VENDA').map(x => x.valor_final), [1860], 'e não vira conta a receber');
// Pago direto que passa do líquido: o fornecedor fica devendo (comissão).
const vPd2 = base({ pagamentos: [{ id: 'pd', forma: 'PAGO_DIRETO_FORNECEDOR', valor_centavos: 236000 }] , produtos: [base().produtos[0]] });
const cPd2 = contasDaVenda({ versao: 2, venda: vPd2, hoje: HOJE });
eq([cPd2.contas_pagar.length, cPd2.contas_receber.map(x => [x.origem, x.valor_final])], [0, [['COMISSAO_FORNECEDOR', 460]]], 'cliente pagou tudo ao hotel: o hotel deve a receita à agência');
// Crédito no fornecedor sem dizer qual fornecedor, com dois: aviso.
const cCf = contasDaVenda({ versao: 2, venda: base({ pagamentos: [{ id: 'cf', forma: 'CREDITO_FORNECEDOR', valor_centavos: 236000 }] }), hoje: HOJE });
eq(cCf.avisos.map(a => a.codigo), ['PAGAMENTO_SEM_FORNECEDOR'], 'Crédito no fornecedor sem fornecedor, com dois na venda: aviso');
// Retido pelo intermediário: a conta é dele, menos o repasse.
const cRt = contasDaVenda({ versao: 2, venda: base({ pagamentos: [{ id: 'rt', forma: 'RETIDO_INTERMEDIARIO', valor_centavos: 30000 }, { id: 'px', forma: 'PIX', valor_centavos: 206000 }] }), hoje: HOJE });
eq(cRt.contas_receber.filter(x => x.venda_forma === 'RETIDO_INTERMEDIARIO').map(x => [x.origem, x.cliente_id, x.valor_final]), [['OUTROS', 'int-1', 250]], 'Retido pelo intermediário: a receber DELE, já sem o repasse de 50');
eq(cRt.contas_pagar.some(x => String(x.origem_item_id).startsWith('v2:repasse')), false, 'e o repasse não vira conta a pagar (ele já ficou com o dinheiro)');
// Sem pagamento: uma conta do total, como a venda de sempre.
const cSem = contasDaVenda({ versao: 2, venda: base({ pagamentos: [] }), hoje: HOJE });
eq(cSem.contas_receber.filter(x => x.origem === 'VENDA').map(x => [x.descricao, x.valor_final, x.data_vencimento, x.origem_item_id]), [['Venda VND-0100', 2360, '2026-12-01', 'v2:saldo']], 'sem forma de pagamento: uma conta do total, um mês depois da venda');
eq(cSem.avisos.map(a => a.codigo), [], 'e sem aviso (é a venda que ainda não disse a forma)');
const cMeio = contasDaVenda({ versao: 2, venda: base({ pagamentos: [{ id: 'px', forma: 'PIX', valor_centavos: 100000 }] }), hoje: HOJE });
eq([cMeio.contas_receber.find(x => x.origem_item_id === 'v2:saldo')?.valor_final, cMeio.avisos.map(a => a.codigo)], [1360, ['SALDO_SEM_FORMA']], 'pagamento parcial: o resto vira conta e aviso');
const cAcima = contasDaVenda({ versao: 2, venda: base({ pagamentos: [{ id: 'px', forma: 'PIX', valor_centavos: 300000 }] }), hoje: HOJE });
eq(cAcima.avisos.map(a => a.codigo), ['PAGAMENTOS_ACIMA_DO_TOTAL'], 'pagamentos acima do total: aviso');
// Moeda estrangeira: a conta a pagar guarda o valor na moeda e o câmbio.
const vUsd = normalizarVenda({ id: 'vu', numero: 'VND-0200', data_venda: '2026-11-01', cliente: { id: 'c', nome: 'C' }, produtos: [{ tipo: 'CRUZEIRO', moeda: 'usd', cambio: 5.5, fornecedor: { id: 'f-nav', nome: 'Navio' }, quantidade: 2, valor_unitario_centavos: 50000, componentes: [{ tipo: 'COMISSAO', valor_centavos: 10000 }] }] }).venda;
const cUsd = contasDaVenda({ versao: 2, venda: vUsd, hoje: HOJE });
eq(cUsd.contas_pagar.map(x => [x.moeda, x.cambio, x.valor_original, x.valor_final]), [['USD', 5.5, 900, 4950]], 'cruzeiro em dólar: 900 USD a 5,50 = 4.950 a pagar');
eq(cUsd.contas_receber.map(x => x.valor_final), [5500], 'o cliente paga em reais');
// Produto sem fornecedor: a conta a pagar nasce marcada.
const cSf = contasDaVenda({ versao: 2, venda: normalizarVenda({ id: 'vs', numero: 'N', data_venda: '2026-11-01', cliente: { nome: 'X' }, produtos: [{ quantidade: 1, valor_unitario_centavos: 1000 }] }).venda, hoje: HOJE });
eq([cSf.contas_pagar[0]?.fornecedor_pendente, cSf.avisos.map(a => a.codigo)], [true, ['PRODUTO_RECEITA_ZERO', 'PRODUTO_SEM_FORNECEDOR']], 'sem fornecedor: conta marcada para preencher e aviso');

console.log('--- Venda de antes lida no modelo (para mostrar) ---');
const e1 = VENDAS_V1.manual_completa;
const m1 = vendaDoV1(e1.venda as never, e1.itens, e1.fornecedores, { cliente_nome: 'Ana Lima' });
const g1 = gerarContasVenda(e1);
const r1 = receitaDaVenda(m1);
// Item em dólar: o desconto rateado em reais volta para a moeda; pode sobrar 1 centavo de câmbio.
eq(Math.abs(r1.receita / 100 - g1.resumo.lucro_previsto) <= 0.01, true, 'receita do modelo = lucro previsto da v1 (item em dólar: até 1 centavo de câmbio)');
for (const nome of ['por_fornecedor', 'bordas'] as const) {
  const e = VENDAS_V1[nome];
  eq(receitaDaVenda(vendaDoV1(e.venda as never, e.itens, e.fornecedores)).receita / 100, gerarContasVenda(e).resumo.lucro_previsto, `${nome}: receita do modelo = lucro previsto da v1, ao centavo`);
}
eq(m1.produtos.map(p => [p.tipo, p.quem_cobra]), [['HOSPEDAGEM', 'AGENCIA'], ['AEREO', 'AGENCIA'], ['PACOTE', 'FORNECEDOR']], 'tipos e quem cobra traduzidos');

console.log('--- Posição da venda ---');
const contas = (lista: Array<Record<string, unknown>>) => lista.map(x => ({ ...x }));
const crP = contas(c.contas_receber as never);
const cpP = contas(c.contas_pagar as never);
// O cliente pagou o Pix e METADE da 1ª parcela do boleto; o hotel já foi pago inteiro.
crP.find(x => x.origem_item_id === 'v2:pag:pg-pix')!.status = 'RECEBIDO';
const bol1 = crP.find(x => x.origem_item_id === 'v2:pag:pg-bol' && x.parcela_numero === 1)!;
Object.assign(bol1, { status: 'PARCIAL', valor_recebido: 250 });
Object.assign(cpP.find(x => x.fornecedor_id === 'f-hotel')!, { status: 'PAGO', valor_pago: 1900 });
const bol2 = crP.find(x => x.origem_item_id === 'v2:pag:pg-bol' && x.parcela_numero === 2)!;
const pos = posicaoDaVenda({
  venda: v, contas_receber: crP, contas_pagar: cpP, hoje: HOJE,
  cobrancas: [{ titulo_id: String(bol2.id), status: 'aberta', valor_centavos: 50000, vencimento: '2027-01-10' }, { titulo_id: 'outra', status: 'aberta', valor_centavos: 1, vencimento: null }],
  pendencias: [{ tipo: 'CREDITO_CLIENTE', valor_centavos: 20000, situacao: 'ABERTA' }],
});
eq([pos.cliente.total, pos.cliente.coberto_pelo_fornecedor, pos.cliente.coberto_por_credito, pos.cliente.a_receber, pos.cliente.recebido, pos.cliente.em_aberto, pos.cliente.situacao],
  [576000, 340000, 20000, 216000, 75000, 141000, 'PARCIAL'], 'cliente: baixa parcial conta só o que entrou');
eq(pos.cliente.cobrancas_abertas, { quantidade: 1, valor: 50000, vencidas: 0 }, 'cobrança aberta da venda (a de outra conta não entra)');
eq(pos.fornecedores.map(f => [f.nome, f.papel, f.a_pagar, f.pago, f.a_receber, f.situacao]), [
  ['Consolidadora', 'fornecedor', 0, 0, 24500, 'SEM_VALOR'],
  ['Hotel Mar', 'fornecedor', 190000, 190000, 0, 'PAGO'],
  ['Agência Parceira', 'intermediario', 5000, 0, 0, 'PENDENTE'],
], 'fornecedores: hotel pago, comissão a receber da consolidadora, repasse em aberto');
eq(pos.alertas.map(a => a.tipo), ['FORNECEDOR_PAGO_ANTES', 'CREDITO_PENDENTE'], 'alerta: o fornecedor foi pago antes de o cliente pagar');
eq(pos.alertas[0].valor, 115000, 'pagou 1.900, recebeu 750: 1.150 saíram antes');
eq(pos.receita.receita, 65500, 'receita na posição');
// Fornecedor ainda não pago, mas vence antes do cliente terminar de pagar.
const pos2 = posicaoDaVenda({ venda: v, contas_receber: contas(c.contas_receber as never), contas_pagar: contas(c.contas_pagar as never), hoje: HOJE });
eq(pos2.alertas.filter(a => a.tipo === 'FORNECEDOR_VENCE_ANTES').map(a => [a.parte_id, a.data, a.valor]), [['f-hotel', '2026-11-16', 190000]], 'alerta: o hotel vence antes de o cliente terminar de pagar');
const atraso = posicaoDaVenda({ venda: v, contas_receber: contas(c.contas_receber as never), contas_pagar: [], hoje: '2026-12-05' });
eq([atraso.cliente.em_atraso, atraso.alertas.some(a => a.tipo === 'CLIENTE_EM_ATRASO')], [50000 + 12000 + 30000, true], 'em atraso: o que venceu e não entrou');
eq(CONFIG_RECEITA_PADRAO.componentes.TAXA_DU, true, 'padrão: todo componente conta');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
