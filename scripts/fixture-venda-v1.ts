/**
 * Vendas de exemplo no formato de HOJE (entrada v1 de `gerarContasVenda`).
 * Usadas para congelar a saída antes da E5 e para provar que o sucessor
 * (`contasDaVenda`) responde igual a elas.
 */
import type { VendaInput } from '../src/lib/venda-financeiro.ts';

const venda = (o: Record<string, unknown> = {}) => ({
  id: 'v-1', numero: 'VND-0001', data_venda: '2026-10-10', tipo: 'AVULSA', grupo_id: null,
  cliente_id: 'cli-1', vendedor_id: 'u-1', passageiros: [], pagantes: [], produtos: [],
  valor_total_custo: 0, valor_total_venda: 0, markup_realizado: 0, desconto: 0, valor_final: 0,
  forma_pagamento: 'BOLETO', parcelas: 1, pagamento_detalhado: [], status: 'CONFIRMADO',
  motivo_cancelamento: '', recibo_emitido: false, intermediario_id: null, comissao_intermediario: 0,
  centro_custo: 'Lazer', numero_po: '', anexos: [], observacoes: '', campos_personalizados: {},
  ...o,
}) as unknown as VendaInput['venda'];

const item = (id: string, seq: number, fornecedor_id: string, d: Record<string, unknown>, status = 'ativo') => ({
  id, venda_id: 'v-1', fornecedor_id, sequencia: seq, status,
  data: {
    tipo: 'HOTEL', descricao: `Item ${seq}`, fornecedor_nome: '', meio_pagamento: 'proprio',
    valor_custo: 0, valor_venda: 0, comissao_percentual: 0, comissao_valor: 0, moeda: 'BRL', cambio: 1,
    localizador: '', data_inicio: '', data_fim: '', observacoes: '', contas_geradas_ids: [],
    ...d,
  },
}) as VendaInput['itens'][number];

const fornecedores: VendaInput['fornecedores'] = [
  { id: 'f-hotel', nome_fantasia: 'Hotel Mar', regras_faturamento: { prazo_pagamento_dias: 15 } as never },
  { id: 'f-op', nome_fantasia: 'Operadora Sol', regras_faturamento: { comissao_padrao: 12, regra_vencimento_comissao: { tipo: 'dia_fixo_mes', valor: 31 } } as never },
  { id: 'f-cia', nome_fantasia: 'Cia Aérea', regras_faturamento: null as never },
];

export const VENDAS_V1: Record<string, VendaInput> = {
  // Duas linhas próprias (uma em dólar), uma paga direto com comissão,
  // desconto e três parcelas com 1º vencimento escolhido.
  manual_completa: {
    venda: venda({ desconto: 150, parcelas: 3, primeiro_vencimento: '2026-11-05', forma_pagamento: 'CARTAO' }),
    itens: [
      item('i-1', 1, 'f-hotel', { valor_custo: 800, valor_venda: 1200, fornecedor_nome: 'Hotel Mar' }),
      item('i-2', 2, 'f-cia', { tipo: 'AEREO', valor_custo: 300, valor_venda: 400, moeda: 'USD', cambio: 5.4321, data_pagamento_fornecedor: '2026-10-20' }),
      item('i-3', 3, 'f-op', { tipo: 'PACOTE', meio_pagamento: 'fornecedor', valor_custo: 1800, valor_venda: 2000, comissao_percentual: 10 }),
    ],
    fornecedores, cliente_nome: 'Ana Lima',
  },
  // A mesma, quebrada por fornecedor (o jeito do CRM).
  por_fornecedor: {
    receberPorFornecedor: true,
    venda: venda({ desconto: 150, parcelas: 2, forma_pagamento: 'AVISTA_PIX' }),
    itens: [
      item('i-1', 1, 'f-hotel', { valor_custo: 800, valor_venda: 1200 }),
      item('i-4', 2, 'f-hotel', { valor_custo: 100, valor_venda: 150 }),
      item('i-2', 3, 'f-cia', { tipo: 'AEREO', valor_custo: 300, valor_venda: 400.01 }),
      item('i-5', 4, '', { tipo: 'OUTROS', valor_custo: 0, valor_venda: 99.99 }),
    ],
    fornecedores, cliente_nome: 'Ana Lima',
  },
  // Sem fornecedor no custo, comissão pela regra do cadastro, item inativo,
  // custo zero e comissão já informada em valor.
  bordas: {
    venda: venda({ parcelas: 0, forma_pagamento: 'FATURADO', data_venda: '2026-01-31' }),
    itens: [
      item('i-6', 1, '', { tipo: 'OUTROS', valor_custo: 250, valor_venda: 300 }),
      item('i-7', 2, 'f-op', { tipo: 'PACOTE', meio_pagamento: 'fornecedor', valor_custo: 900, valor_venda: 1000 }),
      item('i-8', 3, 'f-op', { tipo: 'PACOTE', meio_pagamento: 'fornecedor', valor_custo: 0, valor_venda: 500, comissao_valor: 37.5 }),
      item('i-9', 4, 'f-hotel', { valor_custo: 0, valor_venda: 80 }),
      item('i-10', 5, 'f-hotel', { valor_custo: 999, valor_venda: 999 }, 'cancelado'),
      item('i-11', 6, '', { meio_pagamento: 'fornecedor', valor_custo: 50, valor_venda: 60, fornecedor_nome: '' }),
    ],
    fornecedores, cliente_nome: 'Bruno Reis',
  },
};
