/**
 * O lado do fornecedor (E5, parte C), lógica pura: regra de faturamento com
 * corte, vencimento e feriado; acordos com vigência (o da data da venda);
 * Taxa CC DU/RAV; linhas da fatura com o que o cliente já pagou; sinal
 * compensado; comissão esperada × recebida.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-fornecedor.ts
 */
import { normalizarVenda, type Venda } from '../src/lib/venda-modelo.ts';
import { posicaoDaVenda } from '../src/lib/venda-posicao.ts';
import { contasDaVenda } from '../src/lib/venda-contas.ts';
import {
  normalizarRegra, corteDe, periodoDe, vencimentoDoCorte, proximasFaturas, ultimoCortePassado, dataBaseDoItem, descreverRegra,
} from '../src/lib/fornecedor-regra.ts';
import {
  normalizarAcordo, acordoVigente, conflitosDeVigencia, aplicarAcordosNaVenda, esperadoDoProduto, alterarTaxaCCDoProduto,
  taxasDoProduto, ladoDaTaxaCC, type AcordoComFornecedor,
} from '../src/lib/fornecedor-acordos.ts';
import { itemAFaturar, planejarCompensacao, previaDaFatura, refletirContaFaturada, saldoDoSinal, pagoDaFatura, receitasDoItem } from '../src/lib/fornecedor-fatura.ts';
import { comissoesPorOperadora } from '../src/lib/fornecedor-comissao.ts';

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
function erro(fn: () => unknown): string {
  try { fn(); return ''; } catch (e) { return (e as { codigo?: string }).codigo ?? String(e); }
}

console.log('--- Regra de faturamento: corte, vencimento, feriado ---');
const r25x15 = normalizarRegra({ dia_corte: 25, dia_vencimento: 15 });
eq(corteDe('2026-10-20', r25x15), '2026-10-25', 'antes do corte: o corte do mês');
eq(corteDe('2026-10-25', r25x15), '2026-10-25', 'no dia do corte: o próprio');
eq(corteDe('2026-10-26', r25x15), '2026-11-25', 'depois do corte: o do mês seguinte');
eq(periodoDe('2026-11-03', r25x15).inicio, '2026-10-26', 'período começa no dia seguinte ao corte anterior');
const v = vencimentoDoCorte('2026-10-25', r25x15);
eq([v.pela_regra, v.data, v.motivo_ajuste], ['2026-11-15', '2026-11-16', 'Proclamação da República'], 'vence 15/11 (feriado e domingo): adia para segunda 16/11');
eq(vencimentoDoCorte('2026-10-25', { ...r25x15, ajuste_vencimento: 'anterior' }).data, '2026-11-13', 'antecipar: sexta 13/11');
eq(vencimentoDoCorte('2026-10-25', { ...r25x15, ajuste_vencimento: 'nenhum' }).data, '2026-11-15', 'sem ajuste: fica no feriado');
const r10x25 = normalizarRegra({ dia_corte: 10, dia_vencimento: 25 });
eq(vencimentoDoCorte('2026-11-10', r10x25).pela_regra, '2026-11-25', 'vencimento depois do corte: mesmo mês');
const r31 = normalizarRegra({ dia_corte: 31, dia_vencimento: 31 });
eq([corteDe('2026-02-10', r31), vencimentoDoCorte('2026-02-28', r31).pela_regra], ['2026-02-28', '2026-03-31'], 'dia 31: último dia do mês (fevereiro 28)');
eq(vencimentoDoCorte('2026-12-25', normalizarRegra({ dia_corte: 25, dia_vencimento: 1 })).data, '2027-01-04', 'vence 01/01 (Confraternização, sexta): segunda 04/01... sábado e domingo pulados');
eq(proximasFaturas('2026-11-05', r25x15, 3).map(p => [p.inicio, p.corte, p.vencimento.data]), [
  ['2026-10-26', '2026-11-25', '2026-12-15'], ['2026-11-26', '2026-12-25', '2027-01-15'], ['2026-12-26', '2027-01-25', '2027-02-15'],
], 'prévia das próximas 3 faturas');
eq(ultimoCortePassado('2026-11-05', r25x15), '2026-10-25', 'último corte que passou');
eq(ultimoCortePassado('2026-11-25', r25x15), '2026-11-25', 'hoje é dia de corte: ele mesmo');
eq(dataBaseDoItem({ data_venda: '2026-10-01', data_inicio: '2026-12-20' }, { ...r25x15, data_base: 'inicio' }), '2026-12-20', 'data base: início da viagem');
eq(dataBaseDoItem({ data_venda: '2026-10-01' }, { ...r25x15, data_base: 'fim' }), '2026-10-01', 'sem a data da viagem: a da venda');
eq(normalizarRegra({ dia_corte: 99, ajuste_vencimento: 'x' }), { periodicidade: 'MENSAL', inicio_semana: 1, prazo_dias: 7, dia_corte: 25, dia_vencimento: 10, ajuste_vencimento: 'proximo', data_base: 'venda', gerar_sozinha: false, prazo_pagamento_dias: 30 }, 'regra inválida cai no padrão (mensal)');
eq(normalizarRegra({ dia_corte: 25, dia_vencimento: 15 }).periodicidade, 'MENSAL', 'cadastro antigo, sem periodicidade: continua mensal');
eq(descreverRegra(r25x15), 'Corte dia 25; vence dia 15 do mês seguinte, adiado para o próximo dia útil.', 'regra por extenso');

console.log('--- Regra do fornecedor: diária, semanal, decendial e quinzenal ---');
const sem = normalizarRegra({ periodicidade: 'SEMANAL', inicio_semana: 1, prazo_dias: 7 });
eq([corteDe('2026-11-05', sem), periodoDe('2026-11-05', sem).inicio], ['2026-11-08', '2026-11-02'], 'semanal (segunda a domingo): quinta 05/11 fecha no domingo 08/11');
const vs = vencimentoDoCorte('2026-11-08', sem);
eq([vs.pela_regra, vs.data, vs.motivo_ajuste], ['2026-11-15', '2026-11-16', 'Proclamação da República'], 'semanal: corte + 7 dias cai no feriado de domingo: segunda 16/11');
eq(corteDe('2026-11-05', normalizarRegra({ periodicidade: 'SEMANAL', inicio_semana: 0 })), '2026-11-07', 'semana de domingo a sábado: fecha no sábado 07/11');
eq([ultimoCortePassado('2026-11-05', sem), ultimoCortePassado('2026-11-08', sem)], ['2026-11-01', '2026-11-08'], 'semanal: último corte que passou');
const dia1 = normalizarRegra({ periodicidade: 'DIARIO', prazo_dias: 1 });
const vd = vencimentoDoCorte(corteDe('2026-11-19', dia1), dia1);
eq([corteDe('2026-11-19', dia1), periodoDe('2026-11-19', dia1).inicio, vd.pela_regra, vd.data], ['2026-11-19', '2026-11-19', '2026-11-20', '2026-11-23'], 'diária: fecha no dia; vence 20/11 (Consciência Negra, sexta) e vai para segunda 23/11');
const dec = normalizarRegra({ periodicidade: 'DECENDIAL', prazo_dias: 5 });
eq([corteDe('2026-11-15', dec), periodoDe('2026-11-15', dec).inicio, vencimentoDoCorte('2026-11-20', dec).data], ['2026-11-20', '2026-11-11', '2026-11-25'], 'decendial: 11 a 20, vence 5 dias depois');
eq([corteDe('2026-11-25', dec), periodoDe('2026-11-25', dec).inicio, corteDe('2026-02-25', dec)], ['2026-11-30', '2026-11-21', '2026-02-28'], 'decendial: o terceiro período vai até o fim do mês');
const qui = normalizarRegra({ periodicidade: 'QUINZENAL', prazo_dias: 10 });
eq(proximasFaturas('2026-11-05', qui, 3).map(p => [p.inicio, p.corte, p.vencimento.data]), [
  ['2026-11-01', '2026-11-15', '2026-11-25'], ['2026-11-16', '2026-11-30', '2026-12-10'], ['2026-12-01', '2026-12-15', '2026-12-28'],
], 'quinzenal: próximas três, a última vence no Natal e vai para segunda 28/12');
eq(descreverRegra(sem), 'Uma fatura por semana, de segunda-feira a domingo; vence 7 dias depois do corte, adiado para o próximo dia útil.', 'semanal por extenso');
eq(descreverRegra(normalizarRegra({ periodicidade: 'QUINZENAL', prazo_dias: 0, ajuste_vencimento: 'nenhum' })), 'Uma fatura a cada quinze dias (cortes no dia 15 e no último do mês); vence no dia do corte.', 'quinzenal por extenso');
eq(normalizarRegra({ periodicidade: 'anual', inicio_semana: 9, prazo_dias: -3 }).periodicidade, 'MENSAL', 'periodicidade desconhecida: mensal');
eq([normalizarRegra({ inicio_semana: 9 }).inicio_semana, normalizarRegra({ inicio_semana: 0 }).inicio_semana, normalizarRegra({ prazo_dias: 500 }).prazo_dias], [1, 0, 7], 'semana fora de 0–6 e prazo absurdo caem no padrão');

console.log('--- Acordos com vigência ---');
const acordo = (o: Record<string, unknown>): AcordoComFornecedor => {
  const { acordo: a, erros } = normalizarAcordo({ fornecedor: { id: 'f-sol', nome: 'Operadora Sol' }, vigencia_inicio: '2026-01-01', ...o });
  if (erros.length) throw new Error(JSON.stringify(erros));
  return a;
};
const ac2026 = { ...acordo({ id: 'a1', tipo_produto: 'PACOTE', comissao_percentual: 10, vigencia_fim: '2026-10-31' }) };
const acNov = { ...acordo({ id: 'a2', tipo_produto: 'PACOTE', comissao_percentual: 12, over_valor_centavos: 5000, vigencia_inicio: '2026-11-01' }) };
const acGeral = { ...acordo({ id: 'a3', comissao_percentual: 8 }) };
const acVia = { ...acordo({ id: 'a4', tipo_produto: 'PACOTE', representante: { id: 'f-cons', nome: 'Consolidadora' }, comissao_percentual: 9 }) };
const acCC = { ...acordo({ id: 'a5', tipo_produto: 'AEREO', comissao_percentual: 1, taxa_cc_du_percentual: 5, taxa_cc_rav_percentual: 2 }) };
const acordos = [ac2026, acNov, acGeral, acVia, acCC];
const pacote = { tipo: 'PACOTE' as const, produto_crm_id: '', fornecedor: { id: 'f-sol', nome: 'Operadora Sol' }, representante: null };
eq(acordoVigente(pacote, '2026-10-20', acordos)?.acordo.id, 'a1', 'venda de outubro: acordo de outubro');
eq(acordoVigente(pacote, '2026-11-03', acordos)?.acordo.id, 'a2', 'venda de novembro: acordo de novembro');
eq(acordoVigente({ ...pacote, tipo: 'SEGURO' }, '2026-11-03', acordos)?.acordo.id, 'a3', 'outro tipo: o acordo geral do fornecedor');
eq(acordoVigente({ ...pacote, representante: { id: 'f-cons', nome: 'Consolidadora' } }, '2026-10-20', acordos)?.acordo.id, 'a4', 'comprado pela consolidadora: o acordo dela vence o geral');
eq(acordoVigente(pacote, '2025-12-31', acordos), null, 'antes de qualquer vigência: nenhum');
eq(conflitosDeVigencia({ ...acNov, id: '', vigencia_inicio: '2026-10-15', vigencia_fim: null }, acordos).map(a => a.id), ['a1', 'a2'], 'vigência que encosta em outra: conflito');
eq(conflitosDeVigencia({ ...acNov, id: '', vigencia_inicio: '2025-01-01', vigencia_fim: '2025-12-31' }, acordos).length, 0, 'vigência antes: sem conflito');
eq(normalizarAcordo({ fornecedor: { id: 'x' }, vigencia_inicio: '2026-02-01', vigencia_fim: '2026-01-01', comissao_percentual: 120 }).erros.map(e => e.campo), ['vigencia_fim', 'comissao_percentual'], 'fim antes do início e % acima de 100');
eq(normalizarAcordo({ fornecedor: { id: 'x' }, vigencia_inicio: '2026-02-01' }).erros.map(e => e.campo), ['comissao_percentual'], 'acordo sem nada: recusado');

const venda = (o: Record<string, unknown> = {}): Venda => normalizarVenda({
  id: 'v1', numero: 'VND-0001', data_venda: '2026-11-03', cliente: { id: 'c1', nome: 'Ana' },
  produtos: [
    { id: 'p1', tipo: 'PACOTE', descricao: 'Pacote Bahia', fornecedor: { id: 'f-sol', nome: 'Operadora Sol' }, quem_cobra: 'AGENCIA',
      passageiros: [{ id: 'x1', nome: 'Ana', tarifa_centavos: 100000 }], componentes: [{ id: 'k1', tipo: 'MARKUP', valor_centavos: 20000 }] },
  ],
  pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 120000 }],
  ...o,
}).venda;
const ap = aplicarAcordosNaVenda(venda(), acordos);
eq(ap.aplicados.map(a => [a.tipo, a.valor_centavos, a.acordo_id]), [['COMISSAO', 12000, 'a2'], ['OVER', 5000, 'a2']], 'venda sem comissão: comissão 12% e over R$ 50 pelo acordo da data');
eq(ap.venda.produtos[0].componentes.map(c => c.tipo), ['MARKUP', 'COMISSAO', 'OVER'], 'componentes acrescentados');
const comZero = venda({ produtos: [{ ...venda().produtos[0], componentes: [{ id: 'k0', tipo: 'COMISSAO', valor_centavos: 0 }] }] });
eq(aplicarAcordosNaVenda(comZero, acordos).aplicados.map(a => a.tipo), ['OVER'], 'comissão zerada pela pessoa fica zerada; só o over entra');
eq(aplicarAcordosNaVenda(venda({ data_venda: '2026-10-20' }), acordos).aplicados.map(a => a.valor_centavos), [10000], 'venda de outubro: 10%, sem over');

const aereo = normalizarVenda({
  id: 'v2', numero: 'VND-0002', data_venda: '2026-11-03', cliente: { id: 'c1', nome: 'Ana' },
  produtos: [{ id: 'pa', tipo: 'AEREO', fornecedor: { id: 'f-sol', nome: 'Operadora Sol' }, quem_cobra: 'FORNECEDOR', quantidade: 1, valor_unitario_centavos: 200000,
    componentes: [{ id: 'du', tipo: 'TAXA_DU', valor_centavos: 10000 }, { id: 'rv', tipo: 'RAV', valor_centavos: 5000 }] }],
}).venda;
const esp = esperadoDoProduto(aereo.produtos[0], aereo.data_venda, acordos);
eq([esp?.comissao, esp?.taxa_cc_du, esp?.taxa_cc_rav], [2000, 500, 100], 'aéreo cobrado pelo fornecedor: Taxa CC 5% da DU e 2% do RAV');
const aerApl = aplicarAcordosNaVenda(aereo, acordos).venda.produtos[0];
eq([taxasDoProduto(aerApl).taxa_cc_du, taxasDoProduto(aerApl).taxa_cc_rav], [500, 100], 'Taxa CC por lado, lida pela descrição');

console.log('--- Taxa CC DU/RAV ---');
const pa = aereo.produtos[0];
eq(taxasDoProduto(alterarTaxaCCDoProduto(pa, 'DU', 700)).taxa_cc_du, 700, 'altera a Taxa CC DU');
eq(taxasDoProduto(alterarTaxaCCDoProduto(alterarTaxaCCDoProduto(pa, 'DU', 700), 'RAV', 50)), { taxa_du: 10000, rav: 5000, taxa_cc_du: 700, taxa_cc_rav: 50 }, 'cada lado no seu');
eq(erro(() => alterarTaxaCCDoProduto(pa, 'DU', 10001)), 'ACIMA_DA_TAXA', 'Taxa CC DU não passa da Taxa DU');
eq(erro(() => alterarTaxaCCDoProduto(venda().produtos[0], 'DU', 100)), 'SEM_TAXA', 'sem Taxa DU, não há Taxa CC DU');
const zerada = alterarTaxaCCDoProduto(alterarTaxaCCDoProduto(pa, 'DU', 700), 'DU', 0);
eq([taxasDoProduto(zerada).taxa_cc_du, zerada.componentes.filter(c => c.tipo === 'TAXA_CC').length], [0, 1], 'zero fica gravado (o acordo não volta a preencher)');
eq(ladoDaTaxaCC({ descricao: '' }, { componentes: [{ id: 'd', tipo: 'TAXA_DU', valor_centavos: 1, percentual: null, passageiro_id: null, descricao: '' }] }), 'DU', 'sem descrição e só com DU: lado DU');

console.log('--- Linha da fatura: o que o cliente já pagou ---');
const vf = venda();
const contas = contasDaVenda({ versao: 2, venda: vf, hoje: '2026-11-03' });
const contaForn = { ...contas.contas_pagar[0], id: 'cp1' } as unknown as Record<string, unknown>;
const pos0 = posicaoDaVenda({ venda: vf, contas_receber: contas.contas_receber as unknown as Array<Record<string, unknown>>, contas_pagar: [contaForn], hoje: '2026-11-05' });
const item0 = itemAFaturar({ conta: contaForn, venda: vf, posicao: pos0, situacao_venda: 'ABERTA', data_base: x => x.data_venda, editavel: true });
eq([item0.valor_cliente, item0.liquidado_cliente, item0.saldo_cliente, item0.saldo_fornecedor, item0.tarifa], [120000, 0, 120000, 100000, 100000], 'cliente não pagou: saldo do cliente 1.200, fornecedor 1.000');
eq(item0.alertas.map(a => a.codigo), ['CLIENTE_NAO_PAGOU', 'CLIENTE_EM_ATRASO'], 'alertas: o cliente não pagou e o Pix de 03/11 está em atraso');
const recebida = (contas.contas_receber as unknown as Array<Record<string, unknown>>).map(c => ({ ...c, status: 'RECEBIDO', valor_recebido: c.valor_final }));
const pos1 = posicaoDaVenda({ venda: vf, contas_receber: recebida, contas_pagar: [contaForn], hoje: '2026-11-05' });
const item1 = itemAFaturar({ conta: contaForn, venda: vf, posicao: pos1, situacao_venda: 'ABERTA', data_base: x => x.data_venda, editavel: true });
eq([item1.liquidado_cliente, item1.saldo_cliente, item1.alertas.length], [120000, 0, 0], 'cliente pagou: liquidado, sem alerta');

console.log('--- Sinal ---');
eq(saldoDoSinal({ valor_centavos: 50000, pago_centavos: 0, compensado_centavos: 0 }), 0, 'sinal não pago não compensa');
eq(saldoDoSinal({ valor_centavos: 50000, pago_centavos: 50000, compensado_centavos: 20000 }), 30000, 'pago menos o já compensado');
const itensS = [{ venda_id: 'va', valor_a_gerar: 40000 }, { venda_id: 'vb', valor_a_gerar: 30000 }];
eq(planejarCompensacao(itensS, [
  { id: 's2', parte_id: 'f', venda_id: null, data: '2026-10-02', disponivel: 50000 },
  { id: 's1', parte_id: 'f', venda_id: null, data: '2026-10-01', disponivel: 10000 },
]), [{ sinal_id: 's1', valor_centavos: 10000 }, { sinal_id: 's2', valor_centavos: 50000 }], 'mais antigo primeiro, até o total');
eq(planejarCompensacao(itensS, [{ id: 's3', parte_id: 'f', venda_id: 'vb', data: '2026-10-01', disponivel: 90000 }]), [{ sinal_id: 's3', valor_centavos: 30000 }], 'sinal de uma venda só cobre os itens dela');
eq(planejarCompensacao(itensS, [{ id: 's4', parte_id: 'f', venda_id: null, data: '2026-10-01', disponivel: 100000 }]), [{ sinal_id: 's4', valor_centavos: 70000 }], 'sinal maior que a fatura: compensa só o total');
const pv = previaDaFatura({ parte_id: contaForn.fornecedor_id as string, parte_nome: 'Operadora Sol', itens: [item0], sinais: [{ id: 's1', parte_id: 'f', venda_id: null, data: '2026-10-01', disponivel: 30000 }], vencimento: v, corte: '2026-10-25' });
eq([pv.total_itens, pv.total_sinal, pv.a_pagar, pv.alertas.map(a => a.codigo)], [100000, 30000, 70000, ['CLIENTE_NAO_PAGOU', 'CLIENTE_EM_ATRASO']], 'prévia: 1.000 − 300 de sinal = 700; avisa que o cliente não pagou');

console.log('--- Fatura pelo valor bruto ---');
const vb = ap.venda;
const contasB = contasDaVenda({ versao: 2, venda: vb, hoje: '2026-11-03' });
const contaB = { ...contasB.contas_pagar[0], id: 'cpb' } as unknown as Record<string, unknown>;
const posB = posicaoDaVenda({ venda: vb, contas_receber: contasB.contas_receber as unknown as Array<Record<string, unknown>>, contas_pagar: [contaB], hoje: '2026-11-05' });
const itemB = itemAFaturar({ conta: contaB, venda: vb, posicao: posB, situacao_venda: 'ABERTA', data_base: x => x.data_venda, editavel: true });
eq([itemB.valor_a_gerar, itemB.comissao, itemB.over, receitasDoItem(itemB)], [83000, 12000, 5000, 17000], 'item: líquido 830 (1.000 − 120 de comissão − 50 de over); receitas 170');
eq(receitasDoItem({ ...itemB, complemento: true }), 0, 'complemento não soma receitas de novo');
eq(receitasDoItem({ ...itemB, papel: 'intermediario' }), 0, 'repasse ao intermediário não tem receitas');
const pSaldo = previaDaFatura({ parte_id: 'f-sol', parte_nome: 'Operadora Sol', itens: [itemB], sinais: [], vencimento: v, corte: '2026-10-25' });
eq([pSaldo.modo, pSaldo.receitas, pSaldo.receitas_no_bruto, pSaldo.a_pagar], ['SALDO', 0, 17000, 83000], 'saldo (padrão): paga o líquido; mostra quanto seria o bruto');
const pBruto = previaDaFatura({ parte_id: 'f-sol', parte_nome: 'Operadora Sol', itens: [itemB], sinais: [{ id: 's1', parte_id: 'f', venda_id: null, data: '2026-10-01', disponivel: 3000 }], vencimento: v, corte: '2026-10-25', modo: 'BRUTO' });
eq([pBruto.modo, pBruto.total_itens, pBruto.total_sinal, pBruto.receitas, pBruto.a_pagar], ['BRUTO', 83000, 3000, 17000, 97000], 'saldo + receitas: 830 − 30 de sinal + 170 = 970 a pagar');
const fatB = { id: 'fb', numero: 'FF-0002', situacao: 'GERADA', vencimento: '2026-11-16', valor_itens_centavos: 100000, sinal_centavos: 0, receitas_centavos: 10000, conta_status: 'PARCIAL', conta_valor_centavos: 110000, conta_pago_centavos: 55000 };
eq(pagoDaFatura(fatB), 50000, 'bruto pago pela metade: só a parte dos itens conta (550 × 1.000/1.100)');
eq(pagoDaFatura({ ...fatB, conta_status: 'PAGO' }), 100000, 'bruto pago: itens pagos, sem passar do valor dos itens');
eq(pagoDaFatura({ ...fatB, receitas_centavos: undefined, conta_valor_centavos: 100000, conta_pago_centavos: 50000 }), 50000, 'fatura de antes (sem receitas): a conta de sempre');

console.log('--- A conta faturada na posição ---');
const fat = { id: 'f1', numero: 'FF-0001', situacao: 'GERADA', vencimento: '2026-11-16', valor_itens_centavos: 100000, sinal_centavos: 30000, conta_status: 'PARCIAL', conta_valor_centavos: 70000, conta_pago_centavos: 20000 };
eq(pagoDaFatura(fat), 50000, 'pago = sinal + baixa parcial');
const ref = refletirContaFaturada({ ...contaForn, status: 'CANCELADO', valor_final: 1000 }, fat);
eq([ref.status, ref.valor_pago, ref.data_vencimento], ['PARCIAL', 500, '2026-11-16'], 'a conta da venda aparece paga pela metade, com o vencimento da fatura');
eq(refletirContaFaturada({ valor_final: 1000 }, { ...fat, conta_status: 'PAGO' }).status, 'PAGO', 'fatura paga: conta paga');

console.log('--- Comissão esperada × recebida ---');
const acHot = acordo({ id: 'h1', fornecedor: { id: 'f-hot', nome: 'Hotel Bom' }, tipo_produto: 'HOSPEDAGEM', comissao_percentual: 10 });
const hot = (id: string, quem: string, comissao: number) => normalizarVenda({
  id, numero: id, data_venda: '2026-11-02', cliente: { id: 'c1', nome: 'Ana' },
  produtos: [{ id: `p-${id}`, tipo: 'HOSPEDAGEM', fornecedor: { id: 'f-hot', nome: 'Hotel Bom' }, quem_cobra: quem,
    passageiros: [{ id: 'x', nome: 'Ana', tarifa_centavos: quem === 'FORNECEDOR' ? 100000 : 200000 }], componentes: [{ id: 'c', tipo: 'COMISSAO', valor_centavos: comissao }] }],
}).venda;
const h1 = hot('H1', 'FORNECEDOR', 10000);
const h2 = hot('H2', 'AGENCIA', 15000);
const c1 = contasDaVenda({ versao: 2, venda: h1, hoje: '2026-11-02' });
const c2 = contasDaVenda({ versao: 2, venda: h2, hoje: '2026-11-02' });
const crH1 = (c1.contas_receber as unknown as Array<Record<string, unknown>>).filter(c => c.origem === 'COMISSAO_FORNECEDOR').map(c => ({ ...c, data_vencimento: '2026-11-30' }));
const cpH2 = (c2.contas_pagar as unknown as Array<Record<string, unknown>>).map(c => ({ ...c, status: 'PAGO', valor_pago: c.valor_final }));
const entrada = (crs: Array<Record<string, unknown>>) => [
  { venda: h1, posicao: posicaoDaVenda({ venda: h1, contas_receber: crs, contas_pagar: [], hoje: '2026-12-20' }), contas_receber: crs },
  { venda: h2, posicao: posicaoDaVenda({ venda: h2, contas_receber: [], contas_pagar: cpH2, hoje: '2026-12-20' }), contas_receber: [] },
];
const com = comissoesPorOperadora({ vendas: entrada(crH1), acordos: [acHot], hoje: '2026-12-20' });
const op = com.operadoras[0];
eq([op.nome, op.esperada, op.lancada, op.recebida, op.a_receber, op.em_atraso], ['Hotel Bom', 30000, 25000, 15000, 10000, 10000], 'esperado 300 (10% de 1.000 + 2.000), lançado 250, recebido 150 (retido no pagamento)');
eq(op.alertas.map(a => a.codigo), ['ABAIXO_DO_ACORDO', 'COMISSAO_EM_ATRASO'], 'alertas: abaixo do acordo e comissão vencida');
const recebidaH1 = crH1.map(c => ({ ...c, status: 'RECEBIDO', valor_recebido: c.valor_final }));
const com2 = comissoesPorOperadora({ vendas: entrada(recebidaH1), acordos: [acHot], hoje: '2026-12-20', extrato: [{ parte_id: 'f-hot', venda_id: null, localizador: '', valor_centavos: 23000 }] });
eq([com2.operadoras[0].recebida, com2.operadoras[0].em_atraso, com2.operadoras[0].informada], [25000, 0, 23000], 'comissão recebida: 250; extrato diz 230');
eq(com2.operadoras[0].alertas.map(a => a.codigo), ['ABAIXO_DO_ACORDO', 'EXTRATO_DIVERGENTE'], 'extrato diferente do lançado: alerta');
eq(com2.linhas.map(l => [l.venda_id, l.esperada, l.lancada, l.recebida]), [['H1', 10000, 10000, 10000], ['H2', 20000, 15000, 15000]], 'linhas por venda');
const semAcordo = comissoesPorOperadora({ vendas: entrada(recebidaH1), acordos: [], hoje: '2026-12-20' });
eq([semAcordo.operadoras[0].esperada, semAcordo.operadoras[0].sem_acordo, semAcordo.operadoras[0].alertas.map(a => a.codigo)], [25000, 2, ['SEM_ACORDO']], 'sem acordo: esperado = lançado, e avisa');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
