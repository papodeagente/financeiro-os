/**
 * Lógica pura de geração de contas financeiras a partir de uma venda com itens.
 * Sem acesso a banco — recebe dados, retorna contas a criar.
 */

import { generateId } from './utils';
import type {
  ContaReceber,
  ContaPagar,
  ItemVendaData,
  MeioPagamento,
  RegraVencimentoComissao,
  FornecedorCRM,
  VendaCRM,
} from './crm-types';

// ============================================================
// Tipos de entrada/saída
// ============================================================

export interface ItemVendaInput {
  id: string;
  venda_id: string;
  fornecedor_id: string;
  sequencia: number;
  status: string;
  data: ItemVendaData;
}

export interface FornecedorInfo {
  id: string;
  nome_fantasia: string;
  regras_faturamento: FornecedorCRM['regras_faturamento'];
}

export interface VendaInput {
  venda: VendaCRM;
  itens: ItemVendaInput[];
  fornecedores: FornecedorInfo[];
  cliente_nome: string;
}

export interface ContasGeradas {
  contas_receber: ContaReceber[];
  contas_pagar: ContaPagar[];
  resumo: ResumoFinanceiro;
  itens_processados: string[];
}

export interface ResumoFinanceiro {
  total_cliente: number;
  total_comissoes: number;
  total_custos: number;
  lucro_previsto: number;
  itens_proprio: number;
  itens_fornecedor: number;
}

// ============================================================
// Helpers
// ============================================================

export function calcularVencimentoComissao(
  dataVenda: string,
  regra: RegraVencimentoComissao | undefined,
): string {
  const dv = new Date(dataVenda + 'T12:00:00');

  if (!regra) {
    // Default: 30 dias após venda
    dv.setDate(dv.getDate() + 30);
    return dv.toISOString().split('T')[0];
  }

  if (regra.tipo === 'dias_apos_venda') {
    dv.setDate(dv.getDate() + regra.valor);
    return dv.toISOString().split('T')[0];
  }

  // dia_fixo_mes: próximo mês no dia fixo
  const dia = Math.min(regra.valor, 28);
  const nextMonth = new Date(dv.getFullYear(), dv.getMonth() + 1, dia);
  return nextMonth.toISOString().split('T')[0];
}

export function calcularComissao(
  item: ItemVendaData,
  fornecedor: FornecedorInfo | undefined,
): { comissao_valor: number; comissao_percentual: number } {
  // Se o item já tem comissão definida manualmente, usar
  if (item.comissao_valor > 0) {
    const pct = item.valor_venda > 0
      ? (item.comissao_valor / item.valor_venda) * 100
      : item.comissao_percentual;
    return { comissao_valor: item.comissao_valor, comissao_percentual: pct };
  }

  if (item.comissao_percentual > 0) {
    return {
      comissao_percentual: item.comissao_percentual,
      comissao_valor: Math.round(item.valor_venda * item.comissao_percentual / 100 * 100) / 100,
    };
  }

  // Fallback: usar comissao_padrao do fornecedor
  const pct = fornecedor?.regras_faturamento?.comissao_padrao ?? 0;
  return {
    comissao_percentual: pct,
    comissao_valor: Math.round(item.valor_venda * pct / 100 * 100) / 100,
  };
}

// ============================================================
// Geração principal
// ============================================================

export function gerarContasVenda(input: VendaInput): ContasGeradas {
  const { venda, itens, fornecedores, cliente_nome } = input;
  const contas_receber: ContaReceber[] = [];
  const contas_pagar: ContaPagar[] = [];
  const itens_processados: string[] = [];

  const fornecedorMap = new Map(fornecedores.map(f => [f.id, f]));
  const hoje = new Date().toISOString().split('T')[0];

  let total_cliente = 0;
  let total_comissoes = 0;
  let total_custos = 0;
  let itens_proprio = 0;
  let itens_fornecedor = 0;

  const itensAtivos = itens.filter(i => i.status === 'ativo');

  for (const item of itensAtivos) {
    const fornecedor = fornecedorMap.get(item.fornecedor_id);
    const { comissao_valor, comissao_percentual } = calcularComissao(item.data, fornecedor);
    const meio: MeioPagamento = item.data.meio_pagamento;

    if (meio === 'proprio') {
      // ---- FLUXO PRÓPRIO ----
      // Cliente paga à agência (valor_venda)
      total_cliente += item.data.valor_venda;
      itens_proprio++;

      // Conta a pagar ao fornecedor (valor_custo)
      const cp: ContaPagar = {
        id: generateId(),
        origem: 'VENDA',
        venda_id: venda.id,
        grupo_id: venda.grupo_id,
        fornecedor_id: item.fornecedor_id,
        fornecedor_nome: item.data.fornecedor_nome || fornecedor?.nome_fantasia || '',
        descricao: `Custo ${item.data.tipo} — ${item.data.descricao || 'Item ' + item.sequencia}`,
        categoria_id: '',
        centro_custo: venda.centro_custo || '',
        valor_original: item.data.valor_custo,
        juros: 0, multa: 0, desconto: 0,
        valor_final: item.data.valor_custo,
        moeda: item.data.moeda || 'BRL',
        cambio: item.data.cambio || 1,
        valor_brl: item.data.valor_custo * (item.data.cambio || 1),
        data_emissao: hoje,
        data_vencimento: calcularVencimentoPagamento(venda.data_venda, fornecedor),
        data_pagamento: null,
        valor_pago: null,
        conta_bancaria_id: null,
        forma_pagamento: '',
        cartao_id: null,
        comprovante: '',
        parcela_numero: 1,
        total_parcelas: 1,
        natureza_custo: 'VARIAVEL',
        is_custo_comercial: false,
        status: 'PENDENTE',
        rateio: [], anexos: [], observacoes: '',
        origem_venda_id: venda.id,
        origem_item_id: item.id,
        auto_gerado: true,
      };
      contas_pagar.push(cp);
      total_custos += item.data.valor_custo;

    } else {
      // ---- FLUXO FORNECEDOR ----
      // Cliente paga diretamente ao fornecedor. Fornecedor deve comissão à agência.
      itens_fornecedor++;

      if (comissao_valor > 0) {
        const cr: ContaReceber = {
          id: generateId(),
          origem: 'COMISSAO_FORNECEDOR',
          venda_id: venda.id,
          grupo_id: venda.grupo_id,
          cliente_id: item.fornecedor_id,
          cliente_nome: item.data.fornecedor_nome || fornecedor?.nome_fantasia || '',
          descricao: `Comissão ${comissao_percentual.toFixed(1)}% — ${item.data.descricao || 'Item ' + item.sequencia}`,
          categoria_id: '',
          centro_custo: venda.centro_custo || '',
          valor_original: comissao_valor,
          juros: 0, multa: 0, desconto: 0,
          valor_final: comissao_valor,
          data_emissao: hoje,
          data_vencimento: calcularVencimentoComissao(
            venda.data_venda,
            fornecedor?.regras_faturamento?.regra_vencimento_comissao,
          ),
          data_recebimento: null,
          valor_recebido: null,
          conta_bancaria_id: null,
          forma_recebimento: '',
          parcela_numero: 1,
          total_parcelas: 1,
          boleto_emitido: false, boleto_codigo: '', boleto_url: '',
          status: 'PENDENTE',
          rateio: [], anexos: [], observacoes: '',
          origem_venda_id: venda.id,
          origem_item_id: item.id,
          auto_gerado: true,
        };
        contas_receber.push(cr);
        total_comissoes += comissao_valor;
      }
    }

    itens_processados.push(item.id);
  }

  // Conta a receber do cliente (agrupada — soma dos itens próprios)
  if (total_cliente > 0) {
    const parcelas = venda.parcelas || 1;
    const valorParcela = Math.round(total_cliente / parcelas * 100) / 100;

    for (let p = 1; p <= parcelas; p++) {
      const venc = calcularVencimentoParcela(venda.data_venda, p, parcelas);
      const valorEsta = p === parcelas
        ? Math.round((total_cliente - valorParcela * (parcelas - 1)) * 100) / 100
        : valorParcela;

      const cr: ContaReceber = {
        id: generateId(),
        origem: 'VENDA',
        venda_id: venda.id,
        grupo_id: venda.grupo_id,
        cliente_id: venda.cliente_id,
        cliente_nome: cliente_nome,
        descricao: parcelas > 1
          ? `Venda ${venda.numero} — Parcela ${p}/${parcelas}`
          : `Venda ${venda.numero}`,
        categoria_id: '',
        centro_custo: venda.centro_custo || '',
        valor_original: valorEsta,
        juros: 0, multa: 0, desconto: 0,
        valor_final: valorEsta,
        data_emissao: hoje,
        data_vencimento: venc,
        data_recebimento: null,
        valor_recebido: null,
        conta_bancaria_id: null,
        forma_recebimento: '',
        parcela_numero: p,
        total_parcelas: parcelas,
        boleto_emitido: false, boleto_codigo: '', boleto_url: '',
        status: 'PENDENTE',
        rateio: [], anexos: [], observacoes: '',
        origem_venda_id: venda.id,
        auto_gerado: true,
      };
      contas_receber.push(cr);
    }
  }

  const lucro_previsto = total_cliente + total_comissoes - total_custos;

  return {
    contas_receber,
    contas_pagar,
    resumo: {
      total_cliente,
      total_comissoes,
      total_custos,
      lucro_previsto,
      itens_proprio,
      itens_fornecedor,
    },
    itens_processados,
  };
}

// ============================================================
// Helpers internos
// ============================================================

function calcularVencimentoPagamento(
  dataVenda: string,
  fornecedor: FornecedorInfo | undefined,
): string {
  const dv = new Date(dataVenda + 'T12:00:00');
  const prazo = fornecedor?.regras_faturamento?.prazo_pagamento_dias ?? 30;
  dv.setDate(dv.getDate() + prazo);
  return dv.toISOString().split('T')[0];
}

function calcularVencimentoParcela(
  dataVenda: string,
  parcela: number,
  _totalParcelas: number,
): string {
  const dv = new Date(dataVenda + 'T12:00:00');
  dv.setMonth(dv.getMonth() + parcela);
  return dv.toISOString().split('T')[0];
}
