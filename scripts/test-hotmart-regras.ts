/**
 * Regras da Hotmart (src/lib/plataformas/hotmart-regras.ts).
 *
 * O que estes testes guardam: cobrança que ninguém pagou nunca vira conta a
 * receber; venda parcelada é um recebimento só; o status nunca volta para
 * trás; e a revisão não mexe em conta que uma pessoa tocou.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-hotmart-regras.ts
 */
import { proximoStatusHotmart, statusHotmartAtual, unificarParcelasHotmart, planoHotmart, situacaoDaTransacao, AVISO_HOTMART } from '../src/lib/plataformas/hotmart-regras.ts';
import { montarParcelas } from '../src/lib/plataformas/comum.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

console.log('--- o ciclo só anda para a frente ---');
eq(proximoStatusHotmart('RECEBIDO', 'CONFIRMADO'), 'RECEBIDO', '"aprovado" atrasado não desfaz o "concluído"');
eq(proximoStatusHotmart('CONFIRMADO', 'AGUARDANDO'), 'CONFIRMADO', 'boleto gerado de novo não reabre venda paga');
eq(proximoStatusHotmart('CONFIRMADO', 'CANCELADO'), 'CONFIRMADO', 'expiração atrasada não cancela venda paga');
eq(proximoStatusHotmart('CONFIRMADO', 'RECEBIDO'), 'RECEBIDO', 'aprovado anda para liberado');
eq(proximoStatusHotmart('RECEBIDO', 'ESTORNADO'), 'ESTORNADO', 'reembolso vence liberado');
eq(proximoStatusHotmart('ESTORNADO', 'RECEBIDO'), 'ESTORNADO', 'e não é desfeito por aviso atrasado');
eq(proximoStatusHotmart('AGUARDANDO', 'CONFIRMADO'), 'CONFIRMADO', 'boleto pago anda para aprovado');
eq(proximoStatusHotmart('AGUARDANDO', 'CANCELADO'), 'CANCELADO', 'boleto expirado fica cancelado');
eq(proximoStatusHotmart('CANCELADO', 'AGUARDANDO'), 'CANCELADO', 'e boleto gerado depois não ressuscita');
eq(proximoStatusHotmart('CANCELADO', 'CONFIRMADO'), 'CONFIRMADO', 'mas dinheiro que entrou vence a expiração');
eq(proximoStatusHotmart(undefined, 'AGUARDANDO'), 'AGUARDANDO', 'primeiro aviso define o status');
eq([statusHotmartAtual('PENDENTE'), statusHotmartAtual('ATRASADO'), statusHotmartAtual('CONFIRMADO')], ['AGUARDANDO', 'AGUARDANDO', 'CONFIRMADO'], 'status antigos de cobrança não paga viram AGUARDANDO');

console.log('--- venda parcelada vira um recebimento ---');
const seis = montarParcelas({ total: 937.5, taxaTotal: 93.75, quantidade: 6, status: 'RECEBIDO', primeiroVencimento: '2026-09-28', dataPagamento: '2026-09-28', dataRecebimento: '2026-10-05', idBase: 'HP6' });
{
  const [u] = unificarParcelasHotmart(seis, '2026-10-05');
  eq([u.numero, u.total, u.valor_bruto, u.valor_taxa, u.valor_liquido], [1, 1, 937.5, 93.75, 843.75], 'valores somados sem perder centavo');
  eq([u.status, u.data_vencimento, u.data_prevista_recebimento, u.data_recebimento], ['RECEBIDO', '2026-09-28', '2026-10-05', '2026-10-05'], 'datas da primeira, previsão no fim da garantia');
  const pend = montarParcelas({ total: 247, quantidade: 1, status: 'PENDENTE', primeiroVencimento: '2026-10-06' });
  eq(unificarParcelasHotmart(pend)[0].status, 'AGUARDANDO', 'cobrança antiga não paga vira AGUARDANDO');
  eq(unificarParcelasHotmart([]), [], 'sem parcelas, sem recebimento');
}

console.log('--- o plano de revisão ---');
const conta = (id: string, numero: number, status: string, tocada: string | null = null) => ({ id, numero, status, valor_recebido: 0, tocada_por_humano: tocada });
{
  // O caso da Latitude Sul: boleto/Pix gerado, ninguém pagou, conta aberta.
  const p = planoHotmart(montarParcelas({ total: 247, quantidade: 1, status: 'PENDENTE', primeiroVencimento: '2026-10-06', idBase: 'HPL' }), [conta('plat-hotmart-HPL-1', 1, 'PENDENTE')], {});
  eq([p.em_dia, p.pulada, p.parcela?.status, p.motivos], [false, null, 'AGUARDANDO', ['NAO_PAGA']], 'cobrança não paga com conta aberta: corrigir');
}
{
  const contas = [1, 2, 3, 4, 5, 6].map(n => conta(`plat-hotmart-HP6-${n}`, n, 'RECEBIDO'));
  const cred = Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [String(n), 140.62]));
  const p = planoHotmart(seis, contas, cred);
  eq([p.conta_principal, p.cancelar.length, p.motivos], ['plat-hotmart-HP6-1', 5, ['PARCELAS_UNIFICADAS']], '6 parcelas: a 1 fica, as outras 5 saem');
  eq(p.creditado, 843.72, 'o caixa já creditado soma todas as parcelas');
}
{
  const um = montarParcelas({ total: 100, quantidade: 1, status: 'RECEBIDO', primeiroVencimento: '2026-09-01', idBase: 'HPX' });
  const p = planoHotmart(um, [conta('plat-hotmart-HPX', 1, 'RECEBIDO'), conta('plat-hotmart-HPX-1', 1, 'RECEBIDO')], { '1': 100 });
  eq([p.conta_principal, p.cancelar, p.motivos], ['plat-hotmart-HPX-1', ['plat-hotmart-HPX'], ['DUPLICATA_DA_CONTA_ANTIGA']], 'conta antiga duplicada é cancelada, fica a numerada');
}
{
  const um = montarParcelas({ total: 100, quantidade: 1, status: 'CONFIRMADO', primeiroVencimento: '2026-09-01' });
  const p = planoHotmart(um, [conta('plat-hotmart-HPY-1', 1, 'PENDENTE')], {});
  eq([p.em_dia, p.cancelar], [true, []], 'transação no formato novo está em dia');
}
{
  const p = planoHotmart(montarParcelas({ total: 247, quantidade: 1, status: 'PENDENTE', primeiroVencimento: '2026-10-06' }), [conta('plat-hotmart-HPM-1', 1, 'RECEBIDO', 'baixada à mão')], {});
  eq([p.pulada, p.cancelar], ['plat-hotmart-HPM-1: baixada à mão', []], 'conta baixada à mão: a transação é pulada e listada');
}

console.log('--- a situação mostrada na tela ---');
const fmt = (iso: string) => iso.split('-').reverse().join('/');
eq(situacaoDaTransacao(montarParcelas({ total: 1, quantidade: 1, status: 'AGUARDANDO', primeiroVencimento: '2026-10-06' }), fmt).codigo, 'aguardando', 'cobrança gerada: aguardando o cliente pagar');
eq(situacaoDaTransacao(montarParcelas({ total: 1, quantidade: 1, status: 'AGUARDANDO', primeiroVencimento: '2026-10-06' }), fmt).conta_a_receber, false, 'e não é conta a receber');
eq(situacaoDaTransacao(montarParcelas({ total: 1, quantidade: 1, status: 'CONFIRMADO', primeiroVencimento: '2026-10-01', primeiraPrevisao: '2026-10-08' }), fmt).rotulo, 'Paga, em garantia até 08/10/2026', 'paga diz até quando fica na garantia');
eq(situacaoDaTransacao(montarParcelas({ total: 1, quantidade: 1, status: 'RECEBIDO', primeiroVencimento: '2026-10-01' }), fmt).codigo, 'liberada', 'concluída é liberada');
eq(situacaoDaTransacao(montarParcelas({ total: 1, quantidade: 1, status: 'ESTORNADO', primeiroVencimento: '2026-10-01' }), fmt).codigo, 'reembolsada', 'reembolso tem situação própria');
eq(AVISO_HOTMART.PURCHASE_BILLET_PRINTED, 'Boleto ou Pix gerado (ainda não pago)', 'o aviso de boleto gerado diz que não foi pago');

console.log(`\n${total - falhas}/${total} testes das regras da Hotmart passaram`);
if (falhas > 0) process.exit(1);
