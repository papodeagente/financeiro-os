/* eslint-disable no-console */
// Smoke test for the CRM -> Financeiro VENDA_FECHADA mapping.
// Pure mapping only — no DB connection required.
//
// Usage: npx tsx scripts/test-crm-venda.ts

import {
  buildContaPagarFromFornecedor,
  buildComissaoReceberFromFornecedor,
  calcularComissaoFornecedor,
} from '../src/lib/crm-integration';
import type { ContaReceber, ContaPagar } from '../src/lib/crm-types';

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log('  ✓', msg);
  } else {
    console.error('  ✗', msg);
    failed++;
  }
}

const ctx = {
  vendaId: 'vd_local_123',
  clienteId: 'cli_local_456',
  clienteNome: 'João Silva',
  enturGrupoId: 'grp_999',
  crmVendaId: 'crm_deal_789',
};

// ────────────────────────────────────────
// 1. ContaPagar: custo do fornecedor + flag de comprovante
// ────────────────────────────────────────
console.log('\n[1] ContaPagar — custo + requer_comprovante');
const forn = {
  fornecedor_id: 'crm_supplier_22',
  fornecedor_nome: 'Cia Aérea XYZ',
  servico: 'Voo SP-RJ',
  valor_custo: 3000,
  vencimento_pagamento: '2026-06-10',
};
const cp1 = buildContaPagarFromFornecedor(forn, 'forn_local_22', ctx);
assert(cp1.origem === 'VENDA', "origem === 'VENDA'");
assert(cp1.status === 'PENDENTE', "status === 'PENDENTE'");
assert(cp1.fornecedor_id === 'forn_local_22', 'fornecedor_id é o INTERNO');
assert(cp1.fornecedor_nome === 'Cia Aérea XYZ', 'fornecedor_nome');
assert(cp1.valor_final === 3000, 'valor_final === valor_custo');
assert(cp1.data_vencimento === '2026-06-10', 'data_vencimento');
assert(cp1.observacoes.includes('comprovante obrigatório'), 'observacoes alerta sobre comprovante');
assert((cp1 as unknown as { requer_comprovante: boolean }).requer_comprovante === true, 'requer_comprovante=true no JSONB');
assert(cp1.auto_gerado === true, 'auto_gerado true');

// ────────────────────────────────────────
// 2. calcularComissaoFornecedor — campo direto comissao
// ────────────────────────────────────────
console.log('\n[2] Comissão direta no payload (forn.comissao)');
const com1 = calcularComissaoFornecedor(
  { valor_custo: 3000, comissao: 450 }, [], 0,
);
assert(com1 === 450, 'forn.comissao === 450 → 450');

// ────────────────────────────────────────
// 3. calcularComissaoFornecedor — alias valor_comissao
// ────────────────────────────────────────
console.log('\n[3] Alias valor_comissao');
const com2 = calcularComissaoFornecedor(
  { valor_custo: 3000, valor_comissao: 600 }, [], 0,
);
assert(com2 === 600, 'forn.valor_comissao usado');

// ────────────────────────────────────────
// 4. calcularComissaoFornecedor — percentual
// ────────────────────────────────────────
console.log('\n[4] Percentual sobre valor_custo (10%)');
const com3 = calcularComissaoFornecedor(
  { valor_custo: 3000, percentual_comissao: 10 }, [], 0,
);
assert(com3 === 300, '10% de 3000 === 300');

// ────────────────────────────────────────
// 5. calcularComissaoFornecedor — rateio proporcional
// ────────────────────────────────────────
console.log('\n[5] Rateio proporcional do total da venda');
// Venda: R$ 5000, custo R$ 4000 (3000 + 1000), comissão total R$ 1000
// Proporção: forn1 deve receber 750, forn2 deve receber 250
const fornecedores = [
  { fornecedor_id: 'a', valor_custo: 3000 },
  { fornecedor_id: 'b', valor_custo: 1000 },
];
const com4a = calcularComissaoFornecedor(fornecedores[0], fornecedores, 1000);
const com4b = calcularComissaoFornecedor(fornecedores[1], fornecedores, 1000);
assert(com4a === 750, '3000/4000 * 1000 === 750');
assert(com4b === 250, '1000/4000 * 1000 === 250');
assert(com4a + com4b === 1000, 'soma das comissões == comissão total');

// ────────────────────────────────────────
// 6. calcularComissaoFornecedor — sem comissão total → 0
// ────────────────────────────────────────
console.log('\n[6] Sem comissão total e sem campo direto');
const com5 = calcularComissaoFornecedor(
  { valor_custo: 3000 }, [{ valor_custo: 3000 }], 0,
);
assert(com5 === 0, 'retorna 0 sem comissão total');

// ────────────────────────────────────────
// 7. ContaReceber comissão — origem COMISSAO_FORNECEDOR
// ────────────────────────────────────────
console.log('\n[7] ContaReceber comissão');
const cr1 = buildComissaoReceberFromFornecedor(forn, 'forn_local_22', ctx, 450);
assert(cr1.origem === 'COMISSAO_FORNECEDOR', "origem === 'COMISSAO_FORNECEDOR'");
assert(cr1.status === 'PENDENTE', "status === 'PENDENTE'");
assert(cr1.valor_final === 450, 'valor_final === valor da comissão');
assert(cr1.descricao.startsWith('Comissão Voo SP-RJ'), 'descricao começa com "Comissão"');
assert(cr1.descricao.includes('Cia Aérea XYZ'), 'descricao inclui fornecedor_nome');
assert(cr1.cliente_nome === ctx.clienteNome, 'cliente_nome preservado p/ rastreio');
assert((cr1.origem_item_id) === 'forn_local_22', 'origem_item_id === fornecedor interno');
assert(cr1.data_vencimento === '2026-06-10', 'usa vencimento_pagamento como fallback');
assert(cr1.parcela_numero === 1 && cr1.total_parcelas === 1, 'parcela 1/1 (comissão é única)');

// ────────────────────────────────────────
// 8. Vencimento dedicado da comissão
// ────────────────────────────────────────
console.log('\n[8] Vencimento da comissão com campo próprio');
const fornComVencProprio = {
  ...forn,
  vencimento_pagamento: '2026-06-10',
  vencimento_comissao: '2026-07-15',
};
const cr2 = buildComissaoReceberFromFornecedor(fornComVencProprio, 'forn_local_22', ctx, 450);
assert(cr2.data_vencimento === '2026-07-15', 'vencimento_comissao tem prioridade');

// ────────────────────────────────────────
// 9. Shape completo
// ────────────────────────────────────────
console.log('\n[9] Shape completo de ContaReceber (campos UI)');
const requiredCR: (keyof ContaReceber)[] = [
  'id', 'origem', 'venda_id', 'grupo_id', 'cliente_id', 'cliente_nome',
  'descricao', 'categoria_id', 'centro_custo', 'valor_original', 'juros',
  'multa', 'desconto', 'valor_final', 'data_emissao', 'data_vencimento',
  'data_recebimento', 'valor_recebido', 'conta_bancaria_id', 'forma_recebimento',
  'parcela_numero', 'total_parcelas', 'boleto_emitido', 'boleto_codigo',
  'boleto_url', 'status', 'rateio', 'anexos', 'observacoes',
];
for (const k of requiredCR) {
  assert(k in cr1, `cr.${String(k)} presente`);
}

console.log('\n[10] Shape completo de ContaPagar');
const requiredCP: (keyof ContaPagar)[] = [
  'id', 'origem', 'venda_id', 'grupo_id', 'fornecedor_id', 'fornecedor_nome',
  'descricao', 'categoria_id', 'centro_custo', 'valor_original', 'juros',
  'multa', 'desconto', 'valor_final', 'moeda', 'cambio', 'valor_brl',
  'data_emissao', 'data_vencimento', 'data_pagamento', 'valor_pago',
  'conta_bancaria_id', 'forma_pagamento', 'cartao_id', 'comprovante',
  'parcela_numero', 'total_parcelas', 'natureza_custo', 'is_custo_comercial',
  'status', 'rateio', 'anexos', 'observacoes',
];
for (const k of requiredCP) {
  assert(k in cp1, `cp.${String(k)} presente`);
}

// ────────────────────────────────────────
// 11. NaN protection
// ────────────────────────────────────────
console.log('\n[11] NaN protection — valor_custo ausente');
const fornSemCusto = { fornecedor_id: 'x', fornecedor_nome: 'Y', servico: 'S' };
const cp2 = buildContaPagarFromFornecedor(fornSemCusto, 'forn_x', ctx);
assert(cp2.valor_final === 0, 'valor_final === 0 quando ausente');
assert(!Number.isNaN(cp2.valor_final), 'sem NaN');
const cr3 = buildComissaoReceberFromFornecedor(fornSemCusto, 'forn_x', ctx, 0);
assert(cr3.valor_final === 0, 'cr.valor_final === 0 quando comissão é 0');

// ────────────────────────────────────────
// 12. Cenário completo: 2 fornecedores, 1 venda
// ────────────────────────────────────────
console.log('\n[12] Cenário completo — 2 fornecedores');
const fornsCenario = [
  { fornecedor_id: 'crm_a', fornecedor_nome: 'Hotel A', servico: 'Hospedagem', valor_custo: 6000, vencimento_pagamento: '2026-06-15' },
  { fornecedor_id: 'crm_b', fornecedor_nome: 'Cia B', servico: 'Voo', valor_custo: 4000, vencimento_pagamento: '2026-06-20' },
];
const comissaoTotal = 1500;
const comissaoA = calcularComissaoFornecedor(fornsCenario[0], fornsCenario, comissaoTotal);
const comissaoB = calcularComissaoFornecedor(fornsCenario[1], fornsCenario, comissaoTotal);
assert(comissaoA === 900, 'comissão A: 6000/10000 * 1500 === 900');
assert(comissaoB === 600, 'comissão B: 4000/10000 * 1500 === 600');
assert(comissaoA + comissaoB === comissaoTotal, 'soma === total');

const cpA = buildContaPagarFromFornecedor(fornsCenario[0], 'fa', ctx);
const cpB = buildContaPagarFromFornecedor(fornsCenario[1], 'fb', ctx);
const crA = buildComissaoReceberFromFornecedor(fornsCenario[0], 'fa', ctx, comissaoA);
const crB = buildComissaoReceberFromFornecedor(fornsCenario[1], 'fb', ctx, comissaoB);
assert(cpA.valor_final === 6000 && cpB.valor_final === 4000, 'CP totais corretos');
assert(crA.valor_final === 900 && crB.valor_final === 600, 'CR comissões corretas');
assert(cpA.fornecedor_id === 'fa' && crA.origem_item_id === 'fa', 'CP e CR ligados ao fornecedor A');

// ────────────────────────────────────────
console.log('\n────────────────────────────────────');
if (failed === 0) {
  console.log('✅ Todos os testes passaram');
  process.exit(0);
} else {
  console.error(`❌ ${failed} assert(s) falharam`);
  process.exit(1);
}
