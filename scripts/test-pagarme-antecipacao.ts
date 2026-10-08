/**
 * Pagar.me: uma venda, um lançamento (08/10/2026).
 *
 * O caso real: Bruna Moura pagou R$ 3.860,00 em 12x no cartão por um link
 * de pagamento. O financeiro mostrou 24 contas de R$ 321,67 (12 do aviso do
 * pedido, 12 do aviso da cobrança, essas com o nome do link "pl_...") mais a
 * conta da venda do CRM, solta. A agência antecipa tudo no Pagar.me.
 *
 * O que estes testes travam:
 *   1) pedido e cobrança são a MESMA venda (mesmo id, ids em comum);
 *   2) o aviso de cobrança não troca a descrição pelo código do link;
 *   3) as 12 parcelas viram uma, sem perder centavo, na data do repasse;
 *   4) a correção nunca junta o que caiu no banco em datas diferentes;
 *   5) a conciliação reconhece o link (pl_) como prova.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-pagarme-antecipacao.ts
 */
import { adapterPagarme, idDoPedido, idsDaVenda, valorDaParcela } from '../src/lib/plataformas/pagarme.ts';
import {
  descreverFormaDePagamento, descreverParcelamento, parcelaUnicaAntecipada, planoDeParcelaUnica, statusDaVenda,
} from '../src/lib/plataformas/antecipacao.ts';
import { montarParcelas } from '../src/lib/plataformas/comum.ts';
import { pontuar } from '../src/lib/plataformas/conciliacao.ts';
import { antecipadoPorPadrao } from '../src/lib/plataformas/servico.ts';
import { somaPor } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const cliente = { name: 'Bruna Moura', email: 'bruna@exemplo.com', document: '123.456.789-09' };
const cobranca = {
  id: 'ch_9xYz', code: 'pl_P2lyM6OdJDp1VQEhJ6UlVL4Njb3G9x7q', amount: 386000, status: 'paid',
  payment_method: 'credit_card', paid_at: '2026-10-08T15:05:24Z', created_at: '2026-10-08T15:05:20Z',
  last_transaction: { installments: 12, transaction_type: 'credit_card', card: { brand: 'visa', last_four_digits: '4242', first_six_digits: '411111' } },
  customer: cliente,
};
const pedido = {
  id: 'or_w7Pb2ym4inHQ2LVR', code: 'pl_P2lyM6OdJDp1VQEhJ6UlVL4Njb3G9x7q', amount: 386000, currency: 'BRL', status: 'paid',
  created_at: '2026-10-08T15:05:20Z', customer: cliente,
  items: [{ id: 'oi_1', description: 'Formação Agente Independente', quantity: 1, amount: 386000 }],
  charges: [cobranca],
};
const avisoPedido = { id: 'hook_1', type: 'order.paid', data: pedido };
const avisoCobranca = { id: 'hook_2', type: 'charge.paid', data: { ...cobranca, order: { id: pedido.id, code: pedido.code, amount: 386000 } } };
const semChave = { api_key: '', segredo_webhook: '', extras: {} };

console.log('--- pedido e cobrança são a mesma venda ---');
const ePedido = await adapterPagarme.normalizar(avisoPedido, semChave);
const eCobranca = await adapterPagarme.normalizar(avisoCobranca, semChave);
eq(ePedido.transacao.id_transacao, 'or_w7Pb2ym4inHQ2LVR', 'aviso do pedido: id é o pedido');
eq(eCobranca.transacao.id_transacao, 'or_w7Pb2ym4inHQ2LVR', 'aviso da cobrança: id TAMBÉM é o pedido (antes era ch_)');
eq(idDoPedido('charge.paid', { id: 'ch_1' }), 'ch_1', 'cobrança sem pedido no corpo: fica com o próprio id');
for (const id of ['or_w7Pb2ym4inHQ2LVR', 'ch_9xYz', 'pl_P2lyM6OdJDp1VQEhJ6UlVL4Njb3G9x7q']) {
  eq([ePedido.transacao.ids_alternativos?.includes(id), eCobranca.transacao.ids_alternativos?.includes(id)], [true, true], `os dois avisos conhecem ${id.slice(0, 3)}`);
}
eq(idsDaVenda({ id: 'a', code: 'a' }, [{ id: '' }]), ['a'], 'ids sem repetição e sem vazio');

console.log('--- a descrição é a do pedido ---');
eq(ePedido.transacao.descricao, 'Formação Agente Independente', 'pedido traz o item');
eq(eCobranca.transacao.descricao, '', 'cobrança não inventa descrição (antes virava "pl_P2ly...")');
eq(eCobranca.transacao.itens, [], 'cobrança sem itens: o serviço mantém os do pedido');

console.log('--- como o comprador pagou ---');
eq([ePedido.transacao.parcelas_do_comprador, ePedido.transacao.valor_parcela_do_comprador], [12, 321.67], '12x de R$ 321,67');
eq([ePedido.transacao.forma_pagamento, ePedido.transacao.detalhe_pagamento, ePedido.transacao.final_do_cartao], ['credit_card', 'visa', '4242'], 'cartão, bandeira e final');
eq(ePedido.transacao.parcelas.length, 12, 'o adaptador ainda descreve as 12 parcelas (quem junta é o serviço)');
eq(valorDaParcela(montarParcelas({ total: 100, quantidade: 3, status: 'PENDENTE', primeiroVencimento: '2026-10-08', idBase: 'x' })), 33.33, 'valor que mais se repete');

console.log('--- as 12 parcelas viram uma ---');
const doze = ePedido.transacao.parcelas.map(p => ({ ...p, valor_taxa: 10, valor_liquido: p.valor_bruto - 10, data_prevista_recebimento: '2026-10-10', antecipada: true }));
const unica = parcelaUnicaAntecipada(doze)!;
eq([unica.numero, unica.total], [1, 1], 'uma parcela, de um');
eq(unica.valor_bruto, 3860, 'bruto: R$ 3.860,00, sem perder centavo');
eq(unica.valor_bruto, somaPor(doze, p => p.valor_bruto), 'igual à soma das 12');
eq([unica.valor_taxa, unica.valor_liquido], [120, 3740], 'taxa e líquido somados');
eq([unica.data_vencimento, unica.data_prevista_recebimento], ['2026-10-10', '2026-10-10'], 'vence na data do repasse antecipado');
eq(unica.data_pagamento, '2026-10-08', 'pagamento: o dia em que o cliente pagou');
eq([unica.status, unica.antecipada], ['CONFIRMADO', true], 'pago e ainda não caiu: confirmado');
const semExtrato = parcelaUnicaAntecipada(ePedido.transacao.parcelas)!;
eq(semExtrato.data_vencimento, '2026-10-08', 'sem o extrato de recebíveis: a data do pagamento, não 12 meses');
eq(parcelaUnicaAntecipada([]), null, 'nada para juntar');

console.log('--- status da venda inteira ---');
eq(statusDaVenda(doze.map(p => ({ ...p, status: 'RECEBIDO' as const }))), 'RECEBIDO', 'todas caíram: recebida');
eq(statusDaVenda([{ ...doze[0], status: 'RECEBIDO' }, { ...doze[1], status: 'CONFIRMADO' }]), 'CONFIRMADO', 'parte caiu: ainda não recebida inteira');
eq(statusDaVenda([{ ...doze[0], status: 'CONFIRMADO' }, { ...doze[1], status: 'CHARGEBACK' }]), 'CHARGEBACK', 'o pior estado manda');

console.log('--- o plano de correção ---');
const contas = Array.from({ length: 12 }, (_, i) => ({ id: `plat-pagarme-or_X-${i + 1}`, numero: i + 1, status: 'PENDENTE', valor_recebido: 0, tocada_por_humano: null }));
const plano = planoDeParcelaUnica(doze, contas, {});
eq([plano.em_dia, plano.pulada, plano.conta_principal, plano.cancelar.length], [false, null, 'plat-pagarme-or_X-1', 11], 'fica a conta da parcela 1, as outras 11 são canceladas');
eq(planoDeParcelaUnica([unica], [contas[0]], {}).em_dia, true, 'já num lançamento só: nada a fazer');
const tocada = contas.map((c, i) => (i === 4 ? { ...c, tocada_por_humano: 'conciliada com o extrato' } : c));
eq(planoDeParcelaUnica(doze, tocada, {}).pulada, 'plat-pagarme-or_X-5: conciliada com o extrato', 'conta tocada por uma pessoa: pula e diz qual');
const meioRecebida = doze.map((p, i) => ({ ...p, status: (i < 3 ? 'RECEBIDO' : 'CONFIRMADO') as 'RECEBIDO' | 'CONFIRMADO' }));
eq(planoDeParcelaUnica(meioRecebida, contas, { 1: 311.67, 2: 311.67, 3: 311.67 }).pulada, '3 de 12 parcelas já caíram no banco em datas diferentes', 'parte já caiu no banco: não junta (mexeria no caixa)');
eq(planoDeParcelaUnica(doze, contas, { 1: 100, 2: 50 }).creditado, 150, 'o que as parcelas já creditaram passa para a conta única');

console.log('--- o detalhe do lançamento ---');
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
eq(descreverParcelamento(12, 321.67, brl), '12x de R$ 321,67', 'parcelado');
eq(descreverParcelamento(1, 3860, brl), 'à vista', 'à vista');
eq(descreverParcelamento(undefined, undefined, brl), 'à vista', 'sem informação: à vista');
eq(descreverFormaDePagamento('credit_card', 'visa', '4242'), 'Cartão de crédito Visa •••• 4242', 'cartão com bandeira e final');
eq(descreverFormaDePagamento('pix', 'visa', '4242'), 'Pix', 'Pix não mostra cartão');
eq(descreverFormaDePagamento('', '', ''), 'Não informada', 'sem forma');

console.log('--- o link do CRM é prova ---');
const pag = { id_transacao: 'or_w7Pb2ym4inHQ2LVR', ids: ePedido.transacao.ids_alternativos, documento: '', email: '', telefone: '', valor: 3860, data: '2026-10-08' };
const venda = { venda_id: 'v6', cliente_nome: 'Nutricionista Bruna Moura', documento: '', email: '', telefone: '', valor_total: 3860, data_venda: '2026-10-08', id_transacao_externa: 'pl_P2lyM6OdJDp1VQEhJ6UlVL4Njb3G9x7q', ja_conciliada: false };
const p1 = pontuar(pag, venda);
eq([p1.prova_transacao, p1.confianca], [true, 'ALTA'], 'venda com o link (pl_) casa com o pedido (or_)');
eq(pontuar({ ...pag, ids: [] }, venda).prova_transacao, false, 'sem os ids alternativos, o link não casaria (o defeito)');

console.log('--- antecipação por padrão ---');
eq([antecipadoPorPadrao('pagarme', undefined), antecipadoPorPadrao('asaas', undefined), antecipadoPorPadrao('pagarme', false), antecipadoPorPadrao('hotmart', true)], [true, false, false, true], 'Pagar.me antecipa por padrão; escolha gravada manda');

console.log(`\n${total - falhas}/${total} testes do Pagar.me antecipado passaram`);
if (falhas > 0) process.exit(1);
