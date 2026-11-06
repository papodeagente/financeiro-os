/**
 * A venda de antes da E5 (itens próprio/fornecedor) lida no modelo novo, só
 * para MOSTRAR (tela da venda, posição, receita). As contas dela continuam
 * saindo de `gerarContasVenda` (v1), sem mudança.
 *
 * Tradução de cada item:
 *  - próprio (a agência recebe do cliente e paga o fornecedor): tarifa = custo
 *    e Markup = venda − custo (Desconto, se negativo);
 *  - pago direto ao fornecedor: o fornecedor cobra; tarifa = venda e
 *    Comissão = a comissão do item (a mesma conta de `calcularComissao`).
 * O desconto da venda é rateado sobre os itens próprios, como na v1.
 *
 * Arquivo puro.
 */
import { calcularComissao, type FornecedorInfo, type ItemVendaInput } from './venda-financeiro';
import { paraBRL, ratearDesconto, num, round2 } from './money';
import type { TipoProdutoVenda, VendaCRM } from './crm-types';
import {
  normalizarCambio, normalizarMoeda, reaisParaCentavos,
  type ComponenteDeReceita, type ProdutoDaVenda, type TipoProduto, type Venda,
} from './venda-modelo';

/** Tipo do item de antes → tipo do modelo. */
export const TIPO_DO_V1: Record<TipoProdutoVenda, TipoProduto> = {
  AEREO: 'AEREO', HOTEL: 'HOSPEDAGEM', PACOTE: 'PACOTE', SEGURO: 'SEGURO', RECEPTIVO: 'RECEPTIVO',
  CRUZEIRO: 'CRUZEIRO', CARRO: 'LOCACAO', INGRESSO: 'INGRESSO', GRUPO: 'PACOTE', OUTROS: 'OUTROS',
};

/** Tipo do modelo → tipo dos itens de antes (as telas antigas e as regras de comissão por produto). */
export const TIPO_PARA_V1: Record<TipoProduto, TipoProdutoVenda> = {
  AEREO: 'AEREO', AEREO_AGENCIA: 'AEREO', HOSPEDAGEM: 'HOTEL', PACOTE: 'PACOTE', CRUZEIRO: 'CRUZEIRO',
  SEGURO: 'SEGURO', LOCACAO: 'CARRO', RECEPTIVO: 'RECEPTIVO', INGRESSO: 'INGRESSO', OUTROS: 'OUTROS',
};

export function vendaDoV1(
  venda: VendaCRM & Record<string, unknown>,
  itens: ItemVendaInput[],
  fornecedores: FornecedorInfo[] = [],
  extras: { cliente_nome?: string; vendedor_nome?: string } = {},
): Venda {
  const cadastro = new Map(fornecedores.map(f => [f.id, f]));
  const ativos = itens.filter(i => i.status === 'ativo').sort((a, b) => a.sequencia - b.sequencia);
  const proprios = ativos.filter(i => i.data.meio_pagamento !== 'fornecedor');
  // O desconto é rateado em reais, como na v1 (paraBRL), e volta para a moeda do item.
  const vendasProprias = proprios.map(i => paraBRL(i.data.valor_venda, i.data.moeda, i.data.cambio));
  const desconto = Math.min(Math.max(round2(num(venda.desconto)), 0), vendasProprias.reduce((a, b) => round2(a + b), 0));
  const liquidas = ratearDesconto(vendasProprias, desconto);
  const produtos: ProdutoDaVenda[] = ativos.map((it, i) => {
    const d = it.data;
    const moeda = normalizarMoeda(d.moeda);
    const custo = reaisParaCentavos(d.valor_custo);
    const vendaItem = reaisParaCentavos(d.valor_venda);
    const forn = cadastro.get(it.fornecedor_id);
    const nomeForn = (d.fornecedor_nome || forn?.nome_fantasia || '').trim();
    const componentes: ComponenteDeReceita[] = [];
    let tarifa = custo;
    let quem_cobra: ProdutoDaVenda['quem_cobra'] = 'AGENCIA';
    if (d.meio_pagamento === 'fornecedor') {
      quem_cobra = 'FORNECEDOR';
      tarifa = vendaItem;
      const { comissao_valor, comissao_percentual } = calcularComissao(d, forn);
      const c = reaisParaCentavos(comissao_valor);
      if (c > 0) componentes.push({ id: `${it.id}-comissao`, tipo: 'COMISSAO', valor_centavos: c, percentual: comissao_percentual || null, passageiro_id: null, descricao: '' });
    } else {
      const k = proprios.indexOf(it);
      const cambio = normalizarCambio(moeda, d.cambio);
      const descontoBrl = reaisParaCentavos(round2((vendasProprias[k] ?? 0) - (liquidas[k] ?? 0)));
      const descontoDoItem = moeda === 'BRL' ? descontoBrl : Math.round(descontoBrl / cambio);
      const margem = vendaItem - custo;
      if (margem > 0) componentes.push({ id: `${it.id}-markup`, tipo: 'MARKUP', valor_centavos: margem, percentual: null, passageiro_id: null, descricao: '' });
      if (margem < 0) componentes.push({ id: `${it.id}-perda`, tipo: 'DESCONTO', valor_centavos: -margem, percentual: null, passageiro_id: null, descricao: 'Vendido abaixo do custo' });
      if (descontoDoItem > 0) componentes.push({ id: `${it.id}-desconto`, tipo: 'DESCONTO', valor_centavos: descontoDoItem, percentual: null, passageiro_id: null, descricao: 'Desconto da venda' });
    }
    return {
      id: it.id, sequencia: i + 1, tipo: TIPO_DO_V1[d.tipo] ?? 'OUTROS', descricao: d.descricao || '',
      fornecedor: it.fornecedor_id || nomeForn ? { id: it.fornecedor_id || '', nome: nomeForn } : null,
      representante: null, quem_cobra, moeda, cambio: normalizarCambio(moeda, d.cambio),
      localizador: d.localizador || '', data_inicio: d.data_inicio || '', data_fim: d.data_fim || '',
      data_pagamento_fornecedor: d.data_pagamento_fornecedor || '',
      quantidade: 1, valor_unitario_centavos: tarifa, taxas_centavos: 0,
      passageiros: [], componentes, detalhes: {}, cancelado_em: null, produto_crm_id: '',
    };
  });
  return {
    id: venda.id, numero: venda.numero || '', data_venda: venda.data_venda || '',
    cliente: { id: venda.cliente_id || '', nome: extras.cliente_nome || '' },
    vendedor: venda.vendedor_id ? { id: venda.vendedor_id, nome: extras.vendedor_nome || '' } : null,
    intermediario: null, grupo_id: venda.grupo_id ?? null, centro_custo: venda.centro_custo || '',
    origem: String(venda.origem ?? '') === 'crm' ? 'crm' : 'manual',
    situacao: 'ABERTA', produtos, pagamentos: [], observacoes: venda.observacoes || '',
    crm_venda_id: String(venda.crm_venda_id ?? ''),
  };
}
