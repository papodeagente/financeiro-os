/**
 * Notas por regra e retenções na fonte (E5, parte E): a lógica pura.
 *
 * O que se prova:
 *  - a regra mais específica vale para o produto;
 *  - cada destino (ao pagante, ao fornecedor, ao representante) soma os
 *    componentes escolhidos e tira os descontos;
 *  - "Gerar notas": Receitas × Valor das notas × Saldo; nota complementar
 *    sugerida quando a receita cresce; nota de antes (por conta) entra no
 *    saldo e não gera nota repetida;
 *  - cancelamento sugerido (produto cancelado, venda cancelada, receita que
 *    caiu), nunca automático;
 *  - gatilhos: ao receber, ao fechar a fatura, ao receber a comissão;
 *  - retenções IR/CSLL/PIS/COFINS por cliente × produto, nacional e
 *    internacional, sobre cada base; na nota, na fatura e na conta líquida;
 *  - o cálculo da nota para a operadora: base inteira (antes: margem da venda).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-notas-regras.ts
 */
import { normalizarVenda, type Venda } from '../src/lib/venda-modelo.ts';
import {
  analisarVenda, assinaturaDaPrevia, combinacaoDaRegra, gatilhoCumprido, normalizarRegra, notaExistenteDe, paganteDaVenda,
  regraDoProduto, regraSugerida, valorDoDestino, formatarReais,
  type NotaExistente, type RegraDaNota,
} from '../src/lib/nota-regras.ts';
import {
  aplicarRetencoesNasContas, ambitoDoProduto, basesDoProduto, linhasDeRetencaoNaFatura, normalizarRetencao, retencaoAplicavel,
  retencoesDaVenda, type RetencaoDoCliente,
} from '../src/lib/nota-retencoes.ts';
import { calcularNota } from '../src/lib/nfse-calculo.ts';

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

function venda(o: { produtos?: unknown[]; extra?: Record<string, unknown> } = {}): Venda {
  const { venda: v, erros } = normalizarVenda({
    id: 'v1', numero: 'VND-0001', data_venda: '2026-11-01',
    cliente: { id: 'cli-1', nome: 'Prefeitura de Exemplo' },
    produtos: o.produtos ?? [
      {
        id: 'p-aereo', tipo: 'AEREO', descricao: 'GRU-REC', fornecedor: { id: 'f-cia', nome: 'Cia Aérea' },
        quantidade: 1, valor_unitario_centavos: 100000, taxas_centavos: 10000,
        componentes: [
          { tipo: 'TAXA_DU', valor_centavos: 4000 }, { tipo: 'RAV', valor_centavos: 3000 },
          { tipo: 'COMISSAO', valor_centavos: 6000 }, { tipo: 'OVER', valor_centavos: 1000 }, { tipo: 'DESCONTO', valor_centavos: 500 },
        ],
      },
      {
        id: 'p-hotel', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' },
        representante: { id: 'r-cons', nome: 'Consolidadora' },
        quantidade: 1, valor_unitario_centavos: 200000,
        componentes: [
          { tipo: 'FEE', valor_centavos: 5000 }, { tipo: 'MARKUP', valor_centavos: 10000 },
          { tipo: 'COMISSAO', valor_centavos: 20000 }, { tipo: 'TAXA_CC', valor_centavos: 300 },
        ],
      },
    ],
    pagamentos: [{ id: 'pg', forma: 'PIX', valor_centavos: 100000 }],
    ...(o.extra ?? {}),
  });
  if (erros.length) throw new Error(JSON.stringify(erros));
  return v;
}

const geral: RegraDaNota = { ...regraSugerida(), id: 'r-geral' };
const doHotel = normalizarRegra({
  id: 'r-hotel', descricao: 'Hospedagem', tipo_produto: 'HOSPEDAGEM',
  destinos: {
    PAGANTE: { ligado: true, receitas: ['FEE', 'MARKUP'], descontos: ['DESCONTO'], gatilho: 'AO_RECEBER' },
    FORNECEDOR: { ligado: false },
    REPRESENTANTE: { ligado: true, receitas: ['COMISSAO'], descontos: [], gatilho: 'AO_RECEBER_COMISSAO' },
  },
}).regra;
const regras = [geral, doHotel];

console.log('--- Regra e destinos ---');
const v = venda();
eq(regraDoProduto(regras, v, v.produtos[0])?.id, 'r-geral', 'aéreo: vale a regra geral');
eq(regraDoProduto(regras, v, v.produtos[1])?.id, 'r-hotel', 'hotel: a regra do tipo vence a geral');
const doCliente = normalizarRegra({ id: 'r-cli', pagante: { id: 'cli-1', nome: 'Prefeitura' }, destinos: { PAGANTE: { ligado: true, receitas: ['RAV'] } } }).regra;
eq(regraDoProduto([...regras, doCliente], v, v.produtos[1])?.id, 'r-cli', 'a regra do pagante vence a do tipo de produto');
eq(regraDoProduto([{ ...doHotel, ativa: false }, geral], v, v.produtos[1])?.id, 'r-geral', 'regra desligada não vale');
eq(valorDoDestino(v.produtos[0], geral.destinos.PAGANTE).valor, 6500, 'ao pagante: Taxa DU + RAV − Desconto = 65,00');
eq(valorDoDestino(v.produtos[0], geral.destinos.FORNECEDOR).valor, 7000, 'ao fornecedor: Comissão + Over = 70,00');
eq(valorDoDestino(v.produtos[1], geral.destinos.FORNECEDOR).valor, 19700, 'ao fornecedor (geral): Comissão − Taxa CC = 197,00');
eq(valorDoDestino(v.produtos[1], doHotel.destinos.REPRESENTANTE).valor, 20000, 'ao representante: Comissão = 200,00');
eq(valorDoDestino(v.produtos[0], { receitas: ['TARIFA', 'TAXAS'], descontos: [] }).valor, 110000, 'serviço próprio: tarifa + taxas');
eq(valorDoDestino(v.produtos[0], { receitas: ['RAV'], descontos: ['COMISSAO'] }).valor, 0, 'desconto maior que a receita: zero, nunca negativo');
eq(paganteDaVenda(venda({ extra: { pagamentos: [{ id: 'a', forma: 'BOLETO', valor_centavos: 100, pagante: { id: 'emp-9', nome: 'Empresa X' } }] } })).id, 'emp-9', 'pagante: a empresa que paga todos os pagamentos');

console.log('--- Normalização da regra ---');
eq(normalizarRegra({ destinos: {} }).erros.map(e => e.campo), ['destinos'], 'sem destino ligado: erro');
eq(normalizarRegra({ destinos: { PAGANTE: { ligado: true, receitas: [] } } }).erros.map(e => e.campo), ['destinos.PAGANTE'], 'destino ligado sem receita: erro');
eq(normalizarRegra({ destinos: { PAGANTE: { ligado: true, receitas: ['RAV'], descontos: ['RAV'] } } }).erros.map(e => e.campo), ['destinos.PAGANTE'], 'mesmo item soma e tira: erro');
eq(normalizarRegra({ destinos: { PAGANTE: { ligado: true, receitas: ['RAV'] } }, ibs_cbs: { aliquota_cbs: 140 } }).erros.map(e => e.campo), ['ibs_cbs.aliquota_cbs'], 'alíquota de CBS fora de 0–100: erro');
eq(normalizarRegra({ destinos: { PAGANTE: { ligado: true, receitas: ['RAV'] } }, ibs_cbs: { cst: '410', aliquota_ibs: '0,1' } }).regra.ibs_cbs, { cst: '410', classificacao_tributaria: '', indicador_operacao: '', aliquota_ibs: 0.1, aliquota_cbs: null }, 'IBS/CBS: só os campos informados, nada calculado');
eq(normalizarRegra({ tipo_produto: 'SEGURO', fornecedor: { id: 'f9', nome: 'Seguradora' }, destinos: { FORNECEDOR: { ligado: true, receitas: ['COMISSAO'] } } }).regra.descricao, 'Seguro viagem · Seguradora', 'descrição automática pelos filtros');
eq(combinacaoDaRegra(doHotel), 'HOSPEDAGEM|*|*|*', 'combinação dos seletores');

console.log('--- Gerar notas: grade e prévia ---');
let a = analisarVenda({ venda: v, regras, notas: [] });
eq(a.linhas.map(l => [l.produto_id, l.receita, l.valor_notas, l.saldo, l.a_emitir, l.situacao]), [
  ['p-aereo', 13500, 0, 13500, 13500, 'A_EMITIR'],
  ['p-hotel', 34700, 0, 34700, 35000, 'A_EMITIR'],
], 'grade: Receitas × Valor das notas × Saldo por produto');
eq(a.previstas.map(p => [p.destino, p.tomador?.id, p.valor_centavos, p.itens.map(i => i.produto_id), p.complementar]), [
  ['PAGANTE', 'cli-1', 6500, ['p-aereo'], false],
  ['FORNECEDOR', 'f-cia', 7000, ['p-aereo'], false],
  ['PAGANTE', 'cli-1', 15000, ['p-hotel'], false],
  ['REPRESENTANTE', 'r-cons', 20000, ['p-hotel'], false],
], 'as 3 notas: ao pagante (por gatilho), ao fornecedor e ao representante');
eq(a.previstas[0].chave, 'v1|PAGANTE|cli-1|1', 'chave da geração: venda|destino|tomador|nº');
eq(a.previstas[2].chave, 'v1|PAGANTE|cli-1|2', 'outro gatilho para o mesmo tomador: número seguinte');
eq(a.previstas[0].informacoes, 'Todas as vendas · ao pagante: GRU-REC: Taxa DU R$ 40,00 + RAV R$ 30,00 − Desconto R$ 5,00 = R$ 65,00', 'Informações: a fórmula com números');
eq(a.previstas[1].discriminacao, 'Comissão de intermediação na venda de GRU-REC ao cliente Prefeitura de Exemplo. Venda VND-0001.', 'discriminação padrão da nota ao fornecedor');
eq(a.cancelar, [], 'nada a cancelar');

console.log('--- Complementar ---');
const notaRegra = (id: string, destino: string, tomador: string, chave: string, itens: Array<[string, number]>, status = 'AUTORIZADA', emitida = '2026-11-02T10:00:00Z'): NotaExistente =>
  notaExistenteDe({ id, status, numero: id.toUpperCase(), emitida_em: emitida, valor_servicos: itens.reduce((s, x) => s + x[1], 0) / 100, origem: 'REGRA', destino, tomador_chave: tomador, chave_geracao: chave, itens: itens.map(([produto_id, valor_centavos]) => ({ produto_id, valor_centavos })) });
const emitidas = [notaRegra('n1', 'PAGANTE', 'cli-1', 'v1|PAGANTE|cli-1|1', [['p-aereo', 6500]])];
const maisRav = venda();
maisRav.produtos[0].componentes.push({ id: 'c-extra', tipo: 'RAV', valor_centavos: 2000, percentual: null, passageiro_id: null, descricao: '' });
a = analisarVenda({ venda: maisRav, regras, notas: emitidas });
const comp = a.previstas.find(p => p.destino === 'PAGANTE' && p.itens[0].produto_id === 'p-aereo')!;
eq([comp.valor_centavos, comp.complementar, comp.complementar_de, comp.chave, comp.ja_emitido_centavos], [2000, true, ['n1'], 'v1|PAGANTE|cli-1|2', 6500], 'receita cresceu: complementar de 20,00 sugerida, com a nota anterior');
eq(comp.discriminacao.startsWith('Nota complementar.'), true, 'a nota complementar diz que é complementar');
eq(a.linhas[0].situacao, 'COMPLEMENTAR', 'grade: complementar sugerida');
const canceladaN1 = [notaRegra('n1', 'PAGANTE', 'cli-1', 'v1|PAGANTE|cli-1|1', [['p-aereo', 6500]], 'CANCELADA')];
a = analisarVenda({ venda: v, regras, notas: canceladaN1 });
eq([a.previstas[0].valor_centavos, a.previstas[0].complementar, a.previstas[0].chave], [6500, false, 'v1|PAGANTE|cli-1|2'], 'nota cancelada não conta, mas o número não se repete');

console.log('--- Nota de antes (por conta) ---');
const antiga = notaExistenteDe({ id: 'old', status: 'AUTORIZADA', valor_servicos: 100, emitida_em: '2026-10-01' }, 'VENDA');
a = analisarVenda({ venda: v, regras, notas: [antiga] });
eq(a.previstas.filter(p => p.destino === 'PAGANTE').map(p => [p.itens[0].produto_id, p.valor_centavos, p.complementar]), [['p-hotel', 11500, true]], 'nota por conta de 100,00 cobre o pagante do aéreo (65,00) e 35,00 do hotel: só o resto sai');
eq(a.linhas.map(l => l.valor_notas), [6500, 3500], 'grade mostra a nota de antes no valor das notas');
eq(a.cancelar, [], 'nota de antes dentro da receita: nada a cancelar');
const comissaoAntiga = notaExistenteDe({ id: 'oldc', status: 'AUTORIZADA', valor_servicos: 70, emitida_em: '2026-10-01' }, 'COMISSAO_FORNECEDOR');
a = analisarVenda({ venda: v, regras, notas: [comissaoAntiga] });
eq(a.previstas.some(p => p.destino === 'FORNECEDOR'), false, 'nota de antes para a operadora: a nota ao fornecedor não se repete');

console.log('--- Cancelamento sugerido ---');
const comNotas = [
  notaRegra('n1', 'PAGANTE', 'cli-1', 'v1|PAGANTE|cli-1|1', [['p-aereo', 6500]]),
  notaRegra('n2', 'REPRESENTANTE', 'r-cons', 'v1|REPRESENTANTE|r-cons|1', [['p-hotel', 20000]], 'AUTORIZADA', '2026-11-03T10:00:00Z'),
];
const hotelCancelado = venda();
hotelCancelado.produtos[1].cancelado_em = '2026-11-04';
a = analisarVenda({ venda: hotelCancelado, regras, notas: comNotas });
eq(a.cancelar.map(c => [c.nota_id, c.valor_centavos, /cancelado/.test(c.motivo)]), [['n2', 20000, true]], 'produto cancelado: sugere cancelar a nota dele (não cancela sozinho)');
eq(a.linhas[1].situacao, 'CANCELADA', 'grade: produto cancelado com nota');
a = analisarVenda({ venda: v, regras, notas: comNotas, venda_cancelada: true });
eq([a.cancelar.map(c => c.nota_id), a.previstas.length], [['n2', 'n1'], 0], 'venda cancelada: todas as notas, a mais nova primeiro; nada a emitir');
const menosRav = venda();
menosRav.produtos[0].componentes = menosRav.produtos[0].componentes.filter(c => c.tipo !== 'RAV');
a = analisarVenda({ venda: menosRav, regras, notas: comNotas });
eq([a.cancelar.map(c => c.nota_id), a.linhas[0].situacao], [['n1'], 'ACIMA'], 'receita caiu abaixo da nota: cancelamento sugerido');

console.log('--- Gatilhos ---');
const est = { cliente_quitado: true, fatura_fechada: false, comissao_acertada: ['f-cia'] };
eq(gatilhoCumprido('MANUAL', est, v.produtos[0]), false, 'manual nunca dispara');
eq(gatilhoCumprido('AO_RECEBER', est, v.produtos[0]), true, 'ao receber: cliente quitado');
eq(gatilhoCumprido('AO_RECEBER', { ...est, cliente_quitado: false }, v.produtos[0]), false, 'ao receber: cliente ainda devendo');
eq(gatilhoCumprido('AO_FECHAR_FATURA', { ...est, fatura_fechada: true }, v.produtos[0]), true, 'ao fechar a fatura');
eq(gatilhoCumprido('AO_RECEBER_COMISSAO', est, v.produtos[0]), true, 'comissão da cia recebida');
eq(gatilhoCumprido('AO_RECEBER_COMISSAO', est, v.produtos[1]), false, 'hotel acerta com a consolidadora: ainda não recebida');
a = analisarVenda({ venda: v, regras, notas: [], estado: est });
eq(a.previstas.map(p => [p.destino, p.gatilho, p.gatilho_cumprido]), [
  ['PAGANTE', 'MANUAL', false], ['FORNECEDOR', 'MANUAL', false], ['PAGANTE', 'AO_RECEBER', true], ['REPRESENTANTE', 'AO_RECEBER_COMISSAO', false],
], 'cada nota prevista sabe se o gatilho dela aconteceu');

console.log('--- Retenções na fonte (Lei 9.430) ---');
const ret = (o: Record<string, unknown>): RetencaoDoCliente => {
  const r = normalizarRetencao(o);
  if (r.erros.length) throw new Error(JSON.stringify(r.erros));
  return r.retencao;
};
const rAereo = ret({ id: 'rt1', cliente: { id: 'cli-1', nome: 'Prefeitura' }, tipo_produto: 'AEREO', nacional: { VALOR: { IR: 1.2 }, DU_RAV: { IR: 1.5, CSLL: 1 } }, internacional: { VALOR: { IR: 0.5 } } });
const rTodos = ret({ id: 'rt2', cliente: { id: 'cli-1', nome: 'Prefeitura' }, reter_iss: true, nacional: { TAXA_SERVICO: { PIS: 0.65, COFINS: 3 } } });
eq(normalizarRetencao({ cliente: { id: 'c' }, nacional: { VALOR: { IR: -1 } } }).erros.length, 1, 'percentual negativo: erro');
eq(normalizarRetencao({ cliente: { id: 'c' }, nacional: { VALOR: { IR: 101 } } }).erros.length, 1, 'acima de 100%: erro');
eq(normalizarRetencao({ nacional: {} }).erros.map(e => e.campo), ['cliente'], 'sem cliente: erro');
eq([retencaoAplicavel([rAereo, rTodos], 'cli-1', 'AEREO')?.id, retencaoAplicavel([rAereo, rTodos], 'cli-1', 'HOSPEDAGEM')?.id, retencaoAplicavel([rAereo], 'cli-2', 'AEREO')], ['rt1', 'rt2', null], 'cliente × produto: a do produto vence a de todos; outro cliente não');
eq(basesDoProduto(v.produtos[0]), { VALOR: 99500, TAXA_SERVICO: 0, DU_RAV: 7000, EMBARQUE: 10000 }, 'bases: valor (tarifa + markup − desconto), taxa de serviço, DU/RAV, embarque');
eq([ambitoDoProduto({ moeda: 'BRL', detalhes: {} }), ambitoDoProduto({ moeda: 'USD', detalhes: {} }), ambitoDoProduto({ moeda: 'BRL', detalhes: { ambito: 'Internacional' } })], ['NACIONAL', 'INTERNACIONAL', 'INTERNACIONAL'], 'nacional ou internacional');
let rv = retencoesDaVenda(v, [rAereo, rTodos]);
eq([rv.por_tributo, rv.total, rv.reter_iss], [{ IR: 1194 + 105, CSLL: 70, PIS: 33, COFINS: 150 }, 1194 + 105 + 70 + 33 + 150, true], 'retenção da venda: cada tributo sobre cada base, nacional');
const internacional = venda();
internacional.produtos[0].detalhes = { ambito: 'internacional' };
rv = retencoesDaVenda(internacional, [rAereo]);
eq([rv.por_tributo.IR, rv.total], [498, 498], 'internacional usa os percentuais internacionais');
a = analisarVenda({ venda: v, regras, notas: [], retencoes: [rAereo, rTodos] });
eq(a.previstas.filter(p => p.destino === 'PAGANTE').map(p => [p.itens[0].produto_id, p.retencoes?.por_tributo, p.retencoes?.reter_iss]), [
  ['p-aereo', { IR: 105, CSLL: 70, PIS: 0, COFINS: 0 }, false],
  ['p-hotel', { IR: 0, CSLL: 0, PIS: 33, COFINS: 150 }, true],
], 'na nota ao pagante: só a retenção das bases que a nota cobra (DU/RAV; Fee)');
eq(a.previstas.filter(p => p.destino !== 'PAGANTE').every(p => p.retencoes === null), true, 'nota ao fornecedor e ao representante: sem retenção do cliente');
const contas = [
  { id: 'a', origem: 'VENDA', cliente_id: 'cli-1', valor_original: 1000, valor_final: 1000 },
  { id: 'b', origem: 'VENDA', cliente_id: 'cli-1', valor_original: 500, valor_final: 500 },
  { id: 'c', origem: 'COMISSAO_FORNECEDOR', cliente_id: 'f-cia', valor_original: 70, valor_final: 70 },
];
const liq = aplicarRetencoesNasContas(contas, { cliente_id: 'cli-1', por_tributo: { IR: 1299, CSLL: 70, PIS: 0, COFINS: 0 }, total: 1369 });
eq(liq.contas.map(c => [c.id, c.valor_final, (c as Record<string, unknown>).retencao_na_fonte ? ((c as Record<string, unknown>).retencao_na_fonte as Record<string, number>).total : null]), [['a', 990.87, 9.13], ['b', 495.44, 4.56], ['c', 70, null]], 'conta a receber líquida: a retenção sai das contas do cliente, na proporção');
const r1 = (liq.contas[0] as Record<string, unknown>).retencao_na_fonte as Record<string, number>;
const r2 = (liq.contas[1] as Record<string, unknown>).retencao_na_fonte as Record<string, number>;
eq([Math.round((r1.IR + r2.IR) * 100), Math.round((r1.CSLL + r2.CSLL) * 100), r1.valor_bruto, r1.lei], [1299, 70, 1000, '9.430'], 'cada tributo fecha no centavo; a conta guarda o bruto');
eq(aplicarRetencoesNasContas(contas, { cliente_id: 'cli-1', por_tributo: { IR: 0, CSLL: 0, PIS: 0, COFINS: 0 }, total: 0 }).contas === contas, true, 'sem retenção: as mesmas contas, sem cópia');
eq(aplicarRetencoesNasContas([contas[0]], { cliente_id: 'cli-1', por_tributo: { IR: 200000, CSLL: 0, PIS: 0, COFINS: 0 }, total: 200000 }).contas[0].valor_final, 0, 'retenção maior que o a receber: zera, nunca negativo');
eq(linhasDeRetencaoNaFatura(150000, { por_tributo: { IR: 1299, CSLL: 70, PIS: 0, COFINS: 0 }, total: 1369 }).map(l => [l.rotulo, l.valor_centavos]), [
  ['Valor bruto', 150000], ['IR retido na fonte (Lei 9.430)', 1299], ['CSLL retido na fonte (Lei 9.430)', 70], ['Valor líquido a pagar', 148631],
], 'na fatura: bruto, cada retenção e o líquido');

console.log('--- Assinatura da prévia ---');
const s1 = assinaturaDaPrevia([{ chave: 'a', valor_centavos: 100 }, { chave: 'b', valor_centavos: 200 }]);
eq(s1 === assinaturaDaPrevia([{ chave: 'b', valor_centavos: 200 }, { chave: 'a', valor_centavos: 100 }]), true, 'a ordem não muda a assinatura');
eq(s1 === assinaturaDaPrevia([{ chave: 'a', valor_centavos: 101 }, { chave: 'b', valor_centavos: 200 }]), false, 'um centavo muda a assinatura');
eq(formatarReais(123456), 'R$ 1.234,56', 'formato de reais');

console.log('--- Nota para a operadora: a base (defeito corrigido) ---');
const entrada = { regime: 'INTERMEDIACAO' as const, forma_base: 'VALOR_COMISSAO' as const, valor_recebido: 1500, valor_total_venda: 10000, custo_fornecedores: 8000, aliquota_iss: 2, iss_retido: false };
const antes = calcularNota(entrada);
eq([antes.valor_servicos, antes.base_calculo, antes.valor_iss], [300, 300, 6], 'ANTES: a comissão de 1.500 saía com a margem da venda do cliente (base 300)');
const depois = calcularNota({ ...entrada, receita_integral: true });
eq([depois.valor_servicos, depois.base_calculo, depois.valor_iss, depois.repasse_da_parcela, depois.erros], [1500, 1500, 30, 0, []], 'DEPOIS: a comissão inteira é a base (1.500, ISS 30)');
eq(calcularNota({ ...entrada, valor_recebido: 2000, receita_integral: false }).valor_servicos, 400, 'nota do cliente não muda: margem da venda');

console.log(`\n${total - falhas}/${total} testes passaram`);
if (falhas) process.exit(1);
