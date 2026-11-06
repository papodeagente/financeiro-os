/**
 * VENDA_FECHADA v2: a venda completa vinda do CRM (E5, parte A).
 *
 * A v2 é a v1 com um bloco a mais, `venda`, e a marca `versao_venda: 2`. Os
 * campos da v1 (cliente, vendedor, valor_total, custo_total, fornecedores,
 * plataforma...) continuam no payload: um Financeiro que ainda não conhece a
 * v2 segue entendendo a venda pelo jeito antigo. Quem conhece usa o bloco
 * `venda` e o MESMO modelo e gerador da venda lançada à mão.
 *
 * O CRM fala em REAIS (com centavos). Aqui tudo vira centavos.
 * Formato completo do bloco em `docs/programa/e5-contratos.md` (seção do
 * contrato com o CRM).
 *
 * Arquivo puro: devolve o modelo com as pessoas ainda por resolver (id vazio,
 * `id_externo` e o pedaço do payload para o cadastro). Quem grava resolve
 * fornecedor, representante, intermediário e pagante e preenche os ids.
 */
import {
  normalizarVenda, reaisParaCentavos,
  type ErroDaVenda, type ParteDaVenda, type Venda,
} from './venda-modelo';

/** O payload traz a venda completa? */
export function ehVendaV2(payload: Record<string, unknown>): boolean {
  return Number(payload.versao_venda) >= 2 && !!payload.venda && typeof payload.venda === 'object' && !Array.isArray(payload.venda);
}

/** Pessoa do payload v2 (fornecedor, representante, intermediário) no formato do cadastro do CRM. */
export interface PessoaDoCrm {
  /** O objeto como veio (fornecedor_id, crm_supplier_id, fornecedor_nome, fornecedor_cnpj...), para `lerFornecedorDaVenda`. */
  bruto: Record<string, unknown>;
  /** Onde ela aparece no modelo. */
  onde: { tipo: 'fornecedor' | 'representante'; produto: number } | { tipo: 'intermediario' } | { tipo: 'fornecedor_do_pagamento'; pagamento: number };
}

/** Pagante diferente do cliente da venda (um contato do CRM). */
export interface PaganteDoCrm {
  pagamento: number;
  cliente_id: string;
  nome: string;
  cpf_cnpj: string;
  email: string;
}

export interface VendaV2Lida {
  venda: Venda;
  erros: ErroDaVenda[];
  pessoas: PessoaDoCrm[];
  pagantes: PaganteDoCrm[];
  /** Comissão do vendedor informada pelo CRM (só referência; o cálculo é do Financeiro). */
  comissao_vendedor: { percentual: number | null; valor_centavos: number | null } | null;
}

const txt = (v: unknown, max = 300) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(x => obj(x) ?? {}) : []);

function nomeDoFornecedor(f: Record<string, unknown>): string {
  return txt(f.fornecedor_nome) || txt(f.nome);
}
function parteDoFornecedor(f: Record<string, unknown> | null): ParteDaVenda | null {
  if (!f) return null;
  const nome = nomeDoFornecedor(f);
  const ext = txt(f.crm_supplier_id) || txt(f.fornecedor_id);
  if (!nome && !ext && !txt(f.financeiro_id)) return null;
  return { id: txt(f.financeiro_id), nome, id_externo: ext, ...(txt(f.fornecedor_cnpj) ? { documento: txt(f.fornecedor_cnpj) } : {}) };
}

/**
 * Lê o bloco `venda` da v2 no modelo. Ids estáveis vindos do CRM (`ref`):
 * produto `crm:<ref>`, passageiro `crm:<produto>:<ref>`, pagamento
 * `crm:pag:<ref>`. Reenviar a mesma venda dá os mesmos ids, e é isso que
 * preserva o que já foi baixado.
 */
export function lerVendaV2(payload: Record<string, unknown>, base: { id: string; numero: string; data_venda: string; cliente: ParteDaVenda; vendedor: ParteDaVenda | null; grupo_id: string | null }): VendaV2Lida {
  const bloco = obj(payload.venda) ?? {};
  const pessoas: PessoaDoCrm[] = [];
  const pagantes: PaganteDoCrm[] = [];
  const produtos = lista(bloco.produtos).map((p, i) => {
    const ref = txt(p.ref, 120) || `${i + 1}`;
    const fornecedor = obj(p.fornecedor);
    const representante = obj(p.representante);
    if (fornecedor) pessoas.push({ bruto: fornecedor, onde: { tipo: 'fornecedor', produto: i } });
    if (representante) pessoas.push({ bruto: representante, onde: { tipo: 'representante', produto: i } });
    const passageiros = lista(p.passageiros).map((x, k) => ({
      id: `crm:${ref}:${txt(x.ref, 120) || k + 1}`,
      nome: txt(x.nome, 200), tipo: txt(x.tipo), documento: txt(x.documento, 40),
      tarifa_centavos: reaisParaCentavos(x.tarifa), taxas_centavos: reaisParaCentavos(x.taxas),
      outras_taxas_centavos: reaisParaCentavos(x.outras_taxas), cancelado_em: txt(x.cancelado_em),
    }));
    const refsPax = new Map(lista(p.passageiros).map((x, k) => [txt(x.ref, 120) || `${k + 1}`, passageiros[k].id]));
    const componentes = lista(p.componentes).map((c, k) => ({
      id: `crm:${ref}:c:${txt(c.ref, 120) || k + 1}`,
      tipo: txt(c.tipo),
      valor_centavos: reaisParaCentavos(c.valor),
      percentual: c.percentual,
      passageiro_id: txt(c.passageiro_ref) ? refsPax.get(txt(c.passageiro_ref, 120)) ?? null : null,
      descricao: txt(c.descricao, 200),
    }));
    return {
      id: `crm:${ref}`,
      tipo: txt(p.tipo), descricao: txt(p.descricao), produto_crm_id: txt(p.produto_crm_id, 120),
      fornecedor: parteDoFornecedor(fornecedor), representante: parteDoFornecedor(representante),
      quem_cobra: txt(p.quem_cobra), moeda: txt(p.moeda), cambio: p.cambio,
      localizador: txt(p.localizador), data_inicio: txt(p.data_inicio), data_fim: txt(p.data_fim),
      data_pagamento_fornecedor: txt(p.data_pagamento_fornecedor),
      quantidade: p.quantidade, valor_unitario_centavos: reaisParaCentavos(p.valor_unitario), taxas_centavos: reaisParaCentavos(p.taxas),
      detalhes: obj(p.detalhes) ?? {}, cancelado_em: txt(p.cancelado_em),
      passageiros, componentes,
    };
  });
  const intermediario = obj(bloco.intermediario);
  if (intermediario) pessoas.push({ bruto: intermediario, onde: { tipo: 'intermediario' } });
  const pagamentos = lista(bloco.pagamentos).map((g, i) => {
    const pagante = obj(g.pagante);
    if (pagante && txt(pagante.cliente_id) && txt(pagante.cliente_id) !== base.cliente.id_externo) {
      pagantes.push({ pagamento: i, cliente_id: txt(pagante.cliente_id), nome: txt(pagante.nome, 200), cpf_cnpj: txt(pagante.cpf_cnpj, 40), email: txt(pagante.email, 200) });
    }
    const fornecedor = obj(g.fornecedor);
    if (fornecedor) pessoas.push({ bruto: fornecedor, onde: { tipo: 'fornecedor_do_pagamento', pagamento: i } });
    return {
      id: `crm:pag:${txt(g.ref, 120) || i + 1}`,
      forma: txt(g.forma), valor_centavos: reaisParaCentavos(g.valor),
      parcelas: g.parcelas, primeiro_vencimento: txt(g.primeiro_vencimento), intervalo_dias: g.intervalo_dias,
      pagante: null, fornecedor: parteDoFornecedor(fornecedor),
      cartao_tipo: txt(g.cartao_tipo), detalhe: txt(g.detalhe), venda_origem_credito: txt(g.venda_origem_credito, 80),
    };
  });
  const { venda, erros } = normalizarVenda({
    id: base.id, numero: base.numero, data_venda: base.data_venda,
    cliente: base.cliente, vendedor: base.vendedor, grupo_id: base.grupo_id,
    intermediario: parteDoFornecedor(intermediario),
    centro_custo: txt(bloco.centro_custo, 120), observacoes: txt(bloco.observacoes, 2000),
    origem: 'crm', crm_venda_id: txt(payload.crm_venda_id, 200),
    produtos, pagamentos,
  });
  const cv = obj(bloco.comissao_vendedor);
  const pct = cv && Number.isFinite(Number(cv.percentual)) && cv.percentual !== null ? Number(cv.percentual) : null;
  const val = cv && Number.isFinite(Number(cv.valor)) && cv.valor !== null ? reaisParaCentavos(cv.valor) : null;
  return { venda, erros, pessoas, pagantes, comissao_vendedor: cv ? { percentual: pct, valor_centavos: val } : null };
}
