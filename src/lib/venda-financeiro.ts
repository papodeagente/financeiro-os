/**
 * Lógica pura de geração de contas financeiras a partir de uma venda com itens.
 * Sem acesso a banco — recebe dados, retorna contas a criar.
 */

import { generateId } from './utils';
import {
  addDias,
  addMeses,
  dataLocal,
  dataSegura,
  dividirParcelas,
  hojeISO,
  num,
  paraBRL,
  percentual,
  ratearDesconto,
  round2,
  soma,
} from './money';
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
  /** Já LÍQUIDO do desconto da venda (é o que vira contas a receber). */
  total_cliente: number;
  total_comissoes: number;
  total_custos: number;
  lucro_previsto: number;
  /** Desconto da venda efetivamente rateado sobre os itens próprios. */
  desconto_aplicado: number;
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
  if (!regra) {
    // Default: 30 dias após venda
    return addDias(dataVenda, 30);
  }

  if (regra.tipo === 'dias_apos_venda') {
    return addDias(dataVenda, num(regra.valor));
  }

  // dia_fixo_mes: próximo mês no dia fixo (dia inexistente cai no último do mês)
  const proximoMes = dataLocal(addMeses(dataVenda, 1));
  if (!proximoMes) return addDias(dataVenda, 30);
  return dataSegura(proximoMes.getFullYear(), proximoMes.getMonth() + 1, num(regra.valor));
}

/**
 * Comissão do item, na MESMA moeda do item (a conversão p/ BRL é feita por
 * quem chama, uma única vez, via paraBRL).
 */
export function calcularComissao(
  item: ItemVendaData,
  fornecedor: FornecedorInfo | undefined,
): { comissao_valor: number; comissao_percentual: number } {
  const base = round2(num(item.valor_venda));

  // Se o item já tem comissão definida manualmente, usar
  if (num(item.comissao_valor) > 0) {
    const valor = round2(item.comissao_valor);
    const pct = base > 0
      ? round2((valor / base) * 100)
      : num(item.comissao_percentual);
    return { comissao_valor: valor, comissao_percentual: pct };
  }

  if (num(item.comissao_percentual) > 0) {
    return {
      comissao_percentual: num(item.comissao_percentual),
      comissao_valor: percentual(base, item.comissao_percentual),
    };
  }

  // Fallback: usar comissao_padrao do fornecedor
  const pct = num(fornecedor?.regras_faturamento?.comissao_padrao);
  return {
    comissao_percentual: pct,
    comissao_valor: percentual(base, pct),
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
  const hoje = hojeISO();

  // Contrato de moeda: item.data.valor_custo / valor_venda vêm SEMPRE na moeda
  // original do item (item.data.moeda). A conversão p/ BRL acontece só aqui,
  // uma única vez, via paraBRL — nunca pré-multiplicada por quem chama.
  const vendasProprioBRL: number[] = [];
  const comissoesBRL: number[] = [];
  const custosBRL: number[] = [];
  let itens_proprio = 0;
  let itens_fornecedor = 0;

  const itensAtivos = itens.filter(i => i.status === 'ativo');

  for (const item of itensAtivos) {
    const fornecedor = fornecedorMap.get(item.fornecedor_id);
    const { comissao_valor, comissao_percentual } = calcularComissao(item.data, fornecedor);
    const moeda = item.data.moeda || 'BRL';
    const cambio = num(item.data.cambio) || 1;
    const custoBRL = paraBRL(item.data.valor_custo, moeda, cambio);
    const vendaBRL = paraBRL(item.data.valor_venda, moeda, cambio);
    const comissaoBRL = paraBRL(comissao_valor, moeda, cambio);
    const meio: MeioPagamento = item.data.meio_pagamento;

    if (meio === 'proprio') {
      // ---- FLUXO PRÓPRIO ----
      // Cliente paga à agência (valor_venda)
      vendasProprioBRL.push(vendaBRL);
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
        // CONTRATO DE MOEDA (vale para toda conta a pagar/receber do sistema):
        //   valor_original -> valor na MOEDA DE ORIGEM (o que o fornecedor cobra)
        //   valor_final    -> SEMPRE em BRL, é o campo que todos os relatórios somam
        //   moeda/cambio   -> como se chegou de um ao outro
        // Gravar valor_final na moeda estrangeira faria fluxo de caixa, DRE,
        // hub e limite de cartão lerem USD como se fosse real.
        valor_original: round2(num(item.data.valor_custo)),
        juros: 0, multa: 0, desconto: 0,
        valor_final: custoBRL,
        moeda,
        cambio,
        valor_brl: custoBRL,
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
      custosBRL.push(custoBRL);

    } else {
      // ---- FLUXO FORNECEDOR ----
      // Cliente paga diretamente ao fornecedor. Fornecedor deve comissão à agência.
      itens_fornecedor++;

      if (comissaoBRL > 0) {
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
          valor_original: comissaoBRL,
          juros: 0, multa: 0, desconto: 0,
          valor_final: comissaoBRL,
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
        comissoesBRL.push(comissaoBRL);
      }
    }

    itens_processados.push(item.id);
  }

  // O desconto da venda sai da margem da agência: rateia proporcionalmente
  // sobre os itens próprios (é o que o cliente efetivamente paga) e só então
  // parcela. Parcelar o bruto cobraria o desconto do cliente de volta.
  const totalBruto = soma(vendasProprioBRL);
  const desconto_aplicado = Math.min(Math.max(round2(num(venda.desconto)), 0), totalBruto);
  const vendasLiquidas = ratearDesconto(vendasProprioBRL, desconto_aplicado);
  const total_cliente = soma(vendasLiquidas);
  const total_comissoes = soma(comissoesBRL);
  const total_custos = soma(custosBRL);

  // Conta a receber do cliente (agrupada — soma dos itens próprios)
  if (total_cliente > 0) {
    const parcelas = Math.max(1, Math.floor(num(venda.parcelas)) || 1);
    const valoresParcela = dividirParcelas(total_cliente, parcelas);

    for (let p = 1; p <= parcelas; p++) {
      const venc = calcularVencimentoParcela(venda.data_venda, p, parcelas);
      const valorEsta = valoresParcela[p - 1];

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

  const lucro_previsto = round2(total_cliente + total_comissoes - total_custos);

  return {
    contas_receber,
    contas_pagar,
    resumo: {
      total_cliente,
      total_comissoes,
      total_custos,
      lucro_previsto,
      desconto_aplicado,
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
  const prazo = fornecedor?.regras_faturamento?.prazo_pagamento_dias ?? 30;
  return addDias(dataVenda, num(prazo));
}

function calcularVencimentoParcela(
  dataVenda: string,
  parcela: number,
  _totalParcelas: number,
): string {
  return addMeses(dataVenda, parcela);
}
