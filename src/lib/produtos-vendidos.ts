/**
 * Financeiro por produto, espelhando o que foi VENDIDO no CRM.
 *
 * Antes esta visão lia o cadastro interno de produtos do próprio
 * financeiro. Como a criação de produto passou a ser feita no CRM, a fonte
 * agora é o item de venda que chegou junto com a venda: é o único registro
 * que representa produto realmente vendido, com custo, preço e fornecedor
 * negociados de verdade.
 *
 * Dinheiro sempre por round2/soma; moeda estrangeira por paraBRL, com o
 * câmbio gravado na venda. Nunca comparar valores de moedas diferentes.
 */
import { round2, num, soma, divSegura, paraBRL, mesDe } from './money';
import type { ItemVendaData, TipoProdutoVenda } from './crm-types';

/** Um item de venda com o contexto da venda a que pertence. */
export interface ProdutoVendido {
  item_id: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  cliente_nome: string;
  vendedor_nome: string;
  status_venda: string;
  tipo: TipoProdutoVenda | string;
  descricao: string;
  fornecedor_nome: string;
  /** Já convertidos para BRL pelo câmbio gravado. */
  custo: number;
  venda: number;
  margem: number;
  margem_pct: number;
  moeda_original: string;
  localizador: string;
}

export interface ResumoTipo {
  tipo: string;
  quantidade: number;
  custo: number;
  venda: number;
  margem: number;
  margem_pct: number;
  /** Participação na receita total, para saber o que sustenta a agência. */
  share_receita_pct: number;
}

export interface PainelProdutos {
  itens: ProdutoVendido[];
  por_tipo: ResumoTipo[];
  total_custo: number;
  total_venda: number;
  total_margem: number;
  margem_pct: number;
  quantidade: number;
  /** Ticket médio por produto vendido, não por venda. */
  ticket_medio: number;
}

/** Status de venda que conta. Cancelada não é produto vendido. */
export const STATUS_VALIDO = ['CONFIRMADO', 'CONCLUIDO'] as const;

export interface EntradaItem {
  id: string;
  venda_id: string;
  data: ItemVendaData;
}

export interface EntradaVenda {
  id: string;
  numero: string;
  data_venda: string;
  status: string;
  cliente_nome: string;
  vendedor_nome: string;
}

export function montarPainelProdutos(
  itens: EntradaItem[],
  vendas: EntradaVenda[],
  filtro?: { mes?: string; tipo?: string; busca?: string },
): PainelProdutos {
  const vendaPorId = new Map(vendas.map(v => [v.id, v]));

  let lista: ProdutoVendido[] = [];
  for (const it of itens ?? []) {
    const venda = vendaPorId.get(it.venda_id);
    // Item órfão ou de venda cancelada não é produto vendido.
    if (!venda || !(STATUS_VALIDO as readonly string[]).includes(venda.status)) continue;

    const d = it.data ?? ({} as ItemVendaData);
    const moeda = d.moeda || 'BRL';
    const cambio = num(d.cambio);
    const custo = paraBRL(num(d.valor_custo), moeda, cambio);
    const vendaValor = paraBRL(num(d.valor_venda), moeda, cambio);
    const margem = round2(vendaValor - custo);

    lista.push({
      item_id: it.id,
      venda_id: venda.id,
      venda_numero: venda.numero,
      data_venda: venda.data_venda,
      cliente_nome: venda.cliente_nome,
      vendedor_nome: venda.vendedor_nome,
      status_venda: venda.status,
      tipo: d.tipo || 'OUTROS',
      descricao: d.descricao || '',
      fornecedor_nome: d.fornecedor_nome || '',
      custo,
      venda: vendaValor,
      margem,
      // Margem sobre a VENDA, não sobre o custo: é o percentual que o
      // agente usa para saber quanto sobra de cada real faturado.
      margem_pct: vendaValor > 0 ? round2(divSegura(margem, vendaValor) * 100) : 0,
      moeda_original: moeda,
      localizador: d.localizador || '',
    });
  }

  if (filtro?.mes) lista = lista.filter(i => mesDe(i.data_venda) === filtro.mes);
  if (filtro?.tipo) lista = lista.filter(i => i.tipo === filtro.tipo);
  if (filtro?.busca) {
    const q = filtro.busca.trim().toLowerCase();
    if (q) {
      lista = lista.filter(i =>
        i.descricao.toLowerCase().includes(q) ||
        i.fornecedor_nome.toLowerCase().includes(q) ||
        i.cliente_nome.toLowerCase().includes(q) ||
        i.venda_numero.toLowerCase().includes(q) ||
        i.localizador.toLowerCase().includes(q),
      );
    }
  }

  const total_custo = soma(lista.map(i => i.custo));
  const total_venda = soma(lista.map(i => i.venda));
  const total_margem = round2(total_venda - total_custo);

  const tipos = new Map<string, ProdutoVendido[]>();
  for (const i of lista) {
    const atual = tipos.get(i.tipo) ?? [];
    atual.push(i);
    tipos.set(i.tipo, atual);
  }

  const por_tipo: ResumoTipo[] = [...tipos.entries()]
    .map(([tipo, itensDoTipo]) => {
      const custo = soma(itensDoTipo.map(i => i.custo));
      const venda = soma(itensDoTipo.map(i => i.venda));
      const margem = round2(venda - custo);
      return {
        tipo,
        quantidade: itensDoTipo.length,
        custo,
        venda,
        margem,
        margem_pct: venda > 0 ? round2(divSegura(margem, venda) * 100) : 0,
        share_receita_pct: total_venda > 0 ? round2(divSegura(venda, total_venda) * 100) : 0,
      };
    })
    .sort((a, b) => b.venda - a.venda);

  return {
    itens: lista.sort((a, b) => (a.data_venda < b.data_venda ? 1 : a.data_venda > b.data_venda ? -1 : 0)),
    por_tipo,
    total_custo,
    total_venda,
    total_margem,
    margem_pct: total_venda > 0 ? round2(divSegura(total_margem, total_venda) * 100) : 0,
    quantidade: lista.length,
    ticket_medio: lista.length > 0 ? round2(divSegura(total_venda, lista.length)) : 0,
  };
}
