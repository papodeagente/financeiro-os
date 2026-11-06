/**
 * Cobrança e venda — fechamento final (E7, 06/11/2026): regras puras e
 * provedores FALSOS (sem rede).
 *   · link do Pagar.me com cartão (corpo como a doc oficial) e o aviso que
 *     procura a nossa referência e o id do link no corpo inteiro;
 *   · negativação no Asaas: simulação, pedido em multipart, consulta e
 *     cancelamento; regras do cadastro; os avisos PAYMENT_DUNNING_* seguem
 *     sem efeito financeiro;
 *   · recibo emitido: o que muda no recibo, a versão e o número.
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-cobranca-item18.ts
 */
import { corpoDoLinkPagarme, criarAdapterPagarme } from '../src/lib/cobranca/pagarme.ts';
import { CAPACIDADES_ASAAS, criarAdapterAsaas, negativacaoAsaas } from '../src/lib/cobranca/asaas.ts';
import { pistasDoAviso, varrerAviso } from '../src/lib/cobranca/aviso.ts';
import { devedorDoCliente, faltasParaNegativar, negativacaoViva, recusaDaCobranca, rotuloDaNegativacao } from '../src/lib/cobranca/negativacao.ts';
import { adapterAsaas } from '../src/lib/plataformas/asaas.ts';
import { mudancaQueAfetaORecibo, numeroDaVersao, pagantesDaVenda, resumoDaMudanca, assinaturaDoRecibo } from '../src/lib/recibo-emitido.ts';
import { normalizarVenda } from '../src/lib/venda-modelo.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

interface Chamada { metodo: string; caminho: string; corpo: unknown; multipart: boolean }
function provedorFalso(rotas: Array<[RegExp, string, (c: Chamada) => { status?: number; corpo?: unknown; demorar?: boolean }]>) {
  const chamadas: Chamada[] = [];
  const fetchFalso = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const multipart = init?.body instanceof FormData;
    const c: Chamada = {
      metodo: String(init?.method ?? 'GET'), caminho: u.pathname.replace(/^\/(v3|core\/v5)/, '') + u.search, multipart,
      corpo: multipart ? Object.fromEntries((init!.body as FormData).entries()) : init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    chamadas.push(c);
    const rota = rotas.find(([re, m]) => m === c.metodo && re.test(c.caminho));
    if (!rota) return new Response(JSON.stringify({ errors: [{ description: 'Não encontrado' }] }), { status: 404 });
    const r = rota[2](c);
    if (r.demorar) return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return new Response(r.corpo === undefined ? '' : JSON.stringify(r.corpo), { status: r.status ?? 200 });
  };
  return { chamadas, fetch: fetchFalso };
}
const amb = (f: ReturnType<typeof provedorFalso>) => ({ fetch: f.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>, agora: () => Date.now(), dormir: async () => {}, timeoutMs: 50 });

async function principal() {
  console.log('--- Link do Pagar.me com cartão ---');
  const corpo = corpoDoLinkPagarme({ referencia: 'f1;t;c1', nome: 'Pacote Chile', descricao: 'Pacote', valor_centavos: 250000, vence_em: '2026-11-12' }, new Date('2026-11-06T12:00:00Z'));
  eq(corpo.payment_settings.accepted_payment_methods, ['boleto', 'pix', 'credit_card'], 'boleto, Pix e cartão');
  eq(corpo.payment_settings.credit_card_settings, { operation_type: 'auth_and_capture', installments: [{ number: 1, total: 250000 }] }, 'cartão à vista, captura na hora, valor cheio');
  eq([corpo.order_code, corpo.payment_settings.boleto_settings.due_at, corpo.payment_settings.pix_settings.expires_in],
    ['f1;t;c1', '2026-11-12T00:00:00Z', 6 * 86400 + 14 * 3600 + 59 * 60 + 59], 'referência no order_code; boleto até o dia; Pix em SEGUNDOS até 23h59 de Brasília');
  const f = provedorFalso([[/^\/paymentlinks$/, 'POST', () => ({ corpo: { id: 'pl_abc123', url: 'https://payment-link.pagar.me/pl_abc123', status: 'active' } })]]);
  const pg = criarAdapterPagarme({ secretKey: 'sk_test_x', ambiente: amb(f) });
  const link = await pg.criarLink!({ referencia: 'f1;t;c1', nome: 'Pacote', descricao: 'Pacote', valor_centavos: 9990, vence_em: '2026-11-12' });
  eq([link.id_externo, link.url, (f.chamadas[0].corpo as { payment_settings: { accepted_payment_methods: string[] } }).payment_settings.accepted_payment_methods.includes('credit_card')],
    ['pl_abc123', 'https://payment-link.pagar.me/pl_abc123', true], 'POST /paymentlinks com cartão; usa a url da resposta');

  console.log('--- Aviso do pedido pago pelo link ---');
  eq(varrerAviso({ data: { id: 'or_1', code: 'XYZ', checkouts: [{ payment_link_id: 'pl_abc123' }], items: [{ code: 'f1;t;c1' }] } }),
    { referencias: ['f1;t;c1'], links: ['pl_abc123'], pistaDeLink: true }, 'acha a referência e o id do link em qualquer campo');
  eq(varrerAviso({ data: { id: 'or_2', code: 'P-77', charges: [{ id: 'ch_1' }] } }), { referencias: [], links: [], pistaDeLink: false }, 'pedido comum: nenhuma pista');
  const pistas = pistasDoAviso('pagarme', { tipo: 'PAGAMENTO_CONFIRMADO', id_externo: 'hook_1', parcela_afetada: 0, transacao: { bruto: {
    type: 'order.paid', data: { id: 'or_9', code: 'ABCD1234', checkouts: [{ id: 'chk_1', payment_link_id: 'pl_abc123' }], charges: [{ id: 'ch_9', amount: 9990, paid_amount: 9990, payment_method: 'credit_card' }] },
  } } as never });
  eq([pistas.ids.includes('pl_abc123'), pistas.formaPaga, pistas.pistaDeLink, pistas.pagoCentavos], [true, 'cartao', true, 9990], 'o id do link vira pista de cobrança; cartão reconhecido');

  console.log('--- Negativação: regras ---');
  const cliente = { id: 'c', nome: 'Ana Lima', documento: '123.456.789-09', email: '', telefone: '(11) 98888-7777',
    endereco: { cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', complemento: 'cj 5', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' } };
  const devedor = devedorDoCliente(cliente);
  eq([devedor.documento, devedor.telefone, devedor.cep, faltasParaNegativar(devedor)], ['12345678909', '11988887777', '01310100', []], 'cadastro completo: pronto');
  eq(faltasParaNegativar(devedorDoCliente({ ...cliente, telefone: '', endereco: null })), ['telefone com DDD', 'CEP', 'endereço (rua)', 'número do endereço', 'bairro'], 'o que falta, em palavras');
  eq([
    recusaDaCobranca({ provedor: 'pagarme', status: 'vencida', tipo: 'boleto', id_externo: 'x' }, false),
    recusaDaCobranca({ provedor: 'asaas', status: 'aberta', tipo: 'boleto', id_externo: 'x' }, true),
    recusaDaCobranca({ provedor: 'asaas', status: 'vencida', tipo: 'link', id_externo: 'x' }, true),
    recusaDaCobranca({ provedor: 'asaas', status: 'vencida', tipo: 'boleto_pix', id_externo: 'pay_1' }, true),
  ], ['Negativação pela integração só existe no Asaas.', 'Só cobrança vencida pode ser negativada.', 'Link de pagamento não tem cobrança para negativar.', null], 'só Asaas, só vencida, nunca link');
  eq([negativacaoViva('PROCESSED'), negativacaoViva('PEDINDO'), negativacaoViva('CANCELLED'), negativacaoViva('DENIED'), rotuloDaNegativacao('PROCESSED')],
    [true, true, false, false, 'Cliente negativado'], 'viva × encerrada');
  eq(CAPACIDADES_ASAAS.negativacao, true, 'capacidade no Asaas');

  console.log('--- Negativação: Asaas falso ---');
  const fa = provedorFalso([
    [/^\/paymentDunnings\/simulate\?payment=pay_1$/, 'POST', () => ({ corpo: { payment: 'pay_1', value: 150, typeSimulations: [{ type: 'CREDIT_BUREAU', isAllowed: true, notAllowedReason: null, feeValue: 9.9, netValue: 140.1, startDate: '2026-11-11' }] } })],
    [/^\/paymentDunnings$/, 'POST', () => ({ corpo: { id: 'dun_1', dunningNumber: 42, status: 'PENDING', type: 'CREDIT_BUREAU', feeValue: 9.9, canBeCancelled: true, isNecessaryResendDocumentation: false } })],
    [/^\/paymentDunnings\/dun_1$/, 'GET', () => ({ corpo: { id: 'dun_1', dunningNumber: 42, status: 'PROCESSED', feeValue: 9.9, canBeCancelled: true } })],
    [/^\/paymentDunnings\/dun_1\/cancel$/, 'POST', () => ({ corpo: { id: 'dun_1', dunningNumber: 42, status: 'AWAITING_CANCELLATION', feeValue: 9.9, canBeCancelled: false } })],
    [/^\/paymentDunnings\?payment=pay_2/, 'GET', () => ({ corpo: { data: [{ id: 'dun_old', status: 'CANCELLED' }, { id: 'dun_2', status: 'PENDING', feeValue: 9.9 }] } })],
  ]);
  const asaas = criarAdapterAsaas({ apiKey: '$aact_hmlg_x', ambiente: amb(fa) });
  eq(await asaas.simularNegativacao!('pay_1'), { permitida: true, motivo: '', taxa_centavos: 990, liquido_centavos: 14010, inicio_previsto: '2026-11-11' }, 'simulação: pode, taxa e início');
  const n = await asaas.negativar!({ cobranca_externa: 'pay_1', descricao: 'Pacote', devedor });
  const ped = fa.chamadas.at(-1)!;
  eq([ped.multipart, (ped.corpo as Record<string, string>).type, (ped.corpo as Record<string, string>).customerCpfCnpj, (ped.corpo as Record<string, string>).customerProvince, n.id_externo, n.status, n.taxa_centavos],
    [true, 'CREDIT_BUREAU', '12345678909', 'Bela Vista', 'dun_1', 'PENDING', 990], 'pedido em multipart/form-data com o devedor');
  eq((await asaas.consultarNegativacao!('dun_1')).status, 'PROCESSED', 'consulta');
  eq((await asaas.cancelarNegativacao!('dun_1')).status, 'AWAITING_CANCELLATION', 'cancelar: o provedor confirma depois');
  eq((await asaas.negativacaoDaCobranca!('pay_2'))?.id_externo, 'dun_2', 'depois de timeout: acha a viva pela cobrança (ignora a cancelada)');
  eq(negativacaoAsaas({ id: 'd', status: 'ESQUISITO' }).status, 'PENDING', 'situação desconhecida não quebra');

  console.log('--- Avisos de negativação: sem efeito financeiro (congelado) ---');
  for (const ev of ['PAYMENT_DUNNING_REQUESTED', 'PAYMENT_DUNNING_RECEIVED']) {
    const e = await adapterAsaas.normalizar({ id: `evt_${ev}`, event: ev, payment: { id: 'pay_1', status: 'OVERDUE', value: 150 } }, { api_key: '', segredo_webhook: '', extras: {} } as never);
    eq(e.tipo, 'IGNORADO', `${ev}: ignorado (não vira venda nem baixa)`);
  }

  console.log('--- Recibo emitido ---');
  eq([numeroDaVersao('RV-00123', 1), numeroDaVersao('RV-00123', 2), numeroDaVersao('RV-00123-2', 3)], ['RV-00123', 'RV-00123.2', 'RV-00123-2.3'], 'número por versão');
  const base = normalizarVenda({
    data_venda: '2026-11-01', cliente: { id: 'c1', nome: 'Ana' },
    produtos: [{ id: 'p1', tipo: 'HOTEL', descricao: 'Hotel', quantidade: 1, valor_unitario_centavos: 100000 }],
    pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 100000, parcelas: 1 }],
  }).venda;
  eq(mudancaQueAfetaORecibo(base, base), null, 'nada que o recibo mostre: sem trava');
  eq(mudancaQueAfetaORecibo(base, { ...base, observacoes: 'mudou só a observação' }), null, 'observação não mexe no recibo');
  const maisCara = { ...base, produtos: base.produtos.map(p => ({ ...p, valor_unitario_centavos: 120000 })) };
  const m1 = mudancaQueAfetaORecibo(base, maisCara);
  eq([m1?.valor, m1?.pagantes], [{ antes_centavos: 100000, depois_centavos: 120000 }, undefined], 'valor mudou');
  eq(resumoDaMudanca(m1!), 'valor de R$ 1.000,00 para R$ 1.200,00', 'frase do histórico');
  const outroPagante = { ...base, pagamentos: base.pagamentos.map(p => ({ ...p, pagante: { id: 'c2', nome: 'Bruno' } })) };
  eq([pagantesDaVenda(base).length, mudancaQueAfetaORecibo(base, outroPagante)?.pagantes?.depois.length, mudancaQueAfetaORecibo(base, outroPagante)?.valor], [1, 1, undefined], 'quem paga mudou');
  eq(assinaturaDoRecibo({ valor: 10, pagador: { nome: 'A', documento: '1' } }) === assinaturaDoRecibo({ valor: 10, pagador: { nome: 'A', documento: '1' } }), true, 'mesmo conteúdo, mesma assinatura');
}

await principal();
console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
