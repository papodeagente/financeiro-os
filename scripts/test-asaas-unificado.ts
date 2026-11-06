/**
 * Conexão Asaas unificada entre CRM e Financeiro (E7, 06/11/2026): as regras
 * puras de src/lib/asaas-unificado/regras.ts.
 *
 * - o que o CRM pode pedir pelo Financeiro (lista fechada) e o que é recusado;
 * - de quem é uma referência (p2;/c1; do CRM, f1; do Financeiro);
 * - idempotência pela referência (cobrança e cliente já criados);
 * - o aviso do Financeiro no Asaas (achado pelo endereço da agência);
 * - o plano: unificar só com a MESMA conta, o aviso daqui ativo, e o que
 *   muda escrito em frases; assinatura muda quando a situação muda.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-asaas-unificado.ts
 */
import {
  acharAvisoDoFinanceiro, clienteQueJaAtende, cobrancaQueJaAtende, empresaDaReferenciaDoCrm, ehReferenciaDoCrm, EVENTOS_QUE_O_CRM_USA,
  lerOperacao, planoDaUnificacao, referenciaDaEmpresa,
  type LadoDoCrm, type LadoDoFinanceiro,
} from '../src/lib/asaas-unificado/regras.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

// ── Referências ──────────────────────────────────────────────────────────
eq([
  empresaDaReferenciaDoCrm('p2;t=420001;pp=55'),
  empresaDaReferenciaDoCrm('p2;t=420001;prop=9'),
  empresaDaReferenciaDoCrm('c1;t=7;cliente'),
  empresaDaReferenciaDoCrm('c1;t=7'),
  empresaDaReferenciaDoCrm('f1;agencia-a;cob_1'),
  empresaDaReferenciaDoCrm('p1;420001;5'),
  empresaDaReferenciaDoCrm(''),
  empresaDaReferenciaDoCrm(null),
], [420001, 420001, 7, 7, null, null, null, null], 'p2;/c1; são do CRM (com a empresa); f1; é do Financeiro; o resto não é de ninguém daqui');
eq([ehReferenciaDoCrm('c1;t=7;x'), ehReferenciaDoCrm('f1;a;b')], [true, false], 'ehReferenciaDoCrm');
eq([referenciaDaEmpresa('p2;t=1;pp=2', 1), referenciaDaEmpresa('p2;t=1;pp=2', 2), referenciaDaEmpresa('p2;t=1;pp=2', null)], [true, false, true],
  'referência de outra empresa do CRM é recusada; sem a empresa conhecida, vale qualquer referência do CRM');

// ── O que o CRM pode pedir ───────────────────────────────────────────────
const cobranca = { customer: 'cus_123', billingType: 'PIX', dueDate: '2026-11-10', value: 150, description: 'Sinal', externalReference: 'p2;t=7;pp=55' };
const ok = (p: unknown, e: number | null = 7) => { const r = lerOperacao(p, e); return r.ok ? r.op.tipo : `recusa: ${r.motivo}`; };
eq(ok({ metodo: 'POST', caminho: '/payments', corpo: cobranca }), 'criar_cobranca', 'criar cobrança com a referência do CRM');
eq(ok({ metodo: 'POST', caminho: '/payments', corpo: { ...cobranca, externalReference: 'f1;agencia;cob' } }).startsWith('recusa'), true,
  'o CRM nunca cria cobrança com a referência do Financeiro (ela daria baixa aqui)');
eq(ok({ metodo: 'POST', caminho: '/payments', corpo: { ...cobranca, externalReference: 'p2;t=8;pp=55' } }).startsWith('recusa'), true, 'nem com a referência de outra empresa do CRM');
eq(ok({ metodo: 'POST', caminho: '/payments', corpo: { ...cobranca, billingType: 'UNDEFINED' } }).startsWith('recusa'), true, 'forma que o CRM não usa');
eq(ok({ metodo: 'POST', caminho: '/payments', corpo: { ...cobranca, value: 0 } }).startsWith('recusa'), true, 'cobrança sem valor');
eq(ok({ metodo: 'POST', caminho: '/payments', corpo: { ...cobranca, value: undefined, installmentCount: 3, totalValue: 300 } }), 'criar_cobranca', 'parcelado no cartão (totalValue)');
eq(ok({ metodo: 'POST', caminho: '/customers', corpo: { name: 'Ana', cpfCnpj: '12345678901', externalReference: 'c1;t=7;cliente' } }), 'criar_cliente', 'criar cliente');
eq(ok({ metodo: 'POST', caminho: '/customers', corpo: { name: 'Ana', cpfCnpj: '123', externalReference: 'c1;t=7;cliente' } }).startsWith('recusa'), true, 'cliente sem CPF/CNPJ válido');
eq([
  ok({ metodo: 'GET', caminho: '/payments/pay_abc123' }),
  ok({ metodo: 'GET', caminho: '/payments/pay_abc123/identificationField' }),
  ok({ metodo: 'GET', caminho: '/payments/pay_abc123/pixQrCode' }),
  ok({ metodo: 'DELETE', caminho: '/payments/pay_abc123' }),
  ok({ metodo: 'GET', caminho: '/payments?installment=ins_abc123&limit=100' }),
], ['ler_cobranca', 'linha_do_boleto', 'pix', 'cancelar', 'parcelas'], 'as leituras e o cancelamento que as propostas usam');
eq([
  ok({ metodo: 'GET', caminho: '/finance/balance' }),
  ok({ metodo: 'POST', caminho: '/transfers', corpo: {} }),
  ok({ metodo: 'GET', caminho: '/webhooks' }),
  ok({ metodo: 'PUT', caminho: '/payments/pay_abc123', corpo: {} }),
  ok({ metodo: 'POST', caminho: '/payments/pay_abc123/refund', corpo: {} }),
  ok({ metodo: 'GET', caminho: '/payments?externalReference=f1;x;y' }),
  ok({ metodo: 'GET', caminho: '/payments?installment=ins_abc123&customer=cus_1' }),
  ok({ metodo: 'GET', caminho: '/payments/../finance/balance' }),
].every(r => r.startsWith('recusa')), true, 'saldo, transferência, avisos, alterar, estornar e listas abertas ficam de fora');

// ── Idempotência pela referência ─────────────────────────────────────────
const viva = { id: 'pay_1', externalReference: 'p2;t=7;pp=55', billingType: 'PIX', dueDate: '2026-11-10', status: 'PENDING' };
eq(cobrancaQueJaAtende([viva], cobranca)?.id, 'pay_1', 'pedido repetido (timeout, clique duplo) acha a cobrança viva');
eq(cobrancaQueJaAtende([{ ...viva, deleted: true }], cobranca), null, 'cobrança removida não atende: o CRM trocou PIX por cartão e pede outra');
eq(cobrancaQueJaAtende([{ ...viva, billingType: 'CREDIT_CARD' }], cobranca), null, 'outra forma não atende');
eq(cobrancaQueJaAtende([{ ...viva, status: 'RECEIVED' }], cobranca), null, 'paga não atende');
eq(cobrancaQueJaAtende([{ ...viva, dueDate: '2026-11-11' }], cobranca), null, 'outro vencimento não atende');
eq(clienteQueJaAtende([{ id: 'cus_1', externalReference: 'c1;t=7;cliente' }, { id: 'cus_2', externalReference: 'outra' }], { externalReference: 'c1;t=7;cliente' })?.id, 'cus_1', 'cliente do mesmo CPF e da mesma referência é reaproveitado');
eq(clienteQueJaAtende([{ id: 'cus_2', externalReference: 'outra' }], { externalReference: 'c1;t=7;cliente' }), null, 'cliente com o mesmo CPF de outro sistema não é reaproveitado');

// ── O aviso daqui no Asaas ───────────────────────────────────────────────
const avisos = [
  { id: 'wh_crm', url: 'https://crm.enturos.com/api/webhooks/asaas-agencia/abc', enabled: true, events: ['PAYMENT_RECEIVED'] },
  { id: 'wh_fin', url: 'https://fin.enturos.com/api/v1/plataformas/asaas/agencia-a/', enabled: true, interrupted: false, events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'] },
  { id: 'wh_outra', url: 'https://fin.enturos.com/api/v1/plataformas/asaas/agencia-b', enabled: true, events: [] },
];
eq(acharAvisoDoFinanceiro(avisos, 'agencia-a')?.id, 'wh_fin', 'acha o aviso pelo endereço desta agência (barra final tolerada)');
eq(acharAvisoDoFinanceiro(avisos, 'agencia-c'), null, 'endereço de outra agência não serve');

// ── O plano ──────────────────────────────────────────────────────────────
const fin: LadoDoFinanceiro = {
  conectado: true, ambiente: 'producao', carteira: 'wal_1', erro: null,
  aviso: { id: 'wh_fin', url: 'x', ativo: true, interrompido: false, eventos: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'] },
};
const crm: LadoDoCrm = { situacao: 'ok', detalhe: '', conectado: true, ambiente: 'producao', chave_final: 'ab12', carteira: 'wal_1', aviso_automatico: true, pelo_financeiro: false };
const p = planoDaUnificacao(fin, crm, null);
eq(p.situacao, 'pode_unificar', 'mesma conta, aviso ativo: pode unificar');
eq(p.eventos_a_incluir, EVENTOS_QUE_O_CRM_USA.filter(e => e !== 'PAYMENT_RECEIVED' && e !== 'PAYMENT_CONFIRMED'), 'o aviso daqui passa a avisar o que falta para o CRM');
eq([p.passos.some(x => x.includes('wal_1')), p.passos.some(x => x.includes('final ab12')), p.passos.some(x => x.includes('desligado (não apagado)')), p.passos.some(x => x.includes('Desfazer'))],
  [true, true, true, true], 'os passos dizem a conta, a chave que fica guardada, o aviso do CRM desligado e que dá para desfazer');
eq(planoDaUnificacao(fin, { ...crm, aviso_automatico: false }, null).passos.some(x => x.includes('cadastrado à mão')), true, 'aviso do CRM cadastrado à mão: a pessoa desliga no painel');
const outra = planoDaUnificacao(fin, { ...crm, carteira: 'wal_2' }, null);
eq([outra.situacao, outra.bloqueios.some(b => b.includes('contas Asaas diferentes'))], ['bloqueado', true], 'contas diferentes: bloqueado (as cobranças cairiam em outra conta)');
eq(planoDaUnificacao(fin, { ...crm, carteira: null }, null).situacao, 'bloqueado', 'carteira que não veio: não dá para confirmar, bloqueado');
eq(planoDaUnificacao(fin, { ...crm, ambiente: 'sandbox' }, null).bloqueios.some(b => b.includes('teste')), true, 'chave de teste de um lado e de produção do outro: bloqueado');
eq(planoDaUnificacao({ ...fin, aviso: null }, crm, null).bloqueios.some(b => b.includes('não está cadastrado')), true, 'sem o aviso daqui no Asaas: bloqueado, com o que fazer');
eq(planoDaUnificacao({ ...fin, aviso: { ...fin.aviso!, interrompido: true } }, crm, null).situacao, 'bloqueado', 'fila do aviso daqui interrompida: bloqueado');
eq(planoDaUnificacao({ ...fin, conectado: false }, crm, null).situacao, 'nada_a_fazer', 'Asaas só no CRM: nada a fazer aqui (a tela diz para conectar aqui)');
eq(planoDaUnificacao(fin, { ...crm, conectado: false }, null).situacao, 'nada_a_fazer', 'CRM sem Asaas: nada a unificar (agência que só usa o CRM continua igual)');
eq(planoDaUnificacao(fin, { ...crm, situacao: 'sem_integracao', detalhe: 'x' }, null).situacao, 'nada_a_fazer', 'sem integração com o CRM: nada a fazer');
eq(planoDaUnificacao(fin, { ...crm, situacao: 'indisponivel', detalhe: 'O CRM demorou' }, null).bloqueios, ['O CRM demorou'], 'CRM fora do ar: bloqueado com o motivo');
const ja = planoDaUnificacao(fin, crm, { ativo: true, desde: '2026-11-06T12:00:00Z', aplicado_por_nome: 'Ana', eventos_incluidos: ['PAYMENT_OVERDUE'], aviso_do_crm: 'desligado' });
eq([ja.situacao, ja.eventos_a_incluir, ja.passos.some(x => x.includes('PAYMENT_OVERDUE'))], ['unificado', [], true], 'unificado: o plano é o do Desfazer, com os eventos que voltam');
eq(p.assinatura === planoDaUnificacao(fin, crm, null).assinatura, true, 'mesma situação, mesma assinatura');
eq(p.assinatura === planoDaUnificacao({ ...fin, aviso: { ...fin.aviso!, eventos: [...EVENTOS_QUE_O_CRM_USA] } }, crm, null).assinatura, false, 'situação mudou, assinatura muda (aplicar exige conferir de novo)');

console.log(`\n${total - falhas}/${total} testes da conexão Asaas unificada passaram`);
if (falhas > 0) process.exit(1);
