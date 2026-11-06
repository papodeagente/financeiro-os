/**
 * Leitura EM LOTE das vendas de um período, já no modelo da venda completa
 * (E5, parte F). Serve os relatórios de vendas e o cálculo de comissões no
 * servidor: as duas coisas leem a MESMA venda, com a mesma receita aberta por
 * componente que a ficha da venda mostra.
 *
 *  - venda completa (vendas_modelo v2): montada das tabelas pelo mesmo
 *    `vendaDasLinhas` da ficha;
 *  - venda de antes (v1): traduzida por `vendaDoV1` a partir de itens_venda; a
 *    venda antiga sem itens (lançada quando só existia a lista de produtos no
 *    cabeçalho) é lida dessa lista, para o relatório não perder venda.
 *
 * Os pagamentos da venda de antes não existem no modelo: para o relatório por
 * forma de pagamento eles vêm do cabeçalho (`pagamento_detalhado` ou a forma
 * única com o valor final).
 *
 * Um punhado de consultas por chamada, nunca uma por venda.
 */
import type { ExecutorSQL } from './caixa-atomico';
import type { ItemVendaData, ProdutoVenda, VendaCRM } from './crm-types';
import type { ItemVendaInput } from './venda-financeiro';
import { reaisParaCentavos, type PagamentoDaVenda, type Venda } from './venda-modelo';
import { formaDoCabecalho } from './relatorios-vendas';
import { vendaDoV1 } from './venda-modelo-v1';
import { fornecedoresInfo, vendaDasLinhas } from './venda-servidor';

export interface VendaLida {
  venda: Venda;
  /** Status do cabeçalho (vendas_crm): CONFIRMADO, CANCELADO... */
  status: string;
  cancelada: boolean;
  situacao: 'ABERTA' | 'FECHADA';
  versao_modelo: 1 | 2;
  /** Pagamentos para o relatório por forma (na v1, vindos do cabeçalho). */
  pagamentos: PagamentoDaVenda[];
  /** Empresa da venda (E7, várias empresas). Ausente = a principal. */
  empresa_id?: string;
}

export interface FiltroDeVendas {
  /** Data da venda, inclusive (AAAA-MM-DD). */
  de?: string;
  ate?: string;
  ids?: string[];
  /** Só as vendas deste vendedor (quem não vê as dos outros). */
  vendedor_id?: string;
  /** Inclui as canceladas (o padrão é não incluir). */
  incluir_canceladas?: boolean;
  /** Empresas no recorte (E7). Ausente ou null = todas. */
  empresas?: readonly string[] | null;
}

type Linha = Record<string, unknown>;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function pagamentosDoCabecalho(cab: Linha, totalCentavos: number): PagamentoDaVenda[] {
  const base = { parcelas: 1, primeiro_vencimento: '', intervalo_dias: 0, pagante: null, fornecedor: null, conta_bancaria_id: null, cartao_tipo: null, detalhe: '', venda_origem_credito: '' };
  const det = Array.isArray(cab.pagamento_detalhado) ? (cab.pagamento_detalhado as Linha[]) : [];
  const lista = det
    .map((d, i) => ({ ...base, id: `cab-${i}`, forma: formaDoCabecalho(d.forma), valor_centavos: reaisParaCentavos(d.valor), parcelas: Math.max(1, Number(d.parcelas) || 1) }))
    .filter(p => p.valor_centavos > 0);
  if (lista.length) return lista;
  if (totalCentavos <= 0) return [];
  return [{ ...base, id: 'cab-0', forma: formaDoCabecalho(cab.forma_pagamento), valor_centavos: totalCentavos, parcelas: Math.max(1, Number(cab.parcelas) || 1) }];
}

/** A venda antiga sem itens_venda: a lista de produtos do cabeçalho vira itens próprios. */
function itensDoCabecalho(vendaId: string, cab: Linha): ItemVendaInput[] {
  const produtos = Array.isArray(cab.produtos) ? (cab.produtos as ProdutoVenda[]) : [];
  const itens: ItemVendaInput[] = produtos.map((p, i) => ({
    id: txt(p.id) || `${vendaId}-p${i + 1}`, venda_id: vendaId, fornecedor_id: txt(p.fornecedor_id), sequencia: i + 1,
    status: p.status === 'CANCELADO' ? 'cancelado' : 'ativo',
    data: {
      tipo: p.tipo, descricao: p.descricao ?? '', fornecedor_nome: p.fornecedor_nome ?? '', meio_pagamento: 'proprio',
      valor_custo: Number(p.valor_custo) || 0, valor_venda: Number(p.valor_venda) || 0,
      comissao_percentual: 0, comissao_valor: 0, moeda: p.moeda ?? 'BRL', cambio: Number(p.cambio) || 1,
      localizador: p.localizador ?? '', data_inicio: p.data_inicio ?? '', data_fim: p.data_fim ?? '', observacoes: '', contas_geradas_ids: [],
    } as ItemVendaData,
  }));
  if (itens.length) return itens;
  // Nem itens nem produtos: a venda inteira vira um produto "Outros".
  const valor = Number(cab.valor_final ?? cab.valor_total_venda) || 0;
  if (valor <= 0) return [];
  return [{
    id: `${vendaId}-total`, venda_id: vendaId, fornecedor_id: '', sequencia: 1, status: 'ativo',
    data: {
      tipo: 'OUTROS', descricao: 'Venda', fornecedor_nome: '', meio_pagamento: 'proprio',
      valor_custo: Number(cab.valor_total_custo) || 0, valor_venda: valor + (Number(cab.desconto) || 0),
      comissao_percentual: 0, comissao_valor: 0, moeda: 'BRL', cambio: 1,
      localizador: '', data_inicio: '', data_fim: '', observacoes: '', contas_geradas_ids: [],
    } as ItemVendaData,
  }];
}

async function tabelaExiste(exec: ExecutorSQL, nome: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass($1) AS t`, [nome]);
  return Boolean(rows[0]?.t);
}

/** As vendas do filtro, no modelo, ordenadas por data e número. */
export async function lerVendas(exec: ExecutorSQL, tenantId: string, filtro: FiltroDeVendas = {}): Promise<VendaLida[]> {
  const cond = ['tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (filtro.de && ISO.test(filtro.de)) { args.push(filtro.de); cond.push(`COALESCE(data->>'data_venda', '') >= $${args.length}`); }
  if (filtro.ate && ISO.test(filtro.ate)) { args.push(filtro.ate); cond.push(`COALESCE(data->>'data_venda', '') <> '' AND LEFT(data->>'data_venda', 10) <= $${args.length}`); }
  if (filtro.ids) { args.push(filtro.ids); cond.push(`id = ANY($${args.length}::text[])`); }
  if (filtro.vendedor_id !== undefined) { args.push(filtro.vendedor_id); cond.push(`(vendedor_id = $${args.length} OR data->>'vendedor_id' = $${args.length})`); }
  // Várias empresas (E7): só as vendas das empresas no recorte.
  if (filtro.empresas) { args.push([...filtro.empresas]); cond.push(`COALESCE(NULLIF(data->>'empresa_id', ''), 'principal') = ANY($${args.length}::text[])`); }
  if (!filtro.incluir_canceladas) cond.push(`UPPER(COALESCE(data->>'status', status, '')) <> 'CANCELADO'`);
  // Orçamento não é venda.
  cond.push(`UPPER(COALESCE(data->>'status', status, '')) NOT IN ('ORCAMENTO')`);
  const { rows: cabs } = await exec.query(
    `SELECT id, cliente_id, vendedor_id, status, data FROM vendas_crm WHERE ${cond.join(' AND ')} ORDER BY data->>'data_venda', id`,
    args,
  );
  if (!cabs.length) return [];
  const ids = cabs.map(r => txt(r.id));

  const temModelo = await tabelaExiste(exec, 'vendas_modelo');
  const modelo = new Map<string, Linha>();
  const filhos = { ps: new Map<string, Linha[]>(), xs: new Map<string, Linha[]>(), cs: new Map<string, Linha[]>(), gs: new Map<string, Linha[]>() };
  if (temModelo) {
    const { rows } = await exec.query(`SELECT * FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = ANY($2::text[])`, [tenantId, ids]);
    for (const r of rows) modelo.set(txt(r.venda_id), r);
    const v2 = rows.filter(r => Number(r.versao_modelo) === 2).map(r => txt(r.venda_id));
    if (v2.length) {
      const a = [tenantId, v2];
      const [ps, xs, cs, gs] = await Promise.all([
        exec.query(`SELECT * FROM venda_produtos WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY sequencia, id`, a),
        exec.query(`SELECT * FROM venda_passageiros WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY ordem, id`, a),
        exec.query(`SELECT * FROM venda_componentes WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY ordem, id`, a),
        exec.query(`SELECT * FROM venda_pagamentos WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY ordem, id`, a),
      ]);
      const agrupar = (mapa: Map<string, Linha[]>, linhas: Linha[]) => {
        for (const l of linhas) { const k = txt(l.venda_id); const lista = mapa.get(k); if (lista) lista.push(l); else mapa.set(k, [l]); }
      };
      agrupar(filhos.ps, ps.rows); agrupar(filhos.xs, xs.rows); agrupar(filhos.cs, cs.rows); agrupar(filhos.gs, gs.rows);
    }
  }

  const v1 = ids.filter(id => Number(modelo.get(id)?.versao_modelo) !== 2);
  const itensPorVenda = new Map<string, ItemVendaInput[]>();
  if (v1.length) {
    const { rows } = await exec.query(
      `SELECT id, venda_id, fornecedor_id, sequencia, status, data FROM itens_venda WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY sequencia`,
      [tenantId, v1],
    ).catch(() => ({ rows: [] as Linha[] }));
    for (const r of rows) {
      const k = txt(r.venda_id);
      const it: ItemVendaInput = { id: txt(r.id), venda_id: k, fornecedor_id: txt(r.fornecedor_id), sequencia: Number(r.sequencia) || 1, status: txt(r.status), data: (r.data ?? {}) as ItemVendaData };
      const lista = itensPorVenda.get(k); if (lista) lista.push(it); else itensPorVenda.set(k, [it]);
    }
  }
  const fornIds = [...itensPorVenda.values()].flat().map(i => i.fornecedor_id);
  const forn = await fornecedoresInfo(exec, tenantId, fornIds);

  // Nomes de cliente e vendedor da venda de antes (o modelo v2 já guarda os dois).
  const clienteIds = [...new Set(cabs.map(r => txt(r.cliente_id)).filter(Boolean))];
  const vendedorIds = [...new Set(cabs.map(r => txt(r.vendedor_id) || txt((r.data as Linha)?.vendedor_id)).filter(Boolean))];
  const nomesCli = new Map<string, string>();
  const nomesVen = new Map<string, string>();
  if (clienteIds.length) {
    const { rows } = await exec.query(`SELECT id, nome FROM clientes WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, clienteIds]).catch(() => ({ rows: [] as Linha[] }));
    for (const r of rows) nomesCli.set(txt(r.id), txt(r.nome));
  }
  if (vendedorIds.length) {
    const { rows } = await exec.query(`SELECT id, nome FROM usuarios WHERE id = ANY($1::text[])`, [vendedorIds]).catch(() => ({ rows: [] as Linha[] }));
    for (const r of rows) nomesVen.set(txt(r.id), txt(r.nome));
  }

  const saida: VendaLida[] = [];
  for (const r of cabs) {
    const id = txt(r.id);
    const cab = (r.data ?? {}) as Linha;
    const m = modelo.get(id);
    const status = (txt(cab.status) || txt(r.status)).toUpperCase();
    let venda: Venda;
    let versao: 1 | 2 = 1;
    if (m && Number(m.versao_modelo) === 2) {
      versao = 2;
      venda = vendaDasLinhas(id, m, cab, filhos.ps.get(id) ?? [], filhos.xs.get(id) ?? [], filhos.cs.get(id) ?? [], filhos.gs.get(id) ?? []);
    } else {
      const itens = itensPorVenda.get(id) ?? itensDoCabecalho(id, cab);
      const vendedorId = txt(r.vendedor_id) || txt(cab.vendedor_id);
      venda = vendaDoV1({ ...(cab as unknown as VendaCRM), id, vendedor_id: vendedorId } as VendaCRM & Record<string, unknown>, itens, forn, {
        cliente_nome: nomesCli.get(txt(r.cliente_id)) || txt(cab.cliente_nome),
        vendedor_nome: nomesVen.get(vendedorId) || txt(cab.vendedor_nome_crm) || txt(cab.vendedor_nome),
      });
      venda.id = id;
    }
    if (venda.vendedor && !venda.vendedor.nome) venda.vendedor = { ...venda.vendedor, nome: nomesVen.get(venda.vendedor.id) ?? '' };
    if (!venda.cliente.nome) venda.cliente = { ...venda.cliente, nome: nomesCli.get(venda.cliente.id) || txt(cab.cliente_nome) };
    const situacao: 'ABERTA' | 'FECHADA' = txt(m?.situacao) === 'FECHADA' ? 'FECHADA' : 'ABERTA';
    venda.situacao = situacao;
    const pagamentos = versao === 2 ? venda.pagamentos : pagamentosDoCabecalho(cab, reaisParaCentavos(cab.valor_final ?? cab.valor_total_venda));
    saida.push({ venda, status, cancelada: status === 'CANCELADO', situacao, versao_modelo: versao, pagamentos, empresa_id: txt(cab.empresa_id) || 'principal' });
  }
  return saida;
}

/** Recebimentos do cliente de cada venda, com data (para liberar comissão no recebimento). */
export interface RecebimentoDaVenda {
  /** Total que o cliente deve à agência por esta venda (contas a receber dele, sem as canceladas). */
  total_centavos: number;
  /** Cada entrada (+) ou estorno (−) com a data. */
  movimentos: Array<{ data: string; centavos: number }>;
}

/**
 * Contas a receber DO CLIENTE (origem da venda, não a comissão do fornecedor
 * nem o retido pelo intermediário) e o que entrou nelas, por data. Usa o
 * histórico de baixas quando existe; a conta baixada antes dele conta pela
 * data e valor pagos gravados nela.
 */
export async function lerRecebimentos(exec: ExecutorSQL, tenantId: string, vendaIds: string[]): Promise<Map<string, RecebimentoDaVenda>> {
  const mapa = new Map<string, RecebimentoDaVenda>();
  if (!vendaIds.length) return mapa;
  const { rows: contas } = await exec.query(
    `SELECT id, COALESCE(NULLIF(venda_id, ''), data->>'origem_venda_id', data->>'venda_id') AS venda, data FROM contas_receber
      WHERE tenant_id = $1 AND COALESCE(NULLIF(venda_id, ''), data->>'origem_venda_id', data->>'venda_id') = ANY($2::text[])`,
    [tenantId, vendaIds],
  );
  const doCliente = contas.filter(r => {
    const d = (r.data ?? {}) as Linha;
    const origem = txt(d.origem) || 'VENDA';
    return origem !== 'COMISSAO_FORNECEDOR' && origem !== 'OUTROS' && txt(d.status).toUpperCase() !== 'CANCELADO';
  });
  const ids = doCliente.map(r => txt(r.id));
  const baixasPorConta = new Map<string, Array<{ data: string; centavos: number }>>();
  if (ids.length && await tabelaExiste(exec, 'baixas')) {
    const { rows } = await exec.query(
      `SELECT titulo_id, tipo, data_baixa, valor_centavos FROM baixas WHERE tenant_id = $1 AND titulo_tabela = 'contas_receber' AND titulo_id = ANY($2::text[])`,
      [tenantId, ids],
    );
    for (const b of rows) {
      const k = txt(b.titulo_id);
      const data = b.data_baixa instanceof Date ? b.data_baixa.toISOString().slice(0, 10) : txt(b.data_baixa).slice(0, 10);
      const v = Number(b.valor_centavos) || 0;
      const lista = baixasPorConta.get(k) ?? [];
      lista.push({ data, centavos: txt(b.tipo) === 'estorno' ? -v : v });
      baixasPorConta.set(k, lista);
    }
  }
  for (const r of doCliente) {
    const vendaId = txt(r.venda);
    const d = (r.data ?? {}) as Linha;
    const rec = mapa.get(vendaId) ?? { total_centavos: 0, movimentos: [] };
    rec.total_centavos += reaisParaCentavos(d.valor_final ?? d.valor_original);
    const bx = baixasPorConta.get(txt(r.id));
    if (bx && bx.length) rec.movimentos.push(...bx);
    else {
      const st = txt(d.status).toUpperCase();
      const pago = reaisParaCentavos(d.valor_pago);
      if ((st === 'RECEBIDO' || st === 'PARCIAL') && pago > 0) rec.movimentos.push({ data: txt(d.data_pagamento).slice(0, 10) || txt(d.data_vencimento).slice(0, 10), centavos: pago });
    }
    mapa.set(vendaId, rec);
  }
  return mapa;
}
