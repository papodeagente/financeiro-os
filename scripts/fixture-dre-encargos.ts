/**
 * Cenário de agência para o teste dos encargos no DRE (05/11/2026). Tem de
 * tudo: venda com margem, fee, outras receitas, comissão de fornecedor,
 * despesas em vários grupos, repasse, conta sem categoria, parcial, taxa de
 * plataforma, contas com juros/multa/desconto lançados à mão (antes da
 * liquidação nova) e meses diferentes de vencimento e de baixa.
 */
import { getPlanoContasPadrao, type ContaPagar, type ContaReceber, type VendaCRM } from '../src/lib/crm-types.ts';

export const plano = getPlanoContasPadrao();
const cat = (codigo: string) => plano.find(p => p.codigo === codigo)!.id;

const cr = (id: string, d: Partial<ContaReceber>): ContaReceber => ({
  id, origem: 'OUTROS', venda_id: null, grupo_id: null, cliente_id: 'c1', cliente_nome: 'Cliente', descricao: `CR ${id}`,
  categoria_id: '', centro_custo: '', valor_original: 0, juros: 0, multa: 0, desconto: 0, valor_final: 0,
  data_emissao: '2026-10-01', data_vencimento: '2026-10-10', data_recebimento: null, valor_recebido: null,
  conta_bancaria_id: null, forma_recebimento: '', taxa: 0, taxa_plataforma: '', parcela_numero: 1, total_parcelas: 1,
  boleto_emitido: false, boleto_codigo: '', boleto_url: '', status: 'PENDENTE', rateio: [],
  observacoes: '', anexos: [], ...d,
} as unknown as ContaReceber);

const cp = (id: string, d: Partial<ContaPagar>): ContaPagar => ({
  id, origem: 'OUTROS', fornecedor_id: 'f1', fornecedor_nome: 'Fornecedor', descricao: `CP ${id}`, categoria_id: '',
  centro_custo: '', valor_original: 0, juros: 0, multa: 0, desconto: 0, valor_final: 0, moeda: 'BRL', cambio: 1, valor_brl: 0,
  data_emissao: '2026-10-01', data_vencimento: '2026-10-15', data_pagamento: null, valor_pago: null,
  conta_bancaria_id: null, forma_pagamento: '', cartao_id: null, comprovante: '', parcela_numero: 1, total_parcelas: 1,
  natureza_custo: null, is_custo_comercial: false, status: 'PENDENTE', rateio: [], anexos: [], observacoes: '', ...d,
} as unknown as ContaPagar);

export const vendas = [
  { id: 'v1', status: 'FECHADO', valor_final: 10000, valor_total_custo: 8500, data_venda: '2026-10-03', numero: '101' },
  { id: 'v2', status: 'FECHADO', valor_final: 4000, valor_total_custo: 3600, data_venda: '2026-10-20', numero: '102' },
  { id: 'v3', status: 'CANCELADO', valor_final: 999, valor_total_custo: 0, data_venda: '2026-10-05', numero: '103' },
] as unknown as VendaCRM[];

export const receber: ContaReceber[] = [
  // Venda v1 em duas parcelas, uma paga em outubro e outra em novembro.
  cr('r-v1a', { origem: 'VENDA', venda_id: 'v1', origem_venda_id: 'v1', valor_final: 5000, status: 'RECEBIDO', valor_recebido: 5000, data_recebimento: '2026-10-05', taxa: 120 } as Partial<ContaReceber>),
  cr('r-v1b', { origem: 'VENDA', venda_id: 'v1', origem_venda_id: 'v1', valor_final: 5000, data_vencimento: '2026-11-05', status: 'RECEBIDO', valor_recebido: 5000, data_recebimento: '2026-11-04' } as Partial<ContaReceber>),
  // Venda v2 paga em parte.
  cr('r-v2', { origem: 'VENDA', venda_id: 'v2', origem_venda_id: 'v2', valor_final: 4000, status: 'PARCIAL', valor_recebido: 1500, data_recebimento: '2026-10-25', data_vencimento: '2026-10-25' } as Partial<ContaReceber>),
  // Fee com juros lançados à mão, antes da liquidação nova.
  cr('r-fee', { origem: 'FEE', valor_original: 300, juros: 15, valor_final: 315, status: 'RECEBIDO', valor_recebido: 315, data_recebimento: '2026-10-12' }),
  cr('r-out', { origem: 'OUTROS', valor_final: 200, status: 'PENDENTE', data_vencimento: '2026-10-28' }),
  cr('r-com', { origem: 'COMISSAO_FORNECEDOR', venda_id: 'v2', origem_venda_id: 'v2', valor_final: 700, status: 'RECEBIDO', valor_recebido: 700, data_recebimento: '2026-10-30', data_vencimento: '2026-10-30' } as Partial<ContaReceber>),
  cr('r-com2', { origem: 'COMISSAO_FORNECEDOR', valor_final: 250, status: 'PENDENTE', data_vencimento: '2026-10-18' }),
  cr('r-canc', { origem: 'FEE', valor_final: 999, status: 'CANCELADO' }),
];

export const pagar: ContaPagar[] = [
  cp('p-alug', { categoria_id: cat('2.2.01'), valor_final: 2500, status: 'PAGO', valor_pago: 2500, data_pagamento: '2026-10-10' }),
  cp('p-mkt', { categoria_id: cat('2.6.02'), valor_final: 800, status: 'PENDENTE' }),
  cp('p-iss', { categoria_id: cat('2.3.02'), valor_final: 150, status: 'PAGO', valor_pago: 150, data_pagamento: '2026-11-02' }),
  cp('p-tarifa', { categoria_id: cat('2.4.04'), valor_final: 45, multa: 5, valor_original: 40, status: 'PAGO', valor_pago: 45, data_pagamento: '2026-10-16' }),
  cp('p-out', { categoria_id: cat('2.5'), valor_final: 90, status: 'PARCIAL', valor_pago: 30, data_pagamento: '2026-10-20' }),
  cp('p-cmv', { categoria_id: cat('2.1.01'), valor_final: 400, status: 'PENDENTE' }),
  cp('p-rep', { categoria_id: cat('2.1.01'), origem: 'VENDA', auto_gerado: true, valor_final: 8500, status: 'PAGO', valor_pago: 8500, data_pagamento: '2026-10-08' } as Partial<ContaPagar>),
  cp('p-sem', { categoria_id: 'apagada', valor_final: 60, status: 'PAGO', valor_pago: 60, data_pagamento: '2026-10-21' }),
  cp('p-canc', { categoria_id: cat('2.2.01'), valor_final: 999, status: 'CANCELADO' }),
];
