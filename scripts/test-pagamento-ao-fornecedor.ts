/**
 * Como a agência paga cada fornecedor (src/lib/pagamento-ao-fornecedor.ts):
 * o bloco do CRM só entra validado e as parcelas sempre fecham com o custo.
 */
import { lerPagamentoAoFornecedor, planoDoPagamento } from '../src/lib/pagamento-ao-fornecedor.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

eq([lerPagamentoAoFornecedor(null), lerPagamentoAoFornecedor('x'), lerPagamentoAoFornecedor({ forma: 'PIX' })], [null, null, null], 'sem bloco, ou sem data nenhuma: null (a conta nasce como sempre)');
eq(lerPagamentoAoFornecedor({ forma: 'dinheiro', vencimento: '2026-12-15' }), { forma: null, vencimento: '2026-12-15', parcelas: [] }, 'forma fora do enum vira não informada; o vencimento fica');
eq(lerPagamentoAoFornecedor({ forma: 'boleto', parcelas: [{ parcela: 2, valor: 10, vencimento: '2027-01-15' }, { parcela: 1, valor: 10, vencimento: '2026-12-15' }, { parcela: 3, valor: 10, vencimento: 'amanhã' }] }),
  { forma: 'BOLETO', vencimento: '2026-12-15', parcelas: [{ parcela: 1, valor: 10, vencimento: '2026-12-15' }, { parcela: 2, valor: 10, vencimento: '2027-01-15' }] },
  'parcelas em ordem, sem data inválida; vencimento = primeira parcela');

const tres = lerPagamentoAoFornecedor({ forma: 'BOLETO', vencimento: '2026-12-15', parcelas: [
  { parcela: 1, valor: 333.33, vencimento: '2026-12-15' }, { parcela: 2, valor: 333.33, vencimento: '2027-01-15' }, { parcela: 3, valor: 333.34, vencimento: '2027-02-15' }] });
eq(planoDoPagamento(tres, 1000), [
  { numero: 1, total: 3, valor: 333.33, vencimento: '2026-12-15' },
  { numero: 2, total: 3, valor: 333.33, vencimento: '2027-01-15' },
  { numero: 3, total: 3, valor: 333.34, vencimento: '2027-02-15' }], 'boleto em 3x: uma parcela por mês, a soma é o custo');
const plano = planoDoPagamento(tres, 900)!;
eq([plano.reduce((s, p) => Math.round((s + p.valor) * 100) / 100, 0), plano.map(p => p.vencimento)], [900, ['2026-12-15', '2027-01-15', '2027-02-15']], 'soma diferente do custo: redivide e fecha no custo, datas mantidas');

eq(planoDoPagamento({ ...tres!, forma: 'PIX' }, 1000), [{ numero: 1, total: 1, valor: 1000, vencimento: '2026-12-15' }], 'PIX não parcela: uma conta no primeiro vencimento');
eq(planoDoPagamento({ forma: 'TED', vencimento: '2026-12-20', parcelas: [] }, 500), [{ numero: 1, total: 1, valor: 500, vencimento: '2026-12-20' }], 'só vencimento: uma conta naquele dia');
const treze = lerPagamentoAoFornecedor({ forma: 'CARTAO_CORP', parcelas: Array.from({ length: 13 }, (_, i) => ({ parcela: i + 1, valor: 10, vencimento: `2027-${String((i % 12) + 1).padStart(2, '0')}-10` })) });
eq([planoDoPagamento(treze, 130)!.length, planoDoPagamento(treze, 130)!.reduce((s, p) => s + p.valor, 0)], [12, 130], 'no máximo 12 parcelas, e ainda fecham no custo');
eq(planoDoPagamento(tres, 0), null, 'custo zero: sem conta');

console.log(`\n${total - falhas}/${total} testes do pagamento ao fornecedor passaram`);
if (falhas > 0) process.exit(1);
