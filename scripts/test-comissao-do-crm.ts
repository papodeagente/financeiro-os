/**
 * As regras puras da comissão calculada pelo CRM e da conta única da
 * comissão (src/lib/comissao-do-crm.ts, src/lib/comissao-conta-unica.ts).
 *
 * O que estes testes guardam:
 *  - o motor de comissão da tela nunca toca uma comissão do CRM e, com a
 *    comissão pelo CRM ligada, não calcula as vendas do CRM (o mesmo
 *    dinheiro não é comissionado duas vezes); venda lançada aqui continua;
 *  - a decisão de cada chegada do CRM (regrava, avisa, cancela, ignora);
 *  - o contrato quebrado é recusado, e não engolido;
 *  - o pagamento escolhe UMA conta, e pagar de novo não baixa de novo.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-comissao-do-crm.ts
 */
import {
  decidirComissaoDoCrm, ehVendaDoCrm, idDaComissaoDoCrm, lerApuracaoDoCrm, montarComissaoDoCrm,
  nomeDaCompetencia, recorteDoMotor, ultimoDiaDaCompetencia,
} from '../src/lib/comissao-do-crm.ts';
import { baixaDaConta, contaParaBaixar } from '../src/lib/comissao-conta-unica.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
function lanca(fn: () => unknown, padrao: RegExp, label: string) {
  total++;
  try {
    fn();
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: erro ${padrao}\n        obtido:   nenhum erro`);
  } catch (e) {
    const ok = padrao.test(e instanceof Error ? e.message : String(e));
    if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${padrao}\n        obtido:   ${String(e)}`); }
    else console.log(`PASS  ${label}`);
  }
}

// ── O motor da tela ─────────────────────────────────────────────────────
console.log('--- (d) o que o motor de comissão pode tocar ---');
const vendas = [
  { id: 'crmv-agencia-a-crm_deal_1', status: 'CONFIRMADO' },               // do CRM, id novo
  { id: 'k3j2h1', status: 'CONFIRMADO', origem: 'crm', crm_venda_id: 'crm_deal_2' }, // do CRM, id antigo
  { id: 'v-manual', status: 'CONFIRMADO' },                                 // lançada aqui
];
const comissoes = [
  { id: 'comissao-crm-7-2026-09', venda_id: 'crm-competencia-2026-09', status: 'CALCULADA', origem: 'crm' },
  { id: 'comissao-crm-8-2026-09', venda_id: 'crm-competencia-2026-09', status: 'APROVADA', origem: 'crm' },
  { id: 'c-crm-antiga', venda_id: 'crmv-agencia-a-crm_deal_1', status: 'CALCULADA' },
  { id: 'c-crm-paga', venda_id: 'k3j2h1', status: 'PAGA' },
  { id: 'c-manual', venda_id: 'v-manual', status: 'CALCULADA' },
];
{
  const sem = recorteDoMotor(comissoes, vendas, false);
  eq(sem.paraConciliar.map(c => c.id), ['c-crm-antiga', 'c-crm-paga', 'c-manual'], 'sem a marca: a comissão do CRM nunca entra na conciliação (seria cancelada como "venda removida")');
  eq(sem.comissoesDoMotor.map(c => c.id), ['c-crm-antiga', 'c-crm-paga', 'c-manual'], 'nem no recálculo');
  eq(sem.vendasParaCalcular.map(v => v.id), vendas.map(v => v.id), 'sem a marca, todas as vendas continuam no motor, como antes');
  eq(sem.anterioresEmVendaDoCrm, [], 'e nada a conferir');

  const com = recorteDoMotor(comissoes, vendas, true);
  eq(com.vendasParaCalcular.map(v => v.id), ['v-manual'], 'com a comissão pelo CRM: só a venda lançada aqui é calculada pelos planos');
  eq(com.paraConciliar.map(c => c.id), ['c-crm-antiga', 'c-crm-paga', 'c-manual'], 'a comissão do CRM continua fora da conciliação');
  eq(com.comissoesDoMotor.map(c => c.id), ['c-manual'], 'e o recálculo só compara a da venda daqui');
  eq(com.anterioresEmVendaDoCrm.map(c => c.id), ['c-crm-antiga'], 'a calculada aqui sobre venda do CRM, ainda não paga, vai para conferência');
}
{
  eq([ehVendaDoCrm({ id: 'crmv-x' }), ehVendaDoCrm({ id: 'abc', origem: 'crm' }), ehVendaDoCrm({ id: 'abc', crm_venda_id: 'crm_deal_9' }), ehVendaDoCrm({ id: 'abc' })],
    [true, true, true, false], 'venda do CRM: id crmv-, a marca de origem, ou o id do negócio');
}

// ── O contrato ──────────────────────────────────────────────────────────
console.log('\n--- o contrato COMISSAO_APURADA v1 ---');
const payload = (o: Record<string, unknown> = {}) => ({
  versao_contrato: 1, competencia: '2026-09', vendedor_id: 'crm_user_7', vendedor_nome: ' Ana ', vendedor_email: 'ANA@X.COM',
  valor_comissao: 420.004, valor_base: '3500.5', linhas: [{ conta_id: '11', conta_nome: 'Sol', dia: '2026-09-05T10:00:00Z', valor: 2000, plano: 'Mensal', percentual: 12, comissao: 240, negociacao_id: 'crm_deal_91', provedor: null, transacao: null }],
  apurado_em: '2026-10-01T03:00:00.000Z', ...o,
});
{
  const ap = lerApuracaoDoCrm(payload());
  eq([ap.vendedor_nome, ap.vendedor_email, ap.valor_comissao, ap.valor_base, ap.linhas[0].conta_id, ap.linhas[0].dia], ['Ana', 'ana@x.com', 420, 3500.5, 11, '2026-09-05'], 'lê, arredonda e normaliza');
  eq(lerApuracaoDoCrm(payload({ versao_contrato: undefined })).versao_contrato, 1, 'sem versão é a 1');
  lanca(() => lerApuracaoDoCrm(payload({ versao_contrato: 2 })), /não suportada/, 'versão desconhecida é recusada');
  lanca(() => lerApuracaoDoCrm(payload({ competencia: '2026-13' })), /AAAA-MM/, 'mês inválido é recusado');
  lanca(() => lerApuracaoDoCrm(payload({ vendedor_id: '' })), /vendedor_id/, 'sem vendedor é recusado');
  lanca(() => lerApuracaoDoCrm(payload({ valor_comissao: 'abc' })), /valor_comissao/, 'valor que não é número é recusado');
  lanca(() => lerApuracaoDoCrm(payload({ valor_comissao: -1 })), /negativo/, 'valor negativo é recusado');
  eq([idDaComissaoDoCrm('crm_user_7', '2026-09'), idDaComissaoDoCrm('crm_user_7/../x', '2026-09')], ['comissao-crm-7-2026-09', 'comissao-crm-7x-2026-09'], 'o id é o do usuário no CRM e o mês, sem caractere estranho');
  eq([ultimoDiaDaCompetencia('2026-09'), ultimoDiaDaCompetencia('2028-02'), nomeDaCompetencia('2026-03')], ['2026-09-30', '2028-02-29', 'março de 2026'], 'último dia do mês (com bissexto) e o nome do mês');
}

// ── A decisão ───────────────────────────────────────────────────────────
console.log('\n--- a decisão de cada chegada ---');
const HOJE = '2026-10-08';
const nova = (o: Record<string, unknown> = {}) =>
  montarComissaoDoCrm(lerApuracaoDoCrm(payload({ vendedor_nome: 'Ana', ...o })), { id: 'u-ana' }, 'ev-x');
{
  const n = nova();
  eq([n.status, n.origem, n.venda_id, n.data_venda, n.percentual_aplicado], ['CALCULADA', 'crm', 'crm-competencia-2026-09', '2026-09-30', 12], 'a comissão montada é do mês, CALCULADA, com o percentual efetivo');
  eq(decidirComissaoDoCrm(null, n, HOJE).tipo, 'gravar', 'sem comissão: cria');
  eq(decidirComissaoDoCrm(null, nova({ valor_comissao: 0 }), HOJE).tipo, 'nada', 'zero sem comissão: nada');

  const calculada = { ...n, observacoes: 'nota antiga' };
  const regrava = decidirComissaoDoCrm(calculada, nova({ valor_comissao: 380, apurado_em: '2026-10-05T00:00:00Z' }), HOJE);
  eq([regrava.tipo, regrava.tipo === 'gravar' && regrava.comissao.valor_comissao, regrava.tipo === 'gravar' && /nota antiga \| Atualizada/.test(regrava.comissao.observacoes)], ['gravar', 380, true], 'CALCULADA: regrava, guardando a nota anterior');
  eq(decidirComissaoDoCrm(calculada, nova(), HOJE).tipo, 'nada', 'mesmo conteúdo: nada');
  eq(decidirComissaoDoCrm(calculada, nova({ valor_comissao: 1, apurado_em: '2026-09-01T00:00:00Z' }), HOJE).tipo, 'nada', 'apuração mais antiga: ignorada');
  const zera = decidirComissaoDoCrm(calculada, nova({ valor_comissao: 0 }), HOJE);
  eq([zera.tipo, zera.tipo === 'cancelar' && zera.comissao.status, zera.tipo === 'cancelar' && zera.comissao.cancelada_pelo_crm], ['cancelar', 'CANCELADA', true], 'CALCULADA zerada: cancela, marcando que foi o CRM');

  for (const status of ['APROVADA', 'PAGA'] as const) {
    const d = decidirComissaoDoCrm({ ...n, status }, nova({ valor_comissao: 450 }), HOJE);
    eq([d.tipo, d.tipo === 'avisar' && d.diferenca, d.tipo === 'avisar' && /420,00 para R\$\s450,00/.test(d.aviso.titulo)], ['avisar', 30, true], `${status} com valor novo: não regrava, avisa com os dois valores e a diferença`);
    eq(decidirComissaoDoCrm({ ...n, status }, nova({ valor_base: 9999 }), HOJE).tipo, 'nada', `${status} com o mesmo valor: nada`);
  }
  eq(decidirComissaoDoCrm({ ...n, status: 'APROVADA' }, nova({ valor_comissao: 0 }), HOJE).tipo, 'cancelar', 'APROVADA zerada (ainda não paga): cancela');
  eq(decidirComissaoDoCrm({ ...n, status: 'PAGA' }, nova({ valor_comissao: 0 }), HOJE).tipo, 'avisar', 'PAGA zerada: não cancela, avisa');
  eq(decidirComissaoDoCrm({ ...n, status: 'CANCELADA', cancelada_pelo_crm: true }, nova({ valor_comissao: 50 }), HOJE).tipo, 'gravar', 'cancelada pelo CRM, com valor de novo: reabre');
  eq(decidirComissaoDoCrm({ ...n, status: 'CANCELADA' }, nova({ valor_comissao: 50 }), HOJE).tipo, 'avisar', 'cancelada por uma pessoa: não reabre, avisa');
  const textos = [regrava, zera, decidirComissaoDoCrm({ ...n, status: 'PAGA' }, nova({ valor_comissao: 0 }), HOJE)]
    .map(d => d.acao + ('aviso' in d && d.aviso ? d.aviso.titulo + d.aviso.descricao : '')).join(' ');
  eq(/—/.test(textos), false, 'sem travessão nos textos');
}

// ── A conta que o pagamento baixa ───────────────────────────────────────
console.log('\n--- (a) qual conta o pagamento baixa ---');
{
  const legada = { id: 'pagar-c1', status: 'PENDENTE', valor_final: 300 };
  const nova_ = { id: 'cp-comissao-c1', status: 'PENDENTE', valor_final: 300 };
  eq(contaParaBaixar(legada, nova_)?.conta.id, 'pagar-c1', 'a antiga viva é a conta da comissão');
  eq(contaParaBaixar({ ...legada, status: 'CANCELADO' }, nova_)?.conta.id, 'cp-comissao-c1', 'a antiga cancelada não conta');
  eq(contaParaBaixar(null, nova_)?.qual, 'nova', 'sem antiga, a do gancho');
  eq(contaParaBaixar(null, { ...nova_, status: 'CANCELADO' }), null, 'nenhuma viva: quem chama cria');
  eq(baixaDaConta({ ...nova_, valor_final: '300.5' }, HOJE), { ...nova_, valor_final: '300.5', status: 'PAGO', data_pagamento: HOJE, valor_pago: 300.5 }, 'a baixa é do valor da conta');
  eq(baixaDaConta({ ...nova_, status: 'PAGO' }, HOJE), null, 'conta já paga não é baixada de novo');
}

console.log(`\n${total - falhas}/${total} testes da comissão do CRM (regras puras) passaram`);
if (falhas > 0) process.exit(1);
