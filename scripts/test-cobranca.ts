/**
 * Cobrança (E3, 05/11/2026): regras puras e os adapters do Asaas e do
 * Pagar.me contra provedores FALSOS que respondem como a documentação
 * oficial (lida em 05/11/2026). Nenhuma chamada de rede.
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-cobranca.ts
 */
import { lerReferencia, referenciaDaCobranca, referenciaDoCarne, ehReferenciaNossa } from '../src/lib/cobranca/referencia.ts';
import {
  codigoDoMotivo, comoAlterar, conferirCarne, descricaoPeloModelo, diaDaReguaHoje, diasEntre, efeitoDoAviso, faltasDoCliente,
  planejarItem, tipoRecusado,
} from '../src/lib/cobranca/calculo.ts';
import { configDaTela, configParaTela } from '../src/lib/cobranca/config-tela.ts';
import { CONFIG_COBRANCA_PADRAO, encargosDaCobranca, normalizarConfigCobranca } from '../src/lib/cobranca/config.ts';
import { CAPACIDADES_ASAAS, criarAdapterAsaas, statusAsaas } from '../src/lib/cobranca/asaas.ts';
import { CAPACIDADES_PAGARME, criarAdapterPagarme, encargosPagarme, statusPagarme } from '../src/lib/cobranca/pagarme.ts';
import { ErroProvedor } from '../src/lib/cobranca/tipos.ts';
import { resultadoDoEnvio } from '../src/lib/cobranca/resultado-envio.ts';
import { aguardarVez, zerarLimitador } from '../src/lib/cobranca/limitador.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
async function erroDe(p: Promise<unknown>): Promise<ErroProvedor | Error | null> {
  try { await p; return null; } catch (e) { return e as Error; }
}

// ---------------------------------------------------------------------------
// Provedor falso: grava cada chamada e responde pela tabela de rotas.

interface Chamada { metodo: string; caminho: string; corpo: unknown; cabecalhos: Record<string, string> }
type Resposta = { status?: number; corpo?: unknown; cabecalhos?: Record<string, string>; demorar?: boolean };
function provedorFalso(rotas: Array<[RegExp, string, (c: Chamada) => Resposta]>) {
  const chamadas: Chamada[] = [];
  const fetchFalso = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const c: Chamada = {
      metodo: String(init?.method ?? 'GET'), caminho: u.pathname.replace(/^\/(v3|core\/v5)/, '') + u.search,
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
      cabecalhos: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
    };
    chamadas.push(c);
    const rota = rotas.find(([re, m]) => m === c.metodo && re.test(c.caminho));
    if (!rota) return new Response(JSON.stringify({ errors: [{ code: 'not_found', description: 'Não encontrado' }] }), { status: 404 });
    const r = rota[2](c);
    if (r.demorar) {
      // Simula o provedor que não responde: espera o abort do cliente.
      return new Promise((_, rejeitar) => {
        init?.signal?.addEventListener('abort', () => rejeitar(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    return new Response(r.corpo === undefined ? '' : JSON.stringify(r.corpo), { status: r.status ?? 200, headers: r.cabecalhos });
  };
  return { chamadas, fetch: fetchFalso };
}
const amb = (f: ReturnType<typeof provedorFalso>, timeoutMs = 50) => ({
  fetch: f.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>,
  agora: () => Date.now(), dormir: async () => {}, timeoutMs,
});

const cliente = {
  id: 'cli1', nome: 'Ana Lima', documento: '12345678909', email: 'ana@exemplo.com', telefone: '11988887777',
  endereco: { cep: '01310100', logradouro: 'Av. Paulista', numero: '1000', complemento: '', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' },
};

async function principal() {
  console.log('--- Referência própria ---');
  const ref = referenciaDaCobranca('mhx1abc2def', 'cmhx9zz1aa');
  eq(ref, 'f1;mhx1abc2def;cmhx9zz1aa', 'f1;<agência>;<cobrança>');
  eq(lerReferencia(ref), { tenantId: 'mhx1abc2def', cobrancaId: 'cmhx9zz1aa', carneId: '' }, 'lê a referência da cobrança');
  eq(lerReferencia(referenciaDoCarne('t1', 'mhx77')), { tenantId: 't1', cobrancaId: '', carneId: 'mhx77' }, 'carnê: k<id>');
  eq([ehReferenciaNossa('pedido-123'), ehReferenciaNossa('f1;'), ehReferenciaNossa('f1;t;'), ehReferenciaNossa(null)], [false, false, false, false], 'o que não é nosso não passa');
  eq(ref.length <= 52, true, 'cabe no code do Pagar.me (52)');

  console.log('--- Régua: dia de hoje ---');
  eq(diasEntre('2026-11-05', '2026-11-08'), 3, 'dias entre datas');
  eq(diaDaReguaHoje('2026-11-10', '2026-11-05', [-5, 0, 1, 3, 7]), -5, 'cinco dias antes');
  eq(diaDaReguaHoje('2026-11-05', '2026-11-05', [-5, 0, 1, 3, 7]), 0, 'no dia');
  eq(diaDaReguaHoje('2026-11-02', '2026-11-05', [-5, 0, 1, 3, 7]), 3, 'três dias depois');
  eq(diaDaReguaHoje('2026-11-03', '2026-11-05', [-5, 0, 1, 3, 7]), null, 'dois dias depois: fora da régua');
  eq(diaDaReguaHoje('', '2026-11-05', [0]), null, 'sem vencimento: nada');

  console.log('--- Planejar o item ---');
  const conta = (d: Record<string, unknown>, valendo = false) => ({ id: 'r1', dados: { cliente_id: 'cli1', cliente_nome: 'Ana', descricao: 'Pacote', status: 'PENDENTE', valor_final: 1500, data_vencimento: '2026-11-20', ...d }, cobranca_valendo: valendo });
  let it = planejarItem(conta({}), '2026-11-05', {});
  eq([it.valor_centavos, it.vencimento, it.erros], [150000, '2026-11-20', []], 'saldo em centavos, vencimento da conta');
  it = planejarItem(conta({ status: 'PARCIAL', valor_recebido: 500 }), '2026-11-05', {});
  eq([it.valor_centavos, it.avisos.length], [100000, 1], 'parcial: cobra o que falta, com aviso');
  it = planejarItem(conta({ data_vencimento: '2026-10-01' }), '2026-11-05', {});
  eq(it.erros[0], 'O vencimento (01/10/2026) já passou. Escolha uma nova data.', 'vencida sem nova data: pede data');
  it = planejarItem(conta({ data_vencimento: '2026-10-01' }), '2026-11-05', { vencimento_vencidas: '2026-11-08' });
  eq([it.erros, it.vencimento], [[], '2026-11-08'], 'vencida com data para as vencidas');
  eq(planejarItem(conta({}, true), '2026-11-05', {}).erros[0].startsWith('Esta conta já tem cobrança'), true, 'uma cobrança valendo por conta');
  eq(planejarItem(conta({ status: 'RECEBIDO' }), '2026-11-05', {}).erros[0], 'A conta já foi recebida.', 'recebida não cobra');

  console.log('--- O que cada provedor faz ---');
  eq(tipoRecusado(CAPACIDADES_PAGARME, 'Pagar.me', 'boleto_pix'), 'O Pagar.me não emite boleto e Pix no mesmo documento. Escolha boleto ou Pix.', 'Pagar.me: sem boleto com Pix');
  eq(tipoRecusado(CAPACIDADES_PAGARME, 'Pagar.me', 'carne'), 'O Pagar.me não emite carnê. Emita um boleto por parcela.', 'Pagar.me: sem carnê');
  eq([tipoRecusado(CAPACIDADES_ASAAS, 'Asaas', 'boleto_pix'), tipoRecusado(CAPACIDADES_ASAAS, 'Asaas', 'carne')], [null, null], 'Asaas: boleto com Pix e carnê');
  eq(faltasDoCliente({ ...cliente, endereco: null }, 'pagarme', 'boleto'), ['endereço com CEP'], 'Pagar.me boleto exige endereço');
  eq(faltasDoCliente({ ...cliente, email: '', telefone: '' }, 'pagarme', 'pix'), ['e-mail', 'telefone com DDD'], 'Pagar.me Pix exige e-mail e telefone');
  eq(faltasDoCliente({ ...cliente, endereco: null, email: '' }, 'asaas', 'boleto_pix'), [], 'Asaas: nome e documento bastam');
  eq(faltasDoCliente({ ...cliente, documento: '123' }, 'asaas', 'pix'), ['CPF ou CNPJ'], 'documento inválido');

  console.log('--- Carnê ---');
  const parcela = (n: number, venc: string, valor = 50000) => ({ conta_id: `r${n}`, descricao: '', cliente_id: 'cli1', cliente_nome: 'Ana', valor_centavos: valor, vencimento: venc, erros: [], avisos: [] });
  eq(conferirCarne([parcela(1, '2026-12-10'), parcela(2, '2027-01-10'), parcela(3, '2027-02-10')]), [], 'mesmo valor, mesmo dia de meses seguidos');
  eq(conferirCarne([parcela(1, '2026-12-10'), parcela(2, '2027-01-10', 40000)]).length, 1, 'valores diferentes: recusa');
  eq(conferirCarne([parcela(1, '2026-12-10'), parcela(2, '2027-01-15')]).length, 1, 'dias diferentes: recusa');
  eq(conferirCarne([parcela(1, '2026-12-10')]).length, 1, 'uma parcela só: recusa');

  console.log('--- 2ª via ---');
  const atual = { valor_centavos: 10000, vencimento: '2026-11-10' };
  eq(comoAlterar(CAPACIDADES_ASAAS, 'boleto_pix', atual, { vencimento: '2026-11-20' }), 'alterar', 'Asaas altera vencimento');
  eq(comoAlterar(CAPACIDADES_ASAAS, 'pix', atual, { valor_centavos: 12000 }), 'alterar', 'Asaas altera valor do Pix');
  eq(comoAlterar(CAPACIDADES_PAGARME, 'boleto', atual, { vencimento: '2026-11-20' }), 'alterar', 'Pagar.me altera vencimento do boleto');
  eq(comoAlterar(CAPACIDADES_PAGARME, 'boleto', atual, { valor_centavos: 12000 }), 'reemitir', 'Pagar.me: valor novo = cancela e emite outra');
  eq(comoAlterar(CAPACIDADES_PAGARME, 'pix', atual, { vencimento: '2026-11-20' }), 'reemitir', 'Pagar.me: Pix com novo vencimento = outro Pix');
  eq(comoAlterar(CAPACIDADES_ASAAS, 'boleto', atual, { vencimento: '2026-11-10' }), 'nada', 'nada mudou');

  console.log('--- Aviso do provedor → efeito ---');
  const asaasCaps = { avisaCredito: true };
  const pgCaps = { avisaCredito: false };
  eq(efeitoDoAviso('aberta', 'PAGAMENTO_CONFIRMADO', asaasCaps, { jaBaixada: false }), { status: 'paga', baixar: false, estornar: false, aguardandoCredito: true, evento: 'paga' }, 'Asaas confirmado: paga, baixa espera o crédito');
  eq(efeitoDoAviso('paga', 'PAGAMENTO_RECEBIDO', asaasCaps, { jaBaixada: false }).baixar, true, 'Asaas recebido: baixa');
  eq(efeitoDoAviso('paga', 'PAGAMENTO_RECEBIDO', asaasCaps, { jaBaixada: true }).baixar, false, 'recebido de novo: não baixa duas vezes');
  eq(efeitoDoAviso('aberta', 'PAGAMENTO_CONFIRMADO', pgCaps, { jaBaixada: false }).baixar, true, 'Pagar.me pago: baixa já no pago');
  eq(efeitoDoAviso('aberta', 'PAGAMENTO_ATRASADO', asaasCaps, { jaBaixada: false }).status, 'vencida', 'vencido');
  eq(efeitoDoAviso('paga', 'PAGAMENTO_ATRASADO', asaasCaps, { jaBaixada: true }).status, 'paga', 'aviso de vencido atrasado não reabre paga');
  eq(efeitoDoAviso('aberta', 'PAGAMENTO_CANCELADO', asaasCaps, { jaBaixada: false }).status, 'cancelada', 'cancelada no provedor');
  eq(efeitoDoAviso('paga', 'REEMBOLSO', asaasCaps, { jaBaixada: true }), { status: 'estornada', baixar: false, estornar: true, aguardandoCredito: false, evento: 'estornada' }, 'estornado desfaz a baixa');
  eq(efeitoDoAviso('paga', 'REEMBOLSO', asaasCaps, { jaBaixada: true, estornoParcial: true }).estornar, false, 'estorno parcial não desfaz tudo');
  eq(efeitoDoAviso('vencida', 'PAGAMENTO_CRIADO', asaasCaps, { jaBaixada: false, vencimentoNoAviso: '2026-11-20', hoje: '2026-11-05' }).status, 'aberta', 'alterada para frente: volta a valer');

  console.log('--- Configuração ---');
  eq(normalizarConfigCobranca(null), CONFIG_COBRANCA_PADRAO, 'sem nada gravado: o padrão (régua desligada)');
  eq(normalizarConfigCobranca({ regua: { ligada: true, dias: [7, -5, 0, 0, 99], canais: ['whatsapp', 'sms'] } }).regua, { ligada: true, dias: [-5, 0, 7], canais: ['whatsapp'] }, 'régua: dias ordenados e válidos, canais conhecidos');
  eq(normalizarConfigCobranca({ provedor_padrao: 'outro' }).provedor_padrao, '', 'provedor desconhecido vira vazio');
  eq(encargosDaCobranca(CONFIG_COBRANCA_PADRAO, { juros_am_pct: 1, multa_pct: 2, tolerancia_dias: 0, desconto_antecipacao: { pct: 5, dias: 3 } }),
    { juros_am_pct: 1, multa_pct: 2, tolerancia_dias: 0, desconto: { pct: 5, dias: 3 } }, 'por padrão: a política do financeiro');
  eq(encargosDaCobranca({ ...CONFIG_COBRANCA_PADRAO, usar_politica: false, juros_am_pct: 3 }, { juros_am_pct: 1 }), { juros_am_pct: 3, multa_pct: 0, tolerancia_dias: 0, desconto: null }, 'ou os da cobrança');
  eq(encargosDaCobranca(CONFIG_COBRANCA_PADRAO, null), null, 'sem política: nada no documento');

  console.log('--- Status dos provedores ---');
  eq(['PENDING', 'OVERDUE', 'RECEIVED', 'CONFIRMED', 'REFUNDED', 'DELETED'].map(s => statusAsaas(s)), ['aberta', 'vencida', 'paga', 'paga', 'estornada', 'cancelada'], 'Asaas');
  eq(['pending', 'paid', 'underpaid', 'canceled', 'failed', 'refunded'].map(statusPagarme), ['aberta', 'paga', 'paga', 'cancelada', 'falhou', 'estornada'], 'Pagar.me');

  console.log('--- Asaas: emissão como a documentação ---');
  const pagamento = (extra: Record<string, unknown> = {}) => ({
    object: 'payment', id: 'pay_080225913252', customer: 'cus_000005219613', value: 150, netValue: 148.01, billingType: 'BOLETO',
    status: 'PENDING', dueDate: '2026-11-20', externalReference: ref, invoiceUrl: 'https://sandbox.asaas.com/i/080225913252',
    bankSlipUrl: 'https://sandbox.asaas.com/b/pdf/080225913252', deleted: false, ...extra,
  });
  let f = provedorFalso([
    [/^\/customers\?cpfCnpj=/, 'GET', () => ({ corpo: { data: [] } })],
    [/^\/customers\?externalReference=/, 'GET', () => ({ corpo: { data: [] } })],
    [/^\/customers$/, 'POST', () => ({ corpo: { id: 'cus_000005219613' } })],
    [/^\/payments$/, 'POST', () => ({ corpo: pagamento() })],
    [/identificationField$/, 'GET', () => ({ corpo: { identificationField: '00190000090275928800021932978170187890000005000', nossoNumero: '6543', barCode: '00191878900000050000000002759288002193297817' } })],
    [/pixQrCode$/, 'GET', () => ({ corpo: { encodedImage: 'iVBOR...', payload: '00020101021226820014br.gov.bcb.pix', expirationDate: '2027-11-20 23:59:59' } })],
  ]);
  let asaas = criarAdapterAsaas({ apiKey: '$aact_hmlg_teste', ambiente: amb(f) });
  const idCli = await asaas.acharOuCriarCliente(cliente);
  eq(idCli, 'cus_000005219613', 'cliente criado depois de procurar por documento e referência');
  eq(f.chamadas.map(c => `${c.metodo} ${c.caminho.split('?')[0]}`), ['GET /customers', 'GET /customers', 'POST /customers'], 'procura antes de criar (o Asaas aceita duplicado)');
  eq([f.chamadas[0].cabecalhos['access_token'], f.chamadas[0].cabecalhos['user-agent']], ['$aact_hmlg_teste', 'EnturOSFin/1.0'], 'access_token e User-Agent');
  eq((f.chamadas[2].corpo as Record<string, unknown>).notificationDisabled, true, 'avisos do Asaas desligados (a régua é pelo CRM)');
  const emitida = await asaas.emitir(idCli, cliente, {
    referencia: ref, tipo: 'boleto_pix', valor_centavos: 15000, vencimento: '2026-11-20', descricao: 'Pacote Bariloche',
    encargos: { juros_am_pct: 1, multa_pct: 2, tolerancia_dias: 0, desconto: { pct: 5, dias: 3 } },
  });
  eq(f.chamadas[3].corpo, {
    customer: 'cus_000005219613', billingType: 'BOLETO', value: 150, dueDate: '2026-11-20', description: 'Pacote Bariloche', externalReference: ref,
    interest: { value: 1 }, fine: { value: 2, type: 'PERCENTAGE' }, discount: { value: 5, dueDateLimitDays: 3, type: 'PERCENTAGE' },
  }, 'POST /payments: reais, referência, juros ao mês, multa e desconto em %');
  eq([emitida.id_externo, emitida.status, emitida.valor_centavos, emitida.url_boleto], ['pay_080225913252', 'aberta', 15000, 'https://sandbox.asaas.com/b/pdf/080225913252'], 'cobrança lida em centavos');
  const dados = await asaas.dadosDePagamento(emitida, 'boleto_pix');
  eq([dados.linha_digitavel.length, dados.codigo_barras.length, dados.pix_copia_cola.startsWith('000201')], [47, 44, true], 'linha, código de barras e Pix copia e cola');

  console.log('--- Asaas: falhas ---');
  f = provedorFalso([[/^\/payments$/, 'POST', () => ({ status: 400, corpo: { errors: [{ code: 'invalid_customer', description: 'Customer Inválido ou não informado' }] } })]]);
  asaas = criarAdapterAsaas({ apiKey: '$aact_hmlg_x', ambiente: amb(f) });
  let e = await erroDe(asaas.emitir('cus_x', cliente, { referencia: ref, tipo: 'pix', valor_centavos: 100, vencimento: '2026-11-20', descricao: 'x', encargos: null }));
  eq([e instanceof ErroProvedor && e.tipo, e?.message, e instanceof ErroProvedor && e.passageiro], ['recusa', 'Customer Inválido ou não informado', false], '400: recusa com a frase do Asaas, não repete');
  f = provedorFalso([[/^\/payments$/, 'POST', () => ({ status: 429, corpo: {}, cabecalhos: { 'RateLimit-Reset': '42' } })]]);
  asaas = criarAdapterAsaas({ apiKey: '$aact_hmlg_x', ambiente: amb(f) });
  e = await erroDe(asaas.emitir('cus_x', cliente, { referencia: ref, tipo: 'pix', valor_centavos: 100, vencimento: '2026-11-20', descricao: 'x', encargos: null }));
  eq([e instanceof ErroProvedor && e.tipo, e instanceof ErroProvedor && e.esperarSegundos, e instanceof ErroProvedor && e.passageiro], ['limite', 42, true], '429: espera o RateLimit-Reset');
  f = provedorFalso([[/^\/payments$/, 'POST', () => ({ demorar: true })]]);
  asaas = criarAdapterAsaas({ apiKey: '$aact_hmlg_x', ambiente: amb(f, 20) });
  e = await erroDe(asaas.emitir('cus_x', cliente, { referencia: ref, tipo: 'pix', valor_centavos: 100, vencimento: '2026-11-20', descricao: 'x', encargos: null }));
  eq([e instanceof ErroProvedor && e.tipo, e instanceof ErroProvedor && e.passageiro], ['timeout', true], 'sem resposta: timeout (passageiro)');
  f = provedorFalso([[/^\/payments$/, 'POST', () => ({ status: 401, corpo: { errors: [{ code: 'invalid_access_token', description: 'A chave de API fornecida é inválida' }] } })]]);
  asaas = criarAdapterAsaas({ apiKey: '$aact_hmlg_x', ambiente: amb(f) });
  e = await erroDe(asaas.emitir('cus_x', cliente, { referencia: ref, tipo: 'pix', valor_centavos: 100, vencimento: '2026-11-20', descricao: 'x', encargos: null }));
  eq(e instanceof ErroProvedor && e.tipo, 'credencial', '401: chave recusada');
  f = provedorFalso([[/^\/payments\?externalReference=/, 'GET', () => ({ corpo: { data: [pagamento({ id: 'pay_morto', deleted: true }), pagamento()] } })]]);
  asaas = criarAdapterAsaas({ apiKey: '$aact_hmlg_x', ambiente: amb(f) });
  eq((await asaas.consultarPorReferencia(ref))?.id_externo, 'pay_080225913252', 'consulta pela referência ignora a removida');

  console.log('--- Asaas: carnê, link, alterar, cancelar, estorno ---');
  f = provedorFalso([
    [/^\/installments$/, 'POST', () => ({ corpo: { object: 'installment', id: 'inst_1' } })],
    [/^\/payments\?installment=/, 'GET', () => ({ corpo: { data: [2, 1, 3].map(n => pagamento({ id: `pay_p${n}`, installment: 'inst_1', installmentNumber: n })) } })],
    [/^\/paymentLinks$/, 'POST', () => ({ corpo: { id: 'lnk_1', url: 'https://sandbox.asaas.com/c/lnk_1' } })],
    [/^\/payments\/pay_1$/, 'PUT', c => ({ corpo: pagamento({ id: 'pay_1', dueDate: (c.corpo as { dueDate: string }).dueDate }) })],
    [/^\/payments\/pay_1$/, 'DELETE', () => ({ corpo: { deleted: true, id: 'pay_1' } })],
    [/^\/payments\/pay_1\/refund$/, 'POST', () => ({ corpo: pagamento({ id: 'pay_1', status: 'REFUNDED' }) })],
  ]);
  asaas = criarAdapterAsaas({ apiKey: '$aact_hmlg_x', ambiente: amb(f) });
  const carne = await asaas.emitirCarne!('cus_1', cliente, { referencia: 'f1;t;kabc', valor_parcela_centavos: 50000, parcelas: 3, primeiro_vencimento: '2026-12-10', descricao: 'Carnê', encargos: null });
  eq([carne.id_externo, carne.parcelas.map(p => p.numero_parcela)], ['inst_1', [1, 2, 3]], 'carnê: parcelamento e parcelas em ordem');
  eq((f.chamadas[0].corpo as Record<string, unknown>).paymentExternalReference, 'f1;t;kabc', 'referência do carnê em cada parcela');
  const link = await asaas.criarLink!({ referencia: ref, nome: 'Pacote', descricao: 'Pacote', valor_centavos: 9990, vence_em: '2026-11-12' });
  eq([link.url, (f.chamadas.at(-1)!.corpo as Record<string, unknown>).billingType], ['https://sandbox.asaas.com/c/lnk_1', 'UNDEFINED'], 'link: o cliente escolhe como pagar');
  const alterada = await asaas.alterar('pay_1', { vencimento: '2026-12-01' }, { referencia: ref, tipo: 'boleto_pix', valor_centavos: 15000, vencimento: '2026-11-20', descricao: 'x', encargos: null });
  eq([f.chamadas.at(-1)!.corpo, alterada.vencimento], [{ billingType: 'BOLETO', value: 150, dueDate: '2026-12-01' }, '2026-12-01'], 'PUT com forma, valor e o novo vencimento');
  await asaas.cancelar('pay_1');
  await asaas.cancelar('pay_nao_existe');
  eq(f.chamadas.slice(-2).map(c => c.metodo), ['DELETE', 'DELETE'], 'cancelar; já removida conta como cancelada');
  await asaas.estornar!('pay_1', null, 'Cliente desistiu');
  eq(f.chamadas.at(-1)!.corpo, { description: 'Cliente desistiu' }, 'estorno do Pix: valor total');

  console.log('--- Pagar.me: emissão como a documentação ---');
  const charge = (extra: Record<string, unknown> = {}) => ({
    id: 'ch_K2rJ5nlHwTE4qRDP', code: ref, amount: 15000, status: 'pending', payment_method: 'boleto',
    last_transaction: { id: 'tran_1', transaction_type: 'boleto', success: true, status: 'generated', url: 'https://sandbox.pagar.me/Boleto/ViewBoleto.aspx?x', pdf: 'https://api.pagar.me/core/v1/transactions/tran_1/pdf', line: '34191.75462 24615.781234 41234.510000 3 83840000003090', due_at: '2026-11-20T00:00:00Z' },
    ...extra,
  });
  f = provedorFalso([
    [/^\/customers\?document=/, 'GET', () => ({ corpo: { data: [{ id: 'cus_x4nz0P4SbOTA0KBZ', document: '12345678909' }] } })],
    [/^\/orders$/, 'POST', c => ({ corpo: { id: 'or_1', code: (c.corpo as { code: string }).code, status: 'pending', charges: [(c.corpo as { payments: Array<{ payment_method: string }> }).payments[0].payment_method === 'pix'
      ? charge({ payment_method: 'pix', last_transaction: { transaction_type: 'pix', success: true, qr_code: '00020101021226840014br.gov.bcb.pix', qr_code_url: 'https://api.pagar.me/core/v1/transactions/tran_2/qrcode', expires_at: '2026-11-21T02:59:59Z' } })
      : charge()] } })],
  ]);
  let pg = criarAdapterPagarme({ secretKey: 'sk_test_abc', ambiente: amb(f) });
  eq(await pg.acharOuCriarCliente(cliente), 'cus_x4nz0P4SbOTA0KBZ', 'cliente achado pelo documento');
  eq(f.chamadas[0].cabecalhos['authorization'], `Basic ${Buffer.from('sk_test_abc:').toString('base64')}`, 'Basic com a secret key');
  const boleto = await pg.emitir('cus_x', cliente, { referencia: ref, tipo: 'boleto', valor_centavos: 15000, vencimento: '2026-11-20', descricao: 'Pacote', encargos: { juros_am_pct: 1, multa_pct: 2, tolerancia_dias: 0, desconto: null } });
  const corpoBoleto = f.chamadas.at(-1)!.corpo as { code: string; items: Array<{ amount: number }>; payments: Array<{ boleto: Record<string, unknown> }> };
  eq([corpoBoleto.code, corpoBoleto.items[0].amount, corpoBoleto.payments[0].boleto.due_at, 'interest' in corpoBoleto.payments[0].boleto],
    [ref, 15000, '2026-11-20T00:00:00Z', false], 'pedido em centavos, code = referência; conta não-PSP: sem juros no boleto');
  const dadosBoleto = await pg.dadosDePagamento(boleto, 'boleto');
  eq([dadosBoleto.linha_digitavel.length, dadosBoleto.codigo_barras.length, dadosBoleto.pix_copia_cola], [47, 44, ''], 'boleto: linha e código de barras (sem Pix)');
  const pix = await pg.emitir('cus_x', cliente, { referencia: ref, tipo: 'pix', valor_centavos: 15000, vencimento: '2026-11-20', descricao: 'Pacote', encargos: null });
  eq((f.chamadas.at(-1)!.corpo as { payments: Array<{ pix: unknown }> }).payments[0].pix, { expires_at: '2026-11-21T02:59:59Z' }, 'Pix vale até 23h59 de Brasília do vencimento');
  const dadosPix = await pg.dadosDePagamento(pix, 'pix');
  eq([dadosPix.pix_copia_cola.startsWith('000201'), dadosPix.pix_qrcode_url.endsWith('/qrcode'), dadosPix.linha_digitavel], [true, true, ''], 'Pix: copia e cola e imagem do QR');
  e = await erroDe(pg.emitir('cus_x', cliente, { referencia: ref, tipo: 'boleto_pix', valor_centavos: 100, vencimento: '2026-11-20', descricao: 'x', encargos: null }));
  eq(e instanceof ErroProvedor && e.tipo, 'recusa', 'boleto com Pix: não existe no Pagar.me');
  pg = criarAdapterPagarme({ secretKey: 'sk_test_abc', contaPsp: true, ambiente: amb(f) });
  await pg.emitir('cus_x', cliente, { referencia: ref, tipo: 'boleto', valor_centavos: 15000, vencimento: '2026-11-20', descricao: 'Pacote', encargos: { juros_am_pct: 1, multa_pct: 2, tolerancia_dias: 2, desconto: { pct: 5, dias: 3 } } });
  eq((f.chamadas.at(-1)!.corpo as { payments: Array<{ boleto: Record<string, unknown> }> }).payments[0].boleto.interest, { days: 2, type: 'percentage', amount: 1 }, 'conta PSP: juros em %, depois da tolerância');
  eq(encargosPagarme({ juros_am_pct: 0, multa_pct: 0, tolerancia_dias: 0, desconto: { pct: 5, dias: 3 } }, '2026-11-20'), { discount: { type: 'percentage', rules: [{ limit_date: '2026-11-17', amount: 5 }] } }, 'desconto: até N dias antes');

  console.log('--- Pagar.me: falhas e 2ª via ---');
  f = provedorFalso([
    [/^\/orders$/, 'POST', () => ({ corpo: { id: 'or_2', status: 'failed', charges: [charge({ status: 'failed', last_transaction: { success: false, gateway_response: { errors: [{ message: 'Endereço do cliente inválido.' }] } } })] } })],
    [/^\/charges\/ch_1\/due-date$/, 'PATCH', c => ({ corpo: charge({ id: 'ch_1', last_transaction: { ...charge().last_transaction, due_at: (c.corpo as { due_at: string }).due_at } }) })],
    [/^\/charges\?code=/, 'GET', () => ({ corpo: { data: [charge({ id: 'ch_achada' })] } })],
    [/^\/orders$/, 'GET', () => ({ status: 422, corpo: { message: 'The request is invalid.', errors: { 'order.customer.name': ['The name field is required.'] } } })],
  ]);
  pg = criarAdapterPagarme({ secretKey: 'sk_test_abc', ambiente: amb(f) });
  e = await erroDe(pg.emitir('cus_x', cliente, { referencia: ref, tipo: 'boleto', valor_centavos: 100, vencimento: '2026-11-20', descricao: 'x', encargos: null }));
  eq([e instanceof ErroProvedor && e.tipo, e?.message], ['recusa', 'Endereço do cliente inválido.'], 'pedido 200 com cobrança falha: recusa com a frase do Pagar.me');
  eq((await pg.alterar('ch_1', { vencimento: '2026-12-01' }, { referencia: ref, tipo: 'boleto', valor_centavos: 15000, vencimento: '2026-11-20', descricao: 'x', encargos: null })).vencimento, '2026-12-01', 'novo vencimento do boleto');
  e = await erroDe(pg.alterar('ch_1', { valor_centavos: 20000 }, { referencia: ref, tipo: 'boleto', valor_centavos: 15000, vencimento: '2026-11-20', descricao: 'x', encargos: null }));
  eq(e instanceof ErroProvedor && e.tipo, 'recusa', 'valor novo não existe no Pagar.me (o servidor reemite)');
  eq((await pg.consultarPorReferencia(ref))?.id_externo, 'ch_achada', 'consulta pela referência (code)');

  console.log('--- Descrição pelo modelo e códigos para a tela ---');
  const v = { descricao: 'Cruzeiro', parcela: '2/5', agencia: 'Viagens Sol' };
  eq(descricaoPeloModelo('', v), 'Cruzeiro', 'sem modelo: a descrição da conta');
  eq(descricaoPeloModelo('Viagens Sol', v), 'Viagens Sol · Cruzeiro', 'modelo sem marcador: abre a descrição');
  eq(descricaoPeloModelo('{agencia} · {descricao} ({parcela})', v), 'Viagens Sol · Cruzeiro (2/5)', 'marcadores trocados');
  eq(descricaoPeloModelo('{descricao} ({parcela})', { ...v, parcela: '' }), 'Cruzeiro', 'parcela vazia some sem deixar parênteses');
  eq(descricaoPeloModelo('{descricao}', { ...v, pedida: 'Sinal da viagem' }), 'Sinal da viagem', 'texto pedido na hora vence a descrição da conta');
  eq([codigoDoMotivo('Esta conta já tem cobrança emitida.'), codigoDoMotivo('Complete o cadastro do cliente: falta CPF ou CNPJ.'), codigoDoMotivo('A conta já foi recebida.'), codigoDoMotivo('qualquer')],
    ['JA_TEM_COBRANCA', 'CLIENTE_SEM_DOCUMENTO', 'CONTA_QUITADA', null], 'motivo → código');

  console.log('--- Configuração no formato da tela ---');
  const politica = { juros_am_pct: 1, multa_pct: 2, tolerancia_dias: 3, desconto_antecipacao: { pct: 5, dias: 2 } };
  const tela = configParaTela(CONFIG_COBRANCA_PADRAO, politica, [{ plataforma: 'asaas', ativo: true, conta_bancaria_id: 'b1' }]);
  eq([tela.juros_am_pct, tela.multa_pct, tela.desconto_pct, tela.desconto_dias, tela.encargos_da_politica, tela.regua.canais],
    [1, 2, 5, 2, true, { email: true, whatsapp: false }], 'nada gravado: números da política, régua com canais em objeto');
  eq(tela.provedores.map(p => [p.id, p.conectado, p.conta_bancaria_id, p.capacidades.carne]), [['asaas', true, 'b1', true], ['pagarme', false, '', false]], 'provedores conectados e o que cada um faz');
  const gravada = configDaTela(CONFIG_COBRANCA_PADRAO, politica, { juros_am_pct: 1.5, multa_pct: 2, desconto_pct: 0, desconto_dias: 0, regua: { ligada: true, dias: [-3, 0], canais: { email: false, whatsapp: true } }, descricao_modelo: '{descricao}' });
  eq([gravada.usar_politica, gravada.juros_am_pct, gravada.tolerancia_dias, gravada.desconto, gravada.regua, gravada.descricao_modelo],
    [false, 1.5, 3, null, { ligada: true, dias: [-3, 0], canais: ['whatsapp'] }, '{descricao}'], 'gravar com números: próprios da cobrança (tolerância herdada da política)');
  eq(configDaTela(gravada, politica, { usar_politica: true }).usar_politica, true, 'voltar para a política');
  eq(configDaTela(gravada, politica, { provedor_padrao: 'asaas' }).juros_am_pct, 1.5, 'gravar outra coisa não mexe nos encargos');

  console.log('--- Ritmo: 2 chamadas por segundo por agência ---');
  zerarLimitador();
  let relogio = 0;
  const dormidas: Record<string, number> = {};
  const ambLimite = { fetch: (async () => new Response('{}')) as unknown as (u: string, i?: RequestInit) => Promise<Response>, agora: () => relogio, dormir: async (ms: number) => { relogio += 0; dormidas.total = (dormidas.total ?? 0) + ms; }, timeoutMs: 1000 };
  const vezes: Array<[string, number]> = [];
  for (const ag of ['A', 'A', 'A', 'B', 'A', 'B']) {
    const antes = dormidas.total ?? 0;
    await aguardarVez(ag, ambLimite);
    vezes.push([ag, (dormidas.total ?? 0) - antes]);
  }
  eq(vezes, [['A', 0], ['A', 500], ['A', 1000], ['B', 0], ['A', 1500], ['B', 500]], 'cada agência na sua vez, meio segundo entre chamadas; uma não espera a outra');
  zerarLimitador();

  console.log('--- Resposta do CRM ao pedido de envio ---');
  eq(resultadoDoEnvio({ entregue: true, acao: 'cobrança c1: enviada por e-mail' }), { enviado: true, na_fila: false, motivo: '' }, 'CRM mandou: enviado');
  eq(resultadoDoEnvio({ entregue: true, acao: 'cobrança c1: não enviada (o cliente não tem e-mail válido)' }),
    { enviado: false, na_fila: false, motivo: 'o cliente não tem e-mail válido' }, 'CRM recebeu e não mandou: o motivo dele vai para a tela');
  eq(resultadoDoEnvio(null).na_fila, true, 'CRM não respondeu: fica na fila, sem dizer que saiu');
  eq(resultadoDoEnvio({ entregue: false, acao: '' }).enviado, false, 'aviso que não chegou não conta como enviado');

  console.log(`\n${total - falhas}/${total} passaram`);
  if (falhas > 0) process.exit(1);
}

await principal();
