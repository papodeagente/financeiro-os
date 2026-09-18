/**
 * Adapters de plataforma (src/lib/plataformas/*).
 *
 * Cada teste aqui corresponde a uma armadilha já medida em produção nas
 * integrações do CRM e do Membros. Normalização errada aqui vira receita
 * errada no DRE, então o valor, a moeda e a idempotência são o alvo.
 *
 * Nenhum teste toca a rede: as credenciais de teste vão sem `api_key`, e
 * é ela que liga a consulta extra em cada adapter.
 */
import { adapterAsaas, baseDaChave, tipoPorStatus } from '../src/lib/plataformas/asaas.ts';
import { adapterHotmart } from '../src/lib/plataformas/hotmart.ts';
import { adapterPagarme, aplicarRecebiveis, lerRecebiveis } from '../src/lib/plataformas/pagarme.ts';
import { iguaisEmTempoConstante, deCentavos, montarParcelas, somaBruto } from '../src/lib/plataformas/comum.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const cred = (extra = {}) => ({ api_key: '', segredo_webhook: 'tok-secreto', extras: {}, ...extra });

console.log('--- Asaas: ambiente sai do prefixo da chave ---');
eq(baseDaChave('$aact_prod_abc'), 'https://api.asaas.com/v3', 'chave de produção');
eq(baseDaChave('$aact_hmlg_abc'), 'https://api-sandbox.asaas.com/v3', 'chave de sandbox');
eq(baseDaChave(''), 'https://api.asaas.com/v3', 'sem chave, assume produção em vez de sandbox');

console.log('\n--- Asaas: token do webhook ---');
{
  const v = await adapterAsaas.verificar('{}', { 'asaas-access-token': 'tok-secreto' }, cred());
  eq(v.valido, true, 'token correto passa');
}
{
  const v = await adapterAsaas.verificar('{}', { 'asaas-access-token': 'errado' }, cred());
  eq([v.valido, v.motivo.includes('não confere')], [false, true], 'token errado é recusado com motivo');
}
{
  const v = await adapterAsaas.verificar('{}', {}, cred({ segredo_webhook: '' }));
  eq(v.valido, false, 'sem token configurado, recusa em vez de aceitar tudo');
}

console.log('\n--- Asaas: confirmado NÃO é recebido ---');
{
  const e = await adapterAsaas.normalizar(
    { id: 'e1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', value: 1000, netValue: 950, billingType: 'CREDIT_CARD', dueDate: '2026-09-20', paymentDate: '2026-09-15', estimatedCreditDate: '2026-10-15' } },
    cred(),
  );
  const p = e.transacao.parcelas[0];
  eq(e.tipo, 'PAGAMENTO_CONFIRMADO', 'confirmado é pago pelo comprador');
  eq(p.status, 'CONFIRMADO', 'mas a parcela NÃO entra como recebida');
  eq([p.data_pagamento, p.data_recebimento], ['2026-09-15', ''],
     'pagou sim, caiu na conta ainda não: é isso que impede antecipar caixa em 30 dias');
  eq(p.data_prevista_recebimento, '2026-10-15', 'a previsão de crédito vem junto');
  eq([p.valor_bruto, p.valor_taxa, p.valor_liquido], [1000, 50, 950], 'taxa é a diferença até o líquido');
}
{
  const e = await adapterAsaas.normalizar(
    { id: 'e2', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 1000, netValue: 950, creditDate: '2026-10-15', paymentDate: '2026-09-15' } },
    cred(),
  );
  const p = e.transacao.parcelas[0];
  eq([e.tipo, p.status], ['PAGAMENTO_RECEBIDO', 'RECEBIDO'], 'recebido é o dinheiro na conta');
  eq(p.data_recebimento, '2026-10-15', 'e a data do crédito é a que vale para o caixa');
}
{
  // O anual do Asaas são 12 cobranças com o MESMO installment. Sem
  // agrupar por ele, um contrato vira 12 vendas de "Parcela N de 12".
  const e = await adapterAsaas.normalizar(
    { id: 'e3', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_3', installment: 'ins_99', installmentNumber: 3, installmentCount: 12, value: 100, netValue: 95 } },
    cred(),
  );
  eq(e.transacao.id_transacao, 'ins_99', 'o contrato é o installment, não a cobrança do mês');
  eq([e.transacao.parcelas[0].numero, e.transacao.parcelas[0].total], [3, 12], 'e a cobrança é a parcela 3 de 12');
  eq(e.transacao.parcelas[0].id_externo, 'pay_3', 'a cobrança do mês continua identificada');
}
{
  const e = await adapterAsaas.normalizar(
    { id: 'e4', event: 'PAYMENT_CREATED', payment: { id: 'pay_9', value: 500, dueDate: '2026-10-01' } }, cred());
  eq([e.tipo, e.transacao.parcelas[0].status], ['PAGAMENTO_CRIADO', 'PENDENTE'],
     'cobrança criada nasce como conta a receber pendente, e não como nada');
  eq(e.transacao.parcelas[0].data_vencimento, '2026-10-01', 'com a data de vencimento da plataforma');
}
{
  // Evento válido e irrelevante não pode virar erro: o Asaas PAUSA a fila.
  const e = await adapterAsaas.normalizar(
    { id: 'e5', event: 'PAYMENT_AWAITING_RISK_ANALYSIS', payment: { id: 'pay_x', value: 500 } }, cred());
  eq(e.tipo, 'IGNORADO', 'evento irrelevante vira IGNORADO, e o webhook responde 200');
}
{
  const e = await adapterAsaas.normalizar(
    { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_7', value: 100 } }, cred());
  eq(e.id_externo, 'pay_7:PAYMENT_CONFIRMED',
     'sem id de evento, a chave junta cobrança e evento: a mesma cobrança manda CONFIRMED e depois RECEIVED');
}
{
  const e = await adapterAsaas.normalizar(
    { id: 'e6', event: 'PAYMENT_CONFIRMED', payment: { id: 'p', value: 800 } }, cred());
  eq([e.transacao.valor_taxa, e.transacao.valor_liquido], [0, 800],
     'sem netValue, não inventa taxa: líquido igual ao bruto');
}
{
  // Evento que não diz o que houve é lido pelo status da cobrança.
  eq(tipoPorStatus('RECEIVED'), 'PAGAMENTO_RECEBIDO', 'status RECEIVED');
  eq(tipoPorStatus('OVERDUE'), 'PAGAMENTO_ATRASADO', 'status OVERDUE');
  eq(tipoPorStatus('CHARGEBACK_REQUESTED'), 'CHARGEBACK', 'status de chargeback');
  const e = await adapterAsaas.normalizar(
    { id: 'e7', event: 'PAYMENT_UPDATED', payment: { id: 'pay_u', value: 100, status: 'OVERDUE' } }, cred());
  eq(e.tipo, 'PAGAMENTO_ATRASADO', 'PAYMENT_UPDATED usa o status da cobrança');
}
{
  const e = await adapterAsaas.normalizar(
    { id: 'e8', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1', value: 1000 } }, cred());
  eq([e.tipo, e.transacao.parcelas[0].status], ['REEMBOLSO', 'ESTORNADO'], 'estorno é reconhecido');
}
{
  // originalValue maior que value é desconto. Sinal trocado aqui vira
  // juros e inverte receita no DRE.
  const e = await adapterAsaas.normalizar(
    { id: 'e9', event: 'PAYMENT_RECEIVED', payment: { id: 'p', value: 900, originalValue: 1000, interestValue: 0 } }, cred());
  eq([e.transacao.parcelas[0].desconto, e.transacao.parcelas[0].juros], [100, 0], 'desconto de 100, juros nenhum');
}

console.log('\n--- Hotmart: hottok, garantia e moeda estrangeira ---');
{
  const v = await adapterHotmart.verificar('{}', { 'x-hotmart-hottok': 'tok-secreto' }, cred());
  eq(v.valido, true, 'hottok no header oficial');
  const v2 = await adapterHotmart.verificar('{}', { hottok: 'tok-secreto' }, cred());
  eq(v2.valido, true, 'e no header curto que a Hotmart também manda');
}
{
  const e = await adapterHotmart.normalizar({
    event: 'PURCHASE_APPROVED',
    data: {
      product: { id: '7343064', name: 'EnturOS CRM' },
      buyer: { name: 'Ana', email: 'ana@x.com', document: '123.456.789-00' },
      purchase: { transaction: 'HP123', approved_date: 1789000000000, price: { value: 497, currency_value: 'BRL' }, commission_fee: 40.75, payment: { type: 'CREDIT_CARD', installments_number: 12 } },
    },
  }, cred());
  const t = e.transacao;
  eq([e.tipo, t.valor_bruto, t.valor_taxa, t.moeda], ['PAGAMENTO_CONFIRMADO', 497, 40.75, 'BRL'], 'venda em real');
  eq(t.parcelas.length, 12, '12 parcelas, uma conta a receber cada');
  eq(somaBruto(t.parcelas), 497, 'e a soma das parcelas fecha exatamente com o bruto');
  eq(t.comprador.documento, '12345678900', 'documento vem só com dígitos');
  eq(t.parcelas[0].data_pagamento, '2026-09-10', 'epoch em ms vira data civil');
  eq(t.parcelas.every(p => p.status === 'CONFIRMADO'), true,
     'aprovado é confirmado, não recebido: o dinheiro ainda passa pela garantia');
  eq(t.parcelas.every(p => p.data_recebimento === ''), true, 'nenhuma parcela nasce com data de recebimento');
}
{
  const e = await adapterHotmart.normalizar({
    event: 'PURCHASE_COMPLETE',
    data: { product: { id: '1' }, purchase: { transaction: 'HP5', approved_date: 1789000000000, price: { value: 100 } } },
  }, cred());
  eq([e.tipo, e.transacao.parcelas[0].status], ['PAGAMENTO_RECEBIDO', 'RECEBIDO'],
     'COMPLETE é o fim da garantia: aí sim o dinheiro está liberado');
}
{
  // Venda em dólar já foi somada como real em produção e inflou a receita.
  const e = await adapterHotmart.normalizar({
    event: 'PURCHASE_APPROVED',
    data: { product: { id: '1' }, purchase: { transaction: 'HP9', price: { value: 200, currency_value: 'USD' } } },
  }, cred());
  eq([e.transacao.moeda, e.transacao.valor_bruto], ['USD', 200],
     'moeda estrangeira é PRESERVADA, sem conversão implícita');
}
{
  // Reembolso reusa o id da transação: sem o status na chave, seria
  // confundido com reenvio da venda e descartado.
  const venda = await adapterHotmart.normalizar(
    { event: 'PURCHASE_APPROVED', data: { purchase: { transaction: 'HP1' } } }, cred());
  const estorno = await adapterHotmart.normalizar(
    { event: 'PURCHASE_REFUNDED', data: { purchase: { transaction: 'HP1' } } }, cred());
  eq(venda.id_externo !== estorno.id_externo, true, 'venda e estorno da MESMA transação têm chaves diferentes');
  eq([venda.transacao.id_transacao, estorno.transacao.id_transacao], ['HP1', 'HP1'],
     'mas o id da transação é o mesmo, para casar os dois');
  eq([estorno.tipo, estorno.transacao.parcelas[0].status], ['REEMBOLSO', 'ESTORNADO'], 'e o estorno é reconhecido');
}
{
  // A conta vende muito além do que interessa: filtro opcional por produto.
  const c = cred({ extras: { produto_id: '7343064' } });
  const dentro = await adapterHotmart.normalizar(
    { event: 'PURCHASE_APPROVED', data: { product: { id: '7343064' }, purchase: { transaction: 'A' } } }, c);
  const fora = await adapterHotmart.normalizar(
    { event: 'PURCHASE_APPROVED', data: { product: { id: '999' }, purchase: { transaction: 'B' } } }, c);
  eq([dentro.tipo, fora.tipo], ['PAGAMENTO_CONFIRMADO', 'IGNORADO'], 'filtro por produto separa o que entra');
}

console.log('\n--- Pagar.me: centavos ---');
eq(deCentavos(49700), 497, 'centavos viram reais');
eq(deCentavos(1), 0.01, 'um centavo');
eq(deCentavos(0), 0, 'zero');
{
  const e = await adapterPagarme.normalizar({
    id: 'hook_1', type: 'order.paid',
    data: {
      id: 'or_123', amount: 49700, currency: 'BRL', code: 'PED-1', created_at: '2026-09-15T10:00:00Z',
      customer: { name: 'Bia', email: 'bia@x.com', document: '98765432100', phones: { mobile_phone: { area_code: '11', number: '999998888' } } },
      items: [{ description: 'Pacote Cancún', quantity: 1, amount: 49700 }],
      charges: [{ id: 'ch_1', amount: 49700, payment_method: 'credit_card', paid_at: '2026-09-15T10:00:00Z', last_transaction: { installments: 6 } }],
    },
  }, cred());
  const t = e.transacao;
  eq([e.tipo, t.valor_bruto], ['PAGAMENTO_CONFIRMADO', 497], 'valor em centavos vira real, e não 49.700');
  eq(t.itens[0], { descricao: 'Pacote Cancún', quantidade: 1, valor_unitario: 497, id_externo: '' }, 'item também');
  eq([t.parcelas.length, t.forma_pagamento], [6, 'credit_card'], 'parcelas e forma');
  eq(somaBruto(t.parcelas), 497, 'a soma das 6 parcelas fecha com o bruto');
  eq(t.comprador.telefone, '11999998888', 'telefone junta DDD e número');
  eq(t.parcelas[0].data_pagamento, '2026-09-15', 'data do pagamento');
  eq([t.valor_taxa, t.valor_liquido], [0, 497],
     'sem secret key não há extrato de recebíveis: taxa zero declarada, nunca estimada');
}
{
  const e = await adapterPagarme.normalizar({ id: 'h2', type: 'charge.refunded', data: { id: 'ch_1', amount: 1000 } }, cred());
  eq(e.tipo, 'REEMBOLSO', 'estorno');
}
{
  const e = await adapterPagarme.normalizar({ id: 'h3', type: 'order.created', data: { id: 'or_9', amount: 1000 } }, cred());
  eq([e.tipo, e.transacao.parcelas[0].status], ['PAGAMENTO_CRIADO', 'PENDENTE'],
     'pedido criado ainda não é dinheiro, mas já é conta a receber');
}

console.log('\n--- Pagar.me: extrato de recebíveis (taxa e antecipação reais) ---');
{
  const extrato = lerRecebiveis({ data: [
    { installment: 1, amount: 10000, fee: 390, anticipation_fee: 0, payment_date: '2026-10-15', original_payment_date: '2026-10-15', status: 'waiting_funds', type: 'credit' },
    { installment: 2, amount: 10000, fee: 390, anticipation_fee: 210, payment_date: '2026-09-20', original_payment_date: '2026-11-15', status: 'paid', type: 'credit' },
    { installment: 1, amount: -10000, fee: 0, anticipation_fee: 0, payment_date: '2026-10-20', original_payment_date: '', status: 'paid', type: 'refund' },
  ] });
  eq(extrato.length, 3, 'lê os três recebíveis');
  eq([extrato[0].amount, extrato[0].fee], [100, 3.9], 'centavos viram reais também no extrato');

  const parcelas = montarParcelas({ total: 200, quantidade: 2, status: 'CONFIRMADO', primeiroVencimento: '2026-09-15' });
  const aplicadas = aplicarRecebiveis(parcelas, extrato);
  eq([aplicadas[0].valor_taxa, aplicadas[0].valor_liquido], [3.9, 96.1], 'taxa real da 1ª parcela');
  eq([aplicadas[0].status, aplicadas[0].data_prevista_recebimento], ['CONFIRMADO', '2026-10-15'],
     'waiting_funds continua a receber, com a data prometida');
  eq([aplicadas[1].status, aplicadas[1].data_recebimento], ['RECEBIDO', '2026-09-20'],
     'paid vira recebido, na data em que caiu');
  eq([aplicadas[1].valor_taxa, aplicadas[1].antecipada], [6, true],
     'a taxa de antecipação entra na taxa e a parcela fica marcada como antecipada');
  eq(aplicadas[0].valor_liquido !== 0, true,
     'o recebível de estorno NÃO é somado como crédito: ele zeraria a taxa da parcela original');
}

console.log('\n--- Pagar.me: Basic Auth ---');
{
  const c = cred({ segredo_webhook: 'entur:senha123' });
  const cabecalho = `Basic ${Buffer.from('entur:senha123').toString('base64')}`;
  eq((await adapterPagarme.verificar('{}', { authorization: cabecalho }, c)).valido, true, 'credencial correta passa');
  eq((await adapterPagarme.verificar('{}', { authorization: 'Basic errado' }, c)).valido, false, 'errada é recusada');
  eq((await adapterPagarme.verificar('{}', {}, c)).valido, false, 'ausente é recusada');
}
{
  const c = { api_key: '', segredo_webhook: '', extras: {} };
  const v = await adapterPagarme.verificar('{"type":"order.paid","data":{"id":"or_1"}}', {}, c);
  eq([v.valido, v.motivo.includes('não há como confirmar')], [false, true],
     'sem Basic Auth e sem secret key, recusa em vez de confiar');
}

console.log('\n--- comparação de segredo em tempo constante ---');
eq(iguaisEmTempoConstante('abc', 'abc'), true, 'iguais');
eq(iguaisEmTempoConstante('abc', 'abd'), false, 'diferentes no fim');
eq(iguaisEmTempoConstante('abc', 'ab'), false, 'tamanhos diferentes');
eq(iguaisEmTempoConstante('', ''), true, 'vazios');

console.log('\n--- contrato comum aos três ---');
for (const a of [adapterAsaas, adapterHotmart, adapterPagarme]) {
  eq(a.camposCredencial().length > 0, true, `${a.nome} declara campos de credencial`);
  eq(typeof a.nome === 'string' && a.nome.length > 0, true, `${a.nome} tem nome`);
  eq(a.capacidades.permiteImportacao === (typeof a.importar === 'function'), true,
     `${a.nome}: a capacidade declarada bate com o que o adapter implementa`);
}

console.log(`\n${total - falhas}/${total} testes dos adapters passaram`);
process.exit(falhas > 0 ? 1 : 0);
