/* eslint-disable no-console */
// Smoke test for the CRM -> Financeiro VENDA_FECHADA mapping.
// Runs the pure builders against a representative payload and asserts that
// the resulting JSONB matches the shape rendered by /financeiro-ag/{receber,pagar}.
//
// Usage: npx tsx scripts/test-crm-venda.ts
//
// Pure mapping only — no DB connection required.

import {
  buildContaReceberFromParcela,
  buildContaPagarFromFornecedor,
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
// 1. Parcela única (PIX) → ContaReceber
// ────────────────────────────────────────
console.log('\n[1] Parcela única (PIX) → ContaReceber');
const parcelaUnica = {
  parcela: 1,
  valor: 5000,
  vencimento: '2026-06-15',
  forma_pagamento: 'pix',
};
const cr1 = buildContaReceberFromParcela(parcelaUnica, ctx, 0, 1);
assert(typeof cr1.id === 'string' && cr1.id.length > 0, 'id gerado');
assert(cr1.origem === 'VENDA', "origem === 'VENDA'");
assert(cr1.status === 'PENDENTE', "status === 'PENDENTE' (uppercase)");
assert(cr1.cliente_id === ctx.clienteId, 'cliente_id');
assert(cr1.cliente_nome === 'João Silva', 'cliente_nome preenchido');
assert(cr1.valor_original === 5000, 'valor_original numero');
assert(cr1.valor_final === 5000, 'valor_final numero (sem NaN)');
assert(cr1.data_vencimento === '2026-06-15', "data_vencimento === 'YYYY-MM-DD'");
assert(cr1.forma_recebimento === 'PIX', "forma_recebimento === 'PIX'");
assert(cr1.parcela_numero === 1 && cr1.total_parcelas === 1, 'parcela 1/1');
assert(cr1.descricao.includes('Venda crm_deal_789'), 'descricao com crm_venda_id');
assert(cr1.auto_gerado === true, 'auto_gerado true');
assert(cr1.venda_id === ctx.vendaId, 'venda_id');
assert(cr1.grupo_id === ctx.enturGrupoId, 'grupo_id');
assert(Array.isArray(cr1.rateio), 'rateio array');
assert(Array.isArray(cr1.anexos), 'anexos array');

// ────────────────────────────────────────
// 2. Múltiplas parcelas (boleto)
// ────────────────────────────────────────
console.log('\n[2] Parcela 2/3 (boleto)');
const parcela2 = {
  parcela: 2,
  valor: 1666.67,
  vencimento: '2026-07-15',
  forma_pagamento: 'boleto',
};
const cr2 = buildContaReceberFromParcela(parcela2, ctx, 1, 3);
assert(cr2.parcela_numero === 2 && cr2.total_parcelas === 3, 'parcela 2/3');
assert(cr2.descricao.includes('Parcela 2/3'), "descricao 'Parcela 2/3 — Venda ...'");
assert(cr2.forma_recebimento === 'BOLETO', "forma_recebimento === 'BOLETO'");
assert(cr2.valor_final === 1666.67, 'valor decimal preservado');

// ────────────────────────────────────────
// 3. Forma de pagamento desconhecida
// ────────────────────────────────────────
console.log('\n[3] forma_pagamento "nao_definida"');
const parcela3 = { parcela: 1, valor: 100, vencimento: '2026-08-01', forma_pagamento: 'nao_definida' };
const cr3 = buildContaReceberFromParcela(parcela3, ctx, 0, 1);
assert(cr3.forma_recebimento === '', "forma_recebimento === '' quando desconhecido (nao quebra UI)");

// ────────────────────────────────────────
// 4. Valor como string (CRM pode mandar "5000.00")
// ────────────────────────────────────────
console.log('\n[4] valor como string "5000.00"');
const parcela4 = { parcela: 1, valor: '5000.00', vencimento: '2026-06-15', forma_pagamento: 'PIX' };
const cr4 = buildContaReceberFromParcela(parcela4, ctx, 0, 1);
assert(cr4.valor_final === 5000, 'valor string -> number');
assert(!Number.isNaN(cr4.valor_final), 'NaN protection');

// ────────────────────────────────────────
// 5. Valor ausente
// ────────────────────────────────────────
console.log('\n[5] valor ausente');
const parcela5 = { parcela: 1, vencimento: '2026-06-15', forma_pagamento: 'PIX' };
const cr5 = buildContaReceberFromParcela(parcela5, ctx, 0, 1);
assert(cr5.valor_final === 0, 'valor ausente -> 0 (NÃO NaN)');
assert(!Number.isNaN(cr5.valor_final), 'NaN protection');

// ────────────────────────────────────────
// 6. Vencimento ISO completo
// ────────────────────────────────────────
console.log('\n[6] vencimento ISO completo');
const parcela6 = { parcela: 1, valor: 100, vencimento: '2026-06-15T12:00:00.000Z', forma_pagamento: 'PIX' };
const cr6 = buildContaReceberFromParcela(parcela6, ctx, 0, 1);
assert(cr6.data_vencimento === '2026-06-15', 'ISO datetime -> YYYY-MM-DD');

// ────────────────────────────────────────
// 7. ContaPagar a partir de fornecedor
// ────────────────────────────────────────
console.log('\n[7] ContaPagar — fornecedor com servico');
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
assert(cp1.descricao.startsWith('Voo SP-RJ'), 'descricao começa com servico');
assert(cp1.valor_original === 3000 && cp1.valor_final === 3000 && cp1.valor_brl === 3000, 'valores 3000');
assert(cp1.data_vencimento === '2026-06-10', 'data_vencimento');
assert(cp1.moeda === 'BRL', "moeda default 'BRL'");
assert(cp1.auto_gerado === true, 'auto_gerado true');
assert(cp1.venda_id === ctx.vendaId, 'venda_id');

// ────────────────────────────────────────
// 8. ContaPagar sem servico
// ────────────────────────────────────────
console.log('\n[8] ContaPagar sem servico');
const fornSemServico = {
  fornecedor_id: 'crm_supplier_99',
  fornecedor_nome: 'Hotel ABC',
  valor_custo: 1500,
  vencimento_pagamento: '2026-06-20',
};
const cp2 = buildContaPagarFromFornecedor(fornSemServico, 'forn_local_99', ctx);
assert(cp2.descricao.includes('Hotel ABC'), 'descricao usa fornecedor_nome quando sem servico');
assert(cp2.valor_final === 1500, 'valor preservado');

// ────────────────────────────────────────
// 9. Shape completo — todos campos do tipo presentes (compatibilidade UI)
// ────────────────────────────────────────
console.log('\n[9] Shape completo de ContaReceber (campos requeridos pela UI)');
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
console.log('\n────────────────────────────────────');
if (failed === 0) {
  console.log('✅ Todos os testes passaram');
  process.exit(0);
} else {
  console.error(`❌ ${failed} assert(s) falharam`);
  process.exit(1);
}
