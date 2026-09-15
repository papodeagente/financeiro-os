/**
 * Adapters de plataforma (src/lib/plataformas/*).
 *
 * Cada teste aqui corresponde a uma armadilha já medida em produção nas
 * integrações do CRM e do Membros. Normalização errada aqui vira receita
 * errada no DRE, então o valor, a moeda e a idempotência são o alvo.
 */
import { adapterAsaas } from '../src/lib/plataformas/asaas.ts';
import { adapterHotmart } from '../src/lib/plataformas/hotmart.ts';
import { adapterPagarme } from '../src/lib/plataformas/pagarme.ts';
import { baseDaChave } from '../src/lib/plataformas/asaas.ts';
import { iguaisEmTempoConstante, deCentavos } from '../src/lib/plataformas/comum.ts';

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

console.log('\n--- Asaas: os DOIS eventos de pago valem ---');
for (const evento of ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']) {
  const e = await adapterAsaas.normalizar(
    { id: `evt_${evento}`, event: evento, payment: { id: 'pay_1', value: 1000, netValue: 950, billingType: 'PIX', paymentDate: '2026-09-15' } },
    cred(),
  );
  eq(e.tipo, 'PAGAMENTO_CONFIRMADO', `${evento} conta como pago`);
  eq([e.valor_bruto, e.valor_taxa, e.valor_liquido], [1000, 50, 950], `${evento}: taxa é a diferença até o líquido`);
}
{
  const e = await adapterAsaas.normalizar(
    { id: 'e1', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1', value: 1000 } }, cred());
  eq(e.tipo, 'REEMBOLSO', 'estorno é reconhecido');
}
{
  // Evento que não interessa NÃO pode virar erro: o Asaas pausa a fila.
  const e = await adapterAsaas.normalizar(
    { id: 'e2', event: 'PAYMENT_CREATED', payment: { id: 'pay_9', value: 500 } }, cred());
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
    { id: 'e3', event: 'PAYMENT_CONFIRMED', payment: { id: 'p', value: 800 } }, cred());
  eq([e.valor_taxa, e.valor_liquido], [0, 800],
     'sem netValue, não inventa taxa: líquido igual ao bruto');
}

console.log('\n--- Hotmart: hottok e moeda estrangeira ---');
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
  eq([e.tipo, e.valor_bruto, e.valor_taxa, e.moeda], ['PAGAMENTO_CONFIRMADO', 497, 40.75, 'BRL'], 'venda em real');
  eq(e.parcelas, 12, 'parcelas');
  eq(e.comprador.documento, '12345678900', 'documento vem só com dígitos');
  eq(e.data_pagamento, '2026-09-10', 'epoch em ms vira data civil');
}
{
  // Venda em dólar já foi somada como real em produção e inflou a receita.
  const e = await adapterHotmart.normalizar({
    event: 'PURCHASE_APPROVED',
    data: { product: { id: '1' }, purchase: { transaction: 'HP9', price: { value: 200, currency_value: 'USD' } } },
  }, cred());
  eq([e.moeda, e.valor_bruto], ['USD', 200],
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
  eq([venda.id_transacao, estorno.id_transacao], ['HP1', 'HP1'], 'mas o id da transação é o mesmo, para casar os dois');
  eq(estorno.tipo, 'REEMBOLSO', 'e o estorno é reconhecido');
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
      id: 'or_123', amount: 49700, currency: 'BRL', code: 'PED-1',
      customer: { name: 'Bia', email: 'bia@x.com', document: '98765432100', phones: { mobile_phone: { area_code: '11', number: '999998888' } } },
      items: [{ description: 'Pacote Cancún', quantity: 1, amount: 49700 }],
      charges: [{ amount: 49700, payment_method: 'credit_card', paid_at: '2026-09-15T10:00:00Z', last_transaction: { installments: 6 } }],
    },
  }, cred());
  eq([e.tipo, e.valor_bruto], ['PAGAMENTO_CONFIRMADO', 497], 'valor em centavos vira real, e não 49.700');
  eq(e.itens[0], { descricao: 'Pacote Cancún', quantidade: 1, valor_unitario: 497 }, 'item também');
  eq([e.parcelas, e.forma_pagamento], [6, 'credit_card'], 'parcelas e forma');
  eq(e.comprador.telefone, '11999998888', 'telefone junta DDD e número');
  eq(e.data_pagamento, '2026-09-15', 'data do pagamento');
  eq([e.valor_taxa, e.valor_liquido], [0, 497],
     'a v5 não manda taxa no webhook: informa zero em vez de estimar');
}
{
  const e = await adapterPagarme.normalizar({ id: 'h2', type: 'charge.refunded', data: { id: 'ch_1', amount: 1000 } }, cred());
  eq(e.tipo, 'REEMBOLSO', 'estorno');
}
{
  const e = await adapterPagarme.normalizar({ id: 'h3', type: 'order.created', data: { id: 'or_9', amount: 1000 } }, cred());
  eq(e.tipo, 'IGNORADO', 'pedido criado ainda não é dinheiro');
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
}

console.log(`\n${total - falhas}/${total} testes dos adapters passaram`);
process.exit(falhas > 0 ? 1 : 0);
