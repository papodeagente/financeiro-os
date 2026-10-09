/**
 * Venda de turismo lançada no Financeiro (src/lib/venda-turismo.ts).
 *
 * Uma venda real de agência: aéreo de uma consolidadora, hotel de uma
 * operadora, seguro pago direto à seguradora (a agência só recebe comissão) e
 * a taxa de serviço da própria agência. O que precisa ser verdade:
 *   1) a margem que a tela mostra é o lucro previsto que o gerador do servidor
 *      calcula, centavo a centavo;
 *   2) o cliente recebe UMA conta por parcela, a partir do 1º vencimento
 *      escolhido, com a forma de pagamento da venda;
 *   3) cada fornecedor revendido ganha a conta a pagar dele, na data escolhida
 *      ou no prazo do cadastro; o pago direto vira comissão a receber;
 *   4) taxa de serviço é margem pura: sem fornecedor, sem conta a pagar.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-venda-turismo.ts
 */
import {
  contaDaLinha, linhaDeTaxa, linhasComPrejuizo, montarVenda, novaLinha, temErros, totaisDaVenda, validarVenda,
} from '../src/lib/venda-turismo.ts';
import { gerarContasVenda, receberPorFornecedorDe } from '../src/lib/venda-financeiro.ts';
import { somaPor } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const aereo = novaLinha({ tipo: 'AEREO', fornecedor_id: 'f-latam', fornecedor_nome: 'Consolidadora Rextur', descricao: 'GRU-LIS ida e volta, 2 adultos', net: 4000, venda: 4800, dataPagamento: '2026-10-20' });
const hotel = novaLinha({ tipo: 'HOTEL', fornecedor_id: 'f-op', fornecedor_nome: 'Operadora Europa', descricao: 'Lisboa, 7 noites', net: 3000, venda: 3600 });
const seguro = novaLinha({ tipo: 'SEGURO', fornecedor_id: 'f-seg', fornecedor_nome: 'Seguradora Viaje Bem', descricao: 'Seguro 8 dias', venda: 400, pagoDireto: true, comissaoPct: 20 });
const taxa = { ...linhaDeTaxa(), venda: 300 };
const usd = novaLinha({ tipo: 'RECEPTIVO', fornecedor_id: 'f-rec', fornecedor_nome: 'Receptivo Lisboa', net: 100, venda: 130, moeda: 'USD', cambio: 5.4 });

console.log('--- a margem de cada linha ---');
eq(contaDaLinha(aereo), { cobradoDoCliente: 4800, custo: 4000, comissao: 0, margem: 800, margemPct: 16.67 }, 'aéreo: R$ 800 de margem (16,67% da venda)');
eq(contaDaLinha(seguro), { cobradoDoCliente: 0, custo: 0, comissao: 80, margem: 80, margemPct: 20 }, 'seguro pago direto: o cliente não paga à agência, a margem é a comissão');
eq(contaDaLinha(taxa), { cobradoDoCliente: 300, custo: 0, comissao: 0, margem: 300, margemPct: 100 }, 'taxa de serviço: margem pura');
eq(contaDaLinha({ ...taxa, net: 999 }).custo, 0, 'linha da agência nunca tem custo, mesmo com net digitado');
eq(contaDaLinha(usd), { cobradoDoCliente: 702, custo: 540, comissao: 0, margem: 162, margemPct: 23.08 }, 'em dólar: convertido pelo câmbio da linha');

console.log('--- os totais ---');
const linhas = [aereo, hotel, seguro, taxa];
const t = totaisDaVenda(linhas);
eq([t.cliente, t.pagoDireto, t.custo, t.comissoes, t.margem], [8700, 400, 7000, 80, 1780], 'cliente paga 8.700; custo 7.000; comissão 80; margem 1.780');
eq(t.margemPct, 19.56, 'margem: 1.780 de 9.100 em serviços');
eq(t.markupPct, 24.29, 'markup sobre o custo revendido');
eq(totaisDaVenda([]).margemPct, null, 'sem serviço: sem percentual (nunca 0%)');

console.log('--- o que o servidor vai gerar ---');
const cab = { cliente_id: 'cli-1', dataVenda: '2026-10-09', vendedor_id: 'u-karen', formaPagamento: 'CARTAO' as const, parcelas: 3, primeiroVencimento: '2026-10-15', observacoes: '' };
const { venda, itens } = montarVenda(cab, linhas, 'Vteste');
eq([venda.status, venda.valor_final, venda.valor_total_custo, venda.parcelas, venda.primeiro_vencimento, venda.vendedor_id], ['CONFIRMADO', 8700, 7000, 3, '2026-10-15', 'u-karen'], 'a venda: confirmada, total do cliente, custo, parcelas, 1º vencimento e vendedor');
eq(itens.map(i => [i.data.meio_pagamento, i.data.valor_custo, i.fornecedor_id]), [['proprio', 4000, 'f-latam'], ['proprio', 3000, 'f-op'], ['fornecedor', 0, 'f-seg'], ['proprio', 0, '']], 'itens: revendidos, pago direto e a taxa sem fornecedor');
const fornecedores = [
  { id: 'f-latam', nome_fantasia: 'Rextur', regras_faturamento: { prazo_pagamento_dias: 30, dia_corte: 0, dia_vencimento: 0, comissao_padrao: 0, moeda_padrao: 'BRL' } },
  { id: 'f-op', nome_fantasia: 'Operadora Europa', regras_faturamento: { prazo_pagamento_dias: 15, dia_corte: 0, dia_vencimento: 0, comissao_padrao: 0, moeda_padrao: 'BRL' } },
  { id: 'f-seg', nome_fantasia: 'Viaje Bem', regras_faturamento: { prazo_pagamento_dias: 30, dia_corte: 0, dia_vencimento: 0, comissao_padrao: 0, moeda_padrao: 'BRL', regra_vencimento_comissao: { tipo: 'dias_apos_venda', valor: 10 } } },
] as never[];
const g = gerarContasVenda({ venda, itens, fornecedores, cliente_nome: 'Ana Souza', receberPorFornecedor: receberPorFornecedorDe([], 'manual') });
eq(g.resumo.lucro_previsto, t.margem, 'a margem da tela é o lucro previsto do gerador (mesmo número)');
const doCliente = g.contas_receber.filter(c => c.origem === 'VENDA');
eq(doCliente.map(c => [c.valor_final, c.data_vencimento, c.parcela_numero, c.forma_recebimento]), [[2900, '2026-10-15', 1, 'CARTAO'], [2900, '2026-11-15', 2, 'CARTAO'], [2900, '2026-12-15', 3, 'CARTAO']], 'o cliente: uma conta por parcela, a partir do 1º vencimento, no cartão');
eq(somaPor(doCliente, c => c.valor_final), t.cliente, 'as parcelas somam o que o cliente paga');
eq(g.contas_pagar.map(c => [c.fornecedor_id, c.valor_final, c.data_vencimento]), [['f-latam', 4000, '2026-10-20'], ['f-op', 3000, '2026-10-24']], 'fornecedores: na data escolhida (aéreo) ou no prazo do cadastro (hotel, 15 dias)');
const comissao = g.contas_receber.filter(c => c.origem === 'COMISSAO_FORNECEDOR');
eq(comissao.map(c => [c.cliente_id, c.valor_final, c.data_vencimento]), [['f-seg', 80, '2026-10-19']], 'a seguradora deve a comissão, na regra dela');

console.log('--- sem 1º vencimento: a regra antiga ---');
const antigo = gerarContasVenda({ ...{ venda: { ...venda, primeiro_vencimento: undefined }, itens, fornecedores, cliente_nome: 'Ana' } });
eq(antigo.contas_receber.filter(c => c.origem === 'VENDA')[0].data_vencimento, '2026-11-09', 'vendas do CRM e antigas: 1ª parcela um mês depois da venda');

console.log('--- validação ---');
const ok = validarVenda({ cliente_id: 'c', linhas, primeiroVencimento: '2026-10-15', dataVenda: '2026-10-09' });
eq(temErros(ok), false, 'venda completa: grava');
const ruim = validarVenda({
  cliente_id: '',
  linhas: [novaLinha({ id: 'a' }), novaLinha({ id: 'b', venda: 100, pagoDireto: true }), novaLinha({ id: 'c', venda: 100, pagoDireto: true, fornecedor_id: 'f', comissaoPct: 0 }), novaLinha({ id: 'd', venda: 100, moeda: 'USD', cambio: 0 })],
  primeiroVencimento: '2026-10-01', dataVenda: '2026-10-09',
});
eq([ruim.cliente, ruim.porLinha.a, ruim.porLinha.b, ruim.porLinha.c, ruim.porLinha.d, ruim.primeiroVencimento],
  ['Escolha o cliente.', 'Informe o preço de venda.', 'Escolha o fornecedor que paga a comissão.', 'Informe a comissão do fornecedor.', 'Informe o câmbio.', 'O 1º vencimento não pode ser antes da venda.'], 'cada problema na sua linha');
eq(validarVenda({ cliente_id: 'c', linhas: [], primeiroVencimento: '', dataVenda: '' }).linhas, 'Inclua ao menos um serviço.', 'venda sem serviço não grava');
eq(linhasComPrejuizo([aereo, novaLinha({ id: 'x', net: 500, venda: 450 })]), ['x'], 'vendido abaixo do custo: aviso, não bloqueio');

console.log(`\n${total - falhas}/${total} testes da venda de turismo passaram`);
if (falhas > 0) process.exit(1);
