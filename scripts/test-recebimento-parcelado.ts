/**
 * Venda parcelada no cartão ou no boleto: mês a mês ou antecipar
 * (src/lib/recebimento-parcelado.ts). O dinheiro tem que fechar nos dois
 * sentidos: a soma cheia nunca muda, a taxa fica declarada e voltar da
 * antecipação devolve as mesmas parcelas.
 */
import {
  aplicarRecebimento, formaDoCrm, lerEscolha, precisaEscolherRecebimento, recebimentoAoChegar, type ContaDoRecebimento,
} from '../src/lib/recebimento-parcelado.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

console.log('--- forma vinda do CRM ---');
eq(['cartao_credito', 'Cartão de crédito', 'boleto', 'pix', 'transferencia', 'nao_definida', '', 'xyz'].map(formaDoCrm), ['CARTAO', 'CARTAO', 'BOLETO', 'AVISTA_PIX', 'AVISTA_PIX', null, null, null], 'mapeia cartão, boleto, Pix; não definida e desconhecida = null');
eq([precisaEscolherRecebimento('CARTAO', 3), precisaEscolherRecebimento('BOLETO', 2), precisaEscolherRecebimento('CARTAO', 1), precisaEscolherRecebimento('AVISTA_PIX', 6)], [true, true, false, false], 'só parcelado no cartão ou no boleto pergunta');

console.log('\n--- ao chegar ---');
eq(recebimentoAoChegar(undefined, 'CARTAO', 3), { modo: 'pendente', taxa_pct: 0 }, 'sem escolha: pendente');
eq(recebimentoAoChegar({ modo: 'antecipado', taxa_pct: 4, data_antecipacao: '2026-11-20' }, 'CARTAO', 3)?.modo, 'antecipado', 'reenvio respeita a escolha feita');
eq(recebimentoAoChegar({ modo: 'mensal', taxa_pct: 2 }, 'AVISTA_PIX', 1), undefined, 'virou à vista no CRM: não pergunta mais');

console.log('\n--- a escolha enviada ---');
eq(lerEscolha({ modo: 'mensal', taxa_pct: 2.5 }), { ok: true, valor: { modo: 'mensal', taxa_pct: 2.5 } }, 'mês a mês com taxa');
eq(lerEscolha({ modo: 'antecipado', taxa_pct: '', data_antecipacao: '2026-11-20' }), { ok: true, valor: { modo: 'antecipado', taxa_pct: 0, data_antecipacao: '2026-11-20' } }, 'antecipar sem taxa');
eq(lerEscolha({ modo: 'antecipado', taxa_pct: 3 }).ok, false, 'antecipar sem data é recusado');
eq([lerEscolha({ modo: 'x' }).ok, lerEscolha({ modo: 'mensal', taxa_pct: -1 }).ok, lerEscolha({ modo: 'mensal', taxa_pct: 80 }).ok], [false, false, false], 'modo inválido, taxa negativa ou absurda são recusados');

console.log('\n--- aplicar ---');
const parcela = (forn: string, n: number, valor: number, venc: string): ContaDoRecebimento & { status: string } => ({
  id: `${forn}-${n}`, origem: 'VENDA', descricao: `Venda VND-0001 - ${forn} - Parcela ${n}/3`, valor_original: valor, valor_final: valor,
  data_vencimento: venc, parcela_numero: n, total_parcelas: 3, taxa: 0, taxa_plataforma: '', origem_fornecedor_id: forn, status: 'PENDENTE',
});
const comissao = { id: 'com', origem: 'COMISSAO_FORNECEDOR', descricao: 'Comissão', valor_original: 50, valor_final: 50, data_vencimento: '2026-12-01' } as ContaDoRecebimento;
const contas = [
  parcela('cvc', 1, 333.33, '2026-12-13'), parcela('cvc', 2, 333.33, '2027-01-13'), parcela('cvc', 3, 333.34, '2027-02-13'),
  parcela('azul', 1, 100, '2026-12-13'), parcela('azul', 2, 100, '2027-01-13'), parcela('azul', 3, 100, '2027-02-13'),
  comissao,
];
const soma = (cs: ContaDoRecebimento[]) => Math.round(cs.filter(c => c.origem === 'VENDA').reduce((s, c) => s + c.valor_final, 0) * 100) / 100;

const pendente = aplicarRecebimento(contas, { modo: 'pendente', taxa_pct: 0 }, 'CARTAO');
eq(pendente.filter(c => c.recebimento_a_definir).length, 6, 'pendente: as 6 parcelas da venda ficam marcadas');
eq(pendente.find(c => c.id === 'com')?.recebimento_a_definir, undefined, 'a comissão não entra na pergunta');

const mensal = aplicarRecebimento(contas, { modo: 'mensal', taxa_pct: 3 }, 'CARTAO');
eq(mensal.filter(c => c.origem === 'VENDA').map(c => c.taxa), [10, 10, 10, 3, 3, 3], 'mês a mês: 3% sobre cada parcela');
eq([soma(mensal), mensal[0].taxa_plataforma, mensal[0].recebimento_a_definir], [1300, 'Cartão de crédito', undefined], 'o valor cheio não muda; quem cobra fica declarado; sai das pendências');

const ante = aplicarRecebimento(contas, { modo: 'antecipado', taxa_pct: 4, data_antecipacao: '2026-11-20' }, 'CARTAO');
const daVenda = ante.filter(c => c.origem === 'VENDA');
eq(daVenda.map(c => [c.origem_fornecedor_id, c.valor_final, c.taxa, c.data_vencimento, c.total_parcelas]), [['cvc', 1000, 40, '2026-11-20', 1], ['azul', 300, 12, '2026-11-20', 1]], 'antecipar: uma conta por fornecedor, na data, com 4% sobre o total');
eq([soma(ante), daVenda[0].descricao, ante.some(c => c.id === 'com')], [1300, 'Venda VND-0001 - cvc - Antecipado (3 parcelas)', true], 'a soma fecha, a descrição diz o que é, a comissão continua');

const deVolta = aplicarRecebimento(ante, { modo: 'mensal', taxa_pct: 0 }, 'CARTAO');
eq(deVolta.filter(c => c.origem === 'VENDA').map(c => [c.id, c.valor_final, c.data_vencimento, c.parcela_numero, c.taxa]).sort(),
  contas.filter(c => c.origem === 'VENDA').map(c => [c.id, c.valor_final, c.data_vencimento, c.parcela_numero, 0]).sort(),
  'voltar ao mês a mês devolve as mesmas parcelas, ids, datas e valores');
eq(JSON.stringify(aplicarRecebimento(ante, { modo: 'antecipado', taxa_pct: 4, data_antecipacao: '2026-11-20' }, 'CARTAO')), JSON.stringify(ante), 'aplicar a mesma antecipação duas vezes dá o mesmo resultado');
eq(aplicarRecebimento(contas, { modo: 'mensal', taxa_pct: 2 }, 'BOLETO')[0].taxa_plataforma, 'Boleto', 'no boleto, quem cobra é o boleto');

console.log(`\n${total - falhas}/${total} testes do recebimento parcelado passaram`);
if (falhas > 0) process.exit(1);
