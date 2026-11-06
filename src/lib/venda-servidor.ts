/**
 * A venda completa no banco (E5, parte A): gravar, ler, fechar, reabrir, a
 * posição e as contas que nascem sozinhas.
 *
 * Um caminho só para a venda lançada à mão (rotas /api/vendas/completa) e para
 * a que chega do CRM (VENDA_FECHADA v2, crm-integration.ts): `salvarVenda`.
 * Quem chama abre a transação (`emTransacao`).
 *
 * REGRAS QUE CUSTAM DINHEIRO SE QUEBRADAS:
 *  1. Conta que já movimentou dinheiro (RECEBIDO, PARCIAL, PAGO) ou que tem
 *     cobrança valendo (boleto/Pix emitido, E3) nunca é apagada nem alterada
 *     pela regeração. A diferença que a mudança da venda criar vai para as
 *     contas ainda livres do mesmo lado (cliente, fornecedor X, comissão de
 *     X...), para o total de cada lado bater com a venda.
 *  2. A conta livre que continua existindo é ATUALIZADA no lugar (mesmo id):
 *     categoria, centro de custo, rateio, anexos e observações que a pessoa
 *     mudou ficam.
 *  3. Venda fechada não muda: nem pela tela, nem pelo CRM (a mudança do CRM
 *     fica registrada no histórico e avisada). Reabrir exige direito e motivo.
 */
import { generateId } from './utils';
import { hojeISO, deCentavos, round2 } from './money';
import { STATUS_BAIXADOS, type ExecutorSQL } from './caixa-atomico';
import type { ItemVendaData, ProdutoVenda, VendaCRM } from './crm-types';
import { createVendaCRM } from './crm-types';
import type { FornecedorInfo, ItemVendaInput } from './venda-financeiro';
import {
  FORMAS, TIPOS_COMPONENTE, congelarTaxaDoCartao, normalizarVenda, taxaDoCartaoIndefinida, totaisDaVenda, totaisDoProduto,
  type Centavos, type ParteDaVenda, type Venda,
} from './venda-modelo';
import { LIQUIDAR_PADRAO, liquidarContasDaVenda, normalizarLiquidar, textoDoTotal, type LiquidarAutomaticamente } from './venda-liquidar-auto';
import { vendaDoV1, TIPO_PARA_V1 } from './venda-modelo-v1';
import { contasDaVenda, type AvisoDaVenda, type ContasDaVenda, type PendenciaDaVenda } from './venda-contas';
import { normalizarConfigReceita, receitaDaVenda, type ConfigReceita } from './venda-receita';
import { normalizarConfigDoRecibo, type ConfigDoRecibo } from './recibo-da-venda';
import { posicaoDaVenda, type CobrancaDaPosicao, type PosicaoDaVenda } from './venda-posicao';
import { contasNaFaturaDoFornecedor, refletirFaturasNasContas } from './fornecedor-fatura-banco';
import { aplicarRetencoesDaAgencia } from './nota-retencoes-servidor';
import { contasTravadasPelaFatura, projetarContasNaFatura, sincronizarFaturasDaVenda } from './fatura-servidor';
import { lerCategoriasDosTitulos } from './categorias-padrao-titulos-servidor';
import { categoriaParaContaNova, chaveDaContaDaVenda, type CategoriasDosTitulos } from './categorias-padrao-titulos';
import { empresaComConfigPropria, lerChavesDaEmpresa } from './empresas-config';

// ============================================================
// Tipos públicos
// ============================================================

export class ErroVenda extends Error {
  // Campos declarados à parte (e não como "parameter property" no construtor)
  // para o arquivo carregar no node --experimental-strip-types dos testes.
  codigo: string;
  status: number;
  detalhes?: unknown;
  constructor(codigo: string, mensagem: string, status = 400, detalhes?: unknown) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
    this.detalhes = detalhes;
    this.name = 'ErroVenda';
  }
}

export interface UsuarioDaAcao { id: string; nome: string }

export type TipoDeEventoDaVenda = 'criada' | 'alterada' | 'recebida_do_crm' | 'fechada' | 'reaberta' | 'mudanca_do_crm_recusada' | 'cancelamento'
  // E7
  | 'cancelamento_desfeito' | 'conta_avulsa';

export interface EventoDaVenda {
  id: string;
  tipo: TipoDeEventoDaVenda | string;
  motivo: string;
  usuario_id: string;
  usuario_nome: string;
  detalhe: Record<string, unknown>;
  criado_em: string;
}

/** Pendência gravada (venda_pendencias). A parte D lê e resolve as de CREDITO_CLIENTE. */
export interface PendenciaGravada {
  venda_id: string;
  chave: string;
  tipo: string;
  pessoa_id: string;
  pessoa_nome: string;
  valor_centavos: Centavos;
  situacao: 'ABERTA' | 'RESOLVIDA' | 'CANCELADA';
  dados: Record<string, unknown>;
  criado_em: string;
  resolvido_em: string | null;
}

export interface VendaCarregada {
  venda: Venda;
  /** 2 = venda completa (contas pelo gerador novo); 1 = venda de antes (contas pela v1). */
  versao_modelo: 1 | 2;
  situacao: 'ABERTA' | 'FECHADA';
  fechada_em: string | null;
  fechada_por: string | null;
  /** O JSON de vendas_crm (o que as telas antigas leem). */
  cabecalho: Record<string, unknown>;
  pendencias: PendenciaGravada[];
  eventos: EventoDaVenda[];
}

export interface ContagemDasContas { criadas: number; atualizadas: number; removidas: number; preservadas: number }

export interface ResultadoDaGravacao {
  venda: Venda;
  contas: ContagemDasContas;
  avisos: AvisoDaVenda[];
  pendencias: PendenciaDaVenda[];
  resumo: ContasDaVenda['resumo'];
  nova: boolean;
}

/** Configurações › Vendas, guardadas em agencia.data.venda_config. */
export interface ConfigVenda {
  receita: ConfigReceita;
  /** Texto do recibo da venda (E7): declaração com marcadores e complemento. */
  recibo: ConfigDoRecibo;
  /** E7: dinheiro e cheque baixados sozinhos, com a conta padrão de cada um. */
  liquidar_automaticamente: LiquidarAutomaticamente;
}

// ============================================================
// Utilitários
// ============================================================

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataISO = (v: unknown): string => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const quando = (v: unknown): string => (v instanceof Date ? v.toISOString() : txt(v));

let tabelasProntas = false;
/** As tabelas da E5 existem? (Ambiente de teste antigo, ou antes do initDB.) */
export async function modeloDisponivel(exec: ExecutorSQL): Promise<boolean> {
  if (tabelasProntas) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.vendas_modelo') IS NOT NULL AS ok`);
  tabelasProntas = rows[0]?.ok === true;
  return tabelasProntas;
}

async function travarVenda(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<void> {
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [tenantId, `venda:${vendaId}`]);
}

// ============================================================
// Configuração
// ============================================================

export async function lerConfigVenda(exec: ExecutorSQL, tenantId: string, empresaId?: string | null): Promise<ConfigVenda> {
  const { rows } = await exec.query(
    `SELECT data->'venda_config' AS c FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const principal = normalizarConfigVenda((rows[0]?.c ?? {}) as Record<string, unknown>);
  // Empresa com configuração própria (E7): a dela, e no que ela não definiu, a
  // da principal. Uma empresa só: a de sempre.
  if (empresaComConfigPropria(empresaId)) {
    const c = await lerChavesDaEmpresa(exec, tenantId, empresaId, ['venda_config']);
    return normalizarConfigVenda(c.venda_config ?? {}, principal);
  }
  return principal;
}

/**
 * O pedido da tela sobre a configuração atual: a parte que não veio fica
 * como estava (a tela antiga mandava só `receita`).
 */
export function normalizarConfigVenda(v: unknown, atual?: ConfigVenda): ConfigVenda {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    receita: o.receita === undefined && atual ? atual.receita : normalizarConfigReceita(o.receita),
    recibo: o.recibo === undefined ? (atual?.recibo ?? normalizarConfigDoRecibo(null)) : normalizarConfigDoRecibo(o.recibo),
    liquidar_automaticamente: o.liquidar_automaticamente === undefined
      ? (atual?.liquidar_automaticamente ?? LIQUIDAR_PADRAO)
      : normalizarLiquidar(o.liquidar_automaticamente),
  };
}

// ============================================================
// Leitura
// ============================================================

export async function situacaoDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<'ABERTA' | 'FECHADA' | null> {
  if (!(await modeloDisponivel(exec))) return null;
  const { rows } = await exec.query(`SELECT situacao FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId]);
  return rows.length ? (txt(rows[0].situacao) === 'FECHADA' ? 'FECHADA' : 'ABERTA') : null;
}

/** A venda tem modelo completo (v2)? */
export async function versaoDoModelo(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<1 | 2 | null> {
  if (!(await modeloDisponivel(exec))) return null;
  const { rows } = await exec.query(`SELECT versao_modelo FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId]);
  if (!rows.length) return null;
  return Number(rows[0].versao_modelo) === 2 ? 2 : 1;
}

export async function fornecedoresInfo(exec: ExecutorSQL, tenantId: string, ids: string[]): Promise<FornecedorInfo[]> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return [];
  const { rows } = await exec.query(`SELECT id, data FROM fornecedores_crm WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, unicos]);
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return { id: txt(r.id), nome_fantasia: txt(d.nome_fantasia), regras_faturamento: (d.regras_faturamento ?? null) as FornecedorInfo['regras_faturamento'] };
  });
}

function idsDeFornecedores(v: Venda): string[] {
  return v.produtos.flatMap(p => [p.fornecedor?.id ?? '', p.representante?.id ?? '']);
}

export async function listarPendencias(exec: ExecutorSQL, tenantId: string, filtro: { venda_id?: string; tipo?: string; situacao?: string; pessoa_id?: string } = {}): Promise<PendenciaGravada[]> {
  if (!(await modeloDisponivel(exec))) return [];
  const cond = ['tenant_id = $1'];
  const args: unknown[] = [tenantId];
  for (const [k, v] of Object.entries(filtro)) {
    if (!v) continue;
    args.push(v);
    cond.push(`${k} = $${args.length}`);
  }
  const { rows } = await exec.query(`SELECT * FROM venda_pendencias WHERE ${cond.join(' AND ')} ORDER BY criado_em, chave`, args);
  return rows.map(r => ({
    venda_id: txt(r.venda_id), chave: txt(r.chave), tipo: txt(r.tipo), pessoa_id: txt(r.pessoa_id), pessoa_nome: txt(r.pessoa_nome),
    valor_centavos: Number(r.valor_centavos) || 0, situacao: txt(r.situacao) as PendenciaGravada['situacao'],
    dados: (r.dados ?? {}) as Record<string, unknown>, criado_em: quando(r.criado_em), resolvido_em: r.resolvido_em ? quando(r.resolvido_em) : null,
  }));
}

/** Para a parte D: marca a pendência como resolvida (ex.: crédito baixado da carteira). */
export async function resolverPendencia(exec: ExecutorSQL, tenantId: string, vendaId: string, chave: string, usuario: UsuarioDaAcao): Promise<boolean> {
  const r = await exec.query(
    `UPDATE venda_pendencias SET situacao = 'RESOLVIDA', resolvido_em = NOW(), resolvido_por = $4, atualizado_em = NOW()
      WHERE tenant_id = $1 AND venda_id = $2 AND chave = $3 AND situacao = 'ABERTA'`,
    [tenantId, vendaId, chave, usuario.nome || usuario.id],
  );
  return (r.rowCount ?? 0) > 0;
}

async function eventosDa(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<EventoDaVenda[]> {
  const { rows } = await exec.query(
    `SELECT id, tipo, motivo, usuario_id, usuario_nome, detalhe, criado_em FROM venda_eventos WHERE tenant_id = $1 AND venda_id = $2 ORDER BY criado_em DESC, id DESC LIMIT 200`,
    [tenantId, vendaId],
  );
  return rows.map(r => ({
    id: txt(r.id), tipo: txt(r.tipo), motivo: txt(r.motivo), usuario_id: txt(r.usuario_id), usuario_nome: txt(r.usuario_nome),
    detalhe: (r.detalhe ?? {}) as Record<string, unknown>, criado_em: quando(r.criado_em),
  }));
}

export async function registrarEventoDaVenda(
  exec: ExecutorSQL, tenantId: string, vendaId: string, tipo: TipoDeEventoDaVenda,
  opts: { usuario?: UsuarioDaAcao | null; motivo?: string; detalhe?: Record<string, unknown> } = {},
): Promise<void> {
  await exec.query(
    `INSERT INTO venda_eventos (tenant_id, id, venda_id, tipo, motivo, usuario_id, usuario_nome, detalhe) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [tenantId, generateId(), vendaId, tipo, opts.motivo ?? '', opts.usuario?.id ?? '', opts.usuario?.nome ?? '', JSON.stringify(opts.detalhe ?? {})],
  );
}

/** Lê o modelo gravado (v2) das tabelas. */
async function lerModelo(exec: ExecutorSQL, tenantId: string, vendaId: string, cab: Record<string, unknown>): Promise<Venda | null> {
  const { rows: m } = await exec.query(`SELECT * FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId]);
  if (!m.length || Number(m[0].versao_modelo) !== 2) return null;
  const args = [tenantId, vendaId];
  const [{ rows: ps }, { rows: xs }, { rows: cs }, { rows: gs }] = await Promise.all([
    exec.query(`SELECT * FROM venda_produtos WHERE tenant_id = $1 AND venda_id = $2 ORDER BY sequencia, id`, args),
    exec.query(`SELECT * FROM venda_passageiros WHERE tenant_id = $1 AND venda_id = $2 ORDER BY ordem, id`, args),
    exec.query(`SELECT * FROM venda_componentes WHERE tenant_id = $1 AND venda_id = $2 ORDER BY ordem, id`, args),
    exec.query(`SELECT * FROM venda_pagamentos WHERE tenant_id = $1 AND venda_id = $2 ORDER BY ordem, id`, args),
  ]);
  return vendaDasLinhas(vendaId, m[0], cab, ps, xs, cs, gs);
}

type Linha = Record<string, unknown>;

/**
 * A venda do modelo a partir das linhas das tabelas (as de UMA venda). Serve
 * a leitura de uma venda e a leitura em lote dos relatórios e das comissões
 * (vendas-leitura.ts), para as duas nunca divergirem.
 */
export function vendaDasLinhas(vendaId: string, linha: Linha, cab: Linha, ps: Linha[], xs: Linha[], cs: Linha[], gs: Linha[]): Venda {
  const parte = (id: unknown, nome: unknown, ext: unknown): ParteDaVenda | null =>
    (txt(id) || txt(nome) || txt(ext)) ? { id: txt(id), nome: txt(nome), ...(txt(ext) ? { id_externo: txt(ext) } : {}) } : null;
  const bruto = {
    id: vendaId, numero: txt(linha.numero) || txt(cab.numero), data_venda: dataISO(linha.data_venda) || txt(cab.data_venda),
    cliente: linha.cliente, vendedor: linha.vendedor, intermediario: linha.intermediario,
    grupo_id: linha.grupo_id, centro_custo: linha.centro_custo, origem: linha.origem, situacao: linha.situacao,
    observacoes: linha.observacoes, crm_venda_id: linha.crm_venda_id, operacao_propria: linha.operacao_propria === true, produtos_removidos: linha.produtos_removidos,
    produtos: ps.map(p => ({
      id: p.id, tipo: p.tipo, descricao: p.descricao,
      fornecedor: parte(p.fornecedor_id, p.fornecedor_nome, p.fornecedor_externo),
      representante: parte(p.representante_id, p.representante_nome, p.representante_externo),
      quem_cobra: p.quem_cobra, moeda: p.moeda, cambio: Number(p.cambio), localizador: p.localizador,
      data_inicio: dataISO(p.data_inicio), data_fim: dataISO(p.data_fim), data_pagamento_fornecedor: dataISO(p.data_pagamento_fornecedor),
      quantidade: p.quantidade, valor_unitario_centavos: Number(p.valor_unitario_centavos), taxas_centavos: Number(p.taxas_centavos),
      detalhes: p.detalhes, cancelado_em: dataISO(p.cancelado_em), produto_crm_id: p.produto_crm_id,
      passageiros: xs.filter(x => x.produto_id === p.id).map(x => ({
        id: x.id, nome: x.nome, tipo: x.tipo, documento: x.documento,
        tarifa_centavos: Number(x.tarifa_centavos), taxas_centavos: Number(x.taxas_centavos), outras_taxas_centavos: Number(x.outras_taxas_centavos),
        cancelado_em: dataISO(x.cancelado_em),
      })),
      componentes: cs.filter(c => c.produto_id === p.id).map(c => ({
        id: c.id, tipo: c.tipo, valor_centavos: Number(c.valor_centavos), percentual: c.percentual === null ? null : Number(c.percentual),
        passageiro_id: c.passageiro_id, descricao: c.descricao, base: c.base,
      })),
    })),
    pagamentos: gs.map(g => ({
      ...((g.dados ?? {}) as Record<string, unknown>), id: g.id, forma: g.forma, valor_centavos: Number(g.valor_centavos), parcelas: g.parcelas,
      primeiro_vencimento: dataISO(g.primeiro_vencimento), intervalo_dias: g.intervalo_dias,
      pagante: g.pagante, fornecedor: g.fornecedor, conta_bancaria_id: g.conta_bancaria_id,
      cartao_tipo: g.cartao_tipo, detalhe: g.detalhe, venda_origem_credito: g.venda_origem_credito,
    })),
  };
  return normalizarVenda(bruto).venda;
}

/** A venda como a tela e as outras partes precisam: modelo completo ou a venda de antes traduzida. */
export async function carregarVenda(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<VendaCarregada | null> {
  const { rows } = await exec.query(`SELECT id, cliente_id, vendedor_id, data FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, vendaId]);
  if (!rows.length) return null;
  const cab = (rows[0].data ?? {}) as Record<string, unknown>;
  const temModelo = await modeloDisponivel(exec);
  let situacao: 'ABERTA' | 'FECHADA' = 'ABERTA';
  let fechada_em: string | null = null;
  let fechada_por: string | null = null;
  let venda: Venda | null = null;
  if (temModelo) {
    const { rows: m } = await exec.query(`SELECT situacao, fechada_em, fechada_por FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId]);
    if (m.length) {
      situacao = txt(m[0].situacao) === 'FECHADA' ? 'FECHADA' : 'ABERTA';
      fechada_em = m[0].fechada_em ? quando(m[0].fechada_em) : null;
      fechada_por = m[0].fechada_por ? txt(m[0].fechada_por) : null;
    }
    venda = await lerModelo(exec, tenantId, vendaId, cab);
  }
  const versao_modelo: 1 | 2 = venda ? 2 : 1;
  if (!venda) {
    const { rows: its } = await exec.query(
      `SELECT id, venda_id, fornecedor_id, sequencia, status, data FROM itens_venda WHERE tenant_id = $1 AND venda_id = $2 ORDER BY sequencia`,
      [tenantId, vendaId],
    );
    const itens: ItemVendaInput[] = its.map(r => ({
      id: txt(r.id), venda_id: txt(r.venda_id), fornecedor_id: txt(r.fornecedor_id), sequencia: Number(r.sequencia) || 1,
      status: txt(r.status), data: (r.data ?? {}) as ItemVendaData,
    }));
    const forn = await fornecedoresInfo(exec, tenantId, itens.map(i => i.fornecedor_id));
    const { rows: cli } = await exec.query(`SELECT nome FROM clientes WHERE tenant_id = $1 AND id = $2`, [tenantId, txt(rows[0].cliente_id)]).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    venda = vendaDoV1(cab as VendaCRM & Record<string, unknown>, itens, forn, { cliente_nome: txt(cli[0]?.nome), vendedor_nome: txt(cab.vendedor_nome_crm) });
    venda.id = vendaId;
  }
  venda.situacao = situacao;
  return {
    venda, versao_modelo, situacao, fechada_em, fechada_por, cabecalho: cab,
    pendencias: temModelo ? await listarPendencias(exec, tenantId, { venda_id: vendaId }) : [],
    eventos: temModelo ? await eventosDa(exec, tenantId, vendaId) : [],
  };
}

// ============================================================
// Contas: regeração que preserva o que já se moveu
// ============================================================

type Tabela = 'contas_receber' | 'contas_pagar';
interface ContaExistente { id: string; status: string; data: Record<string, unknown> }

/** De que lado da venda a conta é (o total de cada lado tem de bater com a venda). */
export function ladoDaConta(tabela: Tabela, d: Record<string, unknown>): string {
  const chave = txt(d.venda_chave) || txt(d.origem_item_id);
  if (tabela === 'contas_receber') {
    const origem = txt(d.origem) || 'VENDA';
    if (origem === 'COMISSAO_FORNECEDOR') return `comissao:${txt(d.fornecedor_id) || txt(d.cliente_id) || txt(d.cliente_nome).toLowerCase()}`;
    if (origem === 'OUTROS') return `retido:${txt(d.cliente_id) || txt(d.cliente_nome).toLowerCase()}`;
    return 'cliente';
  }
  if (chave.startsWith('v2:repasse')) return `repasse:${txt(d.fornecedor_id) || txt(d.fornecedor_nome).toLowerCase()}`;
  return `forn:${txt(d.fornecedor_id) || txt(d.fornecedor_nome).toLowerCase()}`;
}

const chaveDe = (d: Record<string, unknown>) => `${txt(d.origem_item_id)}|${txt(d.parcela_numero)}`;
const valorDe = (d: Record<string, unknown>): Centavos => Math.round(round2(Number(d.valor_final) || 0) * 100);

/** O que a pessoa pode ter mudado na conta gerada e a regeração mantém. */
const CAMPOS_DA_PESSOA = [
  'categoria_id', 'centro_custo', 'centro_custo_id', 'rateio', 'anexos', 'tags', 'observacoes', 'conta_bancaria_id',
  'forma_pagamento', 'linha_digitavel', 'chave_pix', 'numero_documento', 'fornecedor_cnpj', 'comprovante', 'cartao_id', 'data_emissao',
  // Item tirado da fatura à mão (E5, parte B): continua fora das faturas automáticas.
  'fatura_manual',
];
function vazio(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function ajustarValor(d: Record<string, unknown>, centavosNovos: Centavos): void {
  const reais = deCentavos(centavosNovos);
  d.valor_final = reais;
  d.valor_original = reais;
  if ('valor_brl' in d) { d.valor_brl = reais; d.moeda = 'BRL'; d.cambio = 1; }
}

async function regerarTabela(
  exec: ExecutorSQL, tenantId: string, vendaId: string, tabela: Tabela,
  novas: Array<Record<string, unknown>>, travadasIds: Set<string>, avisos: AvisoDaVenda[],
  /** Contas fora da regeração que já cobrem um lado (pagamento avulso ao fornecedor, E7). */
  externas: ContaExistente[] = [],
): Promise<ContagemDasContas> {
  const cont: ContagemDasContas = { criadas: 0, atualizadas: 0, removidas: 0, preservadas: 0 };
  const { rows } = await exec.query(
    `SELECT id, status, data FROM ${tabela} WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true'`,
    [tenantId, vendaId],
  );
  const existentes: ContaExistente[] = rows.map(r => ({ id: txt(r.id), status: txt((r.data as Record<string, unknown>)?.status ?? r.status), data: (r.data ?? {}) as Record<string, unknown> }));
  const travada = (c: ContaExistente) => (STATUS_BAIXADOS as readonly string[]).includes(c.status) || travadasIds.has(c.id);
  // As externas entram como travadas: o que já cobrem sai das livres do mesmo lado; nunca são mexidas.
  const travadas = [...existentes.filter(travada), ...externas];
  const livresExistentes = new Map(existentes.filter(c => !travada(c)).map(c => [chaveDe(c.data), c]));
  cont.preservadas = travadas.length;
  const chavesTravadas = new Set(travadas.map(c => chaveDe(c.data)));

  // Lado a lado: o que já se moveu fica, e a diferença vai para as livres.
  const lados = new Map<string, Array<Record<string, unknown>>>();
  for (const n of novas) {
    const l = ladoDaConta(tabela, n);
    if (!lados.has(l)) lados.set(l, []);
    lados.get(l)!.push(n);
  }
  const finais: Array<Record<string, unknown>> = [];
  for (const [lado, lista] of lados) {
    const alvo = lista.reduce((a, d) => a + valorDe(d), 0);
    const jaFixo = travadas.filter(c => ladoDaConta(tabela, c.data) === lado).reduce((a, c) => a + valorDe(c.data), 0);
    const livres = lista.filter(d => !chavesTravadas.has(chaveDe(d))).map(d => ({ ...d }));
    let delta = alvo - jaFixo - livres.reduce((a, d) => a + valorDe(d), 0);
    if (delta > 0) {
      if (livres.length) {
        const ult = livres[livres.length - 1];
        ajustarValor(ult, valorDe(ult) + delta);
      } else {
        const modelo = { ...lista[lista.length - 1] };
        modelo.id = generateId();
        modelo.origem_item_id = `${txt(modelo.origem_item_id)}:complemento`;
        modelo.venda_chave = modelo.origem_item_id;
        modelo.parcela_numero = 1;
        modelo.total_parcelas = 1;
        modelo.descricao = `${txt(modelo.descricao).replace(/ - Parcela \d+\/\d+$/, '')} - complemento`;
        ajustarValor(modelo, delta);
        livres.push(modelo);
      }
      delta = 0;
    }
    for (let i = livres.length - 1; i >= 0 && delta < 0; i--) {
      const v = valorDe(livres[i]);
      const tira = Math.min(v, -delta);
      delta += tira;
      if (v - tira <= 0) livres.splice(i, 1);
      else ajustarValor(livres[i], v - tira);
    }
    if (delta < 0) {
      avisos.push({ codigo: 'MOVIDO_ACIMA_DO_PREVISTO', valor_centavos: -delta, lado, mensagem: `Já se moveu ${deCentavos(-delta).toFixed(2)} a mais do que a venda prevê agora (${lado.startsWith('cliente') ? 'cliente' : 'fornecedor'}). Isso pede devolução ou acerto, que não acontece sozinho.` });
    }
    finais.push(...livres);
  }
  // Lado que a venda não prevê mais e que já movimentou dinheiro (o produto
  // ou o pagamento saiu inteiro): tudo o que se moveu ali está a mais.
  const ladosTravados = new Map<string, Centavos>();
  for (const c of travadas) {
    const l = ladoDaConta(tabela, c.data);
    if (!lados.has(l)) ladosTravados.set(l, (ladosTravados.get(l) ?? 0) + valorDe(c.data));
  }
  for (const [lado, valor] of ladosTravados) {
    if (valor <= 0) continue;
    avisos.push({ codigo: 'MOVIDO_ACIMA_DO_PREVISTO', valor_centavos: valor, lado, mensagem: `Já se moveu ${deCentavos(valor).toFixed(2)} a mais do que a venda prevê agora (${lado.startsWith('cliente') ? 'cliente' : 'fornecedor'}). Isso pede devolução ou acerto, que não acontece sozinho.` });
  }

  const usadas = new Set<string>();
  // Categoria padrão (06/11/2026, E7): só a conta que NASCE agora a recebe;
  // a que já existe mantém a sua (CAMPOS_DA_PESSOA), mesmo vazia.
  let padroes: CategoriasDosTitulos | null = null;
  for (const n of finais) {
    const ex = livresExistentes.get(chaveDe(n));
    if (ex) {
      usadas.add(ex.id);
      const dados: Record<string, unknown> = { ...n, id: ex.id };
      for (const k of CAMPOS_DA_PESSOA) if (!vazio(ex.data[k])) dados[k] = ex.data[k];
      if (n.fornecedor_pendente && txt(ex.data.fornecedor_id)) {
        dados.fornecedor_id = ex.data.fornecedor_id; dados.fornecedor_nome = ex.data.fornecedor_nome; dados.fornecedor_pendente = false;
      }
      if (tabela === 'contas_receber') {
        await exec.query(
          `UPDATE contas_receber SET data = $3::jsonb, status = $4, cliente_id = $5, venda_id = $6, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, ex.id, JSON.stringify(dados), txt(dados.status), txt(dados.cliente_id), vendaId],
        );
      } else {
        await exec.query(
          `UPDATE contas_pagar SET data = $3::jsonb, status = $4, fornecedor_id = $5, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, ex.id, JSON.stringify(dados), txt(dados.status), txt(dados.fornecedor_id)],
        );
      }
      cont.atualizadas++;
    } else {
      if (vazio(n.categoria_id)) {
        padroes ??= await lerCategoriasDosTitulos(exec, tenantId);
        const cat = categoriaParaContaNova(n.categoria_id, padroes, chaveDaContaDaVenda(tabela));
        if (cat) n.categoria_id = cat;
      }
      if (tabela === 'contas_receber') {
        await exec.query(
          `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())`,
          [txt(n.id), tenantId, vendaId, txt(n.cliente_id), txt(n.status), JSON.stringify(n)],
        );
      } else {
        await exec.query(
          `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
          [txt(n.id), tenantId, txt(n.fornecedor_id), txt(n.status), JSON.stringify(n)],
        );
      }
      cont.criadas++;
    }
  }
  for (const ex of livresExistentes.values()) {
    if (usadas.has(ex.id)) continue;
    await exec.query(`DELETE FROM ${tabela} WHERE tenant_id = $1 AND id = $2`, [tenantId, ex.id]);
    cont.removidas++;
  }
  return cont;
}

/**
 * Pagamentos avulsos ao fornecedor lançados na ficha da venda (E7): contas a
 * pagar fora da regeração (`auto_gerado` false) que adiantam parte do que a
 * venda deve àquela pessoa. A regeração as conta como já feitas no lado
 * dela, para o total a pagar ao fornecedor continuar batendo com a venda.
 */
async function pagamentosAvulsosAoFornecedor(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<ContaExistente[]> {
  const { rows } = await exec.query(
    `SELECT id, status, data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2
        AND data->>'avulsa_da_venda' = 'pagamento_fornecedor' AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
    [tenantId, vendaId],
  );
  return rows.map(r => ({ id: txt(r.id), status: txt((r.data as Record<string, unknown>)?.status ?? r.status), data: (r.data ?? {}) as Record<string, unknown> }));
}

/**
 * Grava as contas geradas para a venda, preservando o baixado e o que tem
 * cobrança valendo. Devolve a contagem e avisos de valor que não fechou.
 */
export async function regerarContasDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, contas: ContasDaVenda): Promise<{ contas: ContagemDasContas; avisos: AvisoDaVenda[] }> {
  const avisos: AvisoDaVenda[] = [];
  const travadas = new Set<string>();
  const { rows: temCob } = await exec.query(`SELECT to_regclass('public.cobrancas') IS NOT NULL AS ok`);
  if (temCob[0]?.ok) {
    const { rows } = await exec.query(
      `SELECT c.titulo_id FROM cobrancas c JOIN contas_receber r ON r.tenant_id = c.tenant_id AND r.id = c.titulo_id
        WHERE c.tenant_id = $1 AND c.titulo_tabela = 'contas_receber' AND r.data->>'origem_venda_id' = $2
          AND c.status IN ('emitindo','aberta','vencida')`,
      [tenantId, vendaId],
    );
    for (const r of rows) travadas.add(txt(r.titulo_id));
  }
  // Conta que entrou na fatura do fornecedor (parte C) também fica como está:
  // a diferença da venda vai para uma conta livre, que entra na próxima fatura.
  for (const id of await contasNaFaturaDoFornecedor(exec, tenantId, vendaId)) travadas.add(id);
  // Item de fatura fechada, recebida ou cobrada (E5, parte B) também não muda.
  for (const id of await contasTravadasPelaFatura(exec, tenantId, vendaId)) travadas.add(id);
  const cr = await regerarTabela(exec, tenantId, vendaId, 'contas_receber', contas.contas_receber as unknown as Array<Record<string, unknown>>, travadas, avisos);
  const cp = await regerarTabela(exec, tenantId, vendaId, 'contas_pagar', contas.contas_pagar as unknown as Array<Record<string, unknown>>, travadas, avisos,
    await pagamentosAvulsosAoFornecedor(exec, tenantId, vendaId));
  return {
    contas: { criadas: cr.criadas + cp.criadas, atualizadas: cr.atualizadas + cp.atualizadas, removidas: cr.removidas + cp.removidas, preservadas: cr.preservadas + cp.preservadas },
    avisos,
  };
}

// ============================================================
// Gravação
// ============================================================

const FORMA_ANTIGA: Partial<Record<string, VendaCRM['forma_pagamento']>> = { PIX: 'AVISTA_PIX', DINHEIRO: 'AVISTA_PIX', DEPOSITO: 'AVISTA_PIX', CARTAO: 'CARTAO', BOLETO: 'BOLETO', FATURAR: 'FATURADO' };

/** O cabeçalho em vendas_crm, no formato que as telas antigas, o painel e as comissões leem. */
export function cabecalhoDaVenda(venda: Venda, contas: ContasDaVenda, receitaCentavos: Centavos): Record<string, unknown> {
  const t = totaisDaVenda(venda);
  const valor = deCentavos(t.valor_cliente);
  const custo = deCentavos(t.valor_fornecedor);
  const receita = deCentavos(receitaCentavos);
  const formas = [...new Set(venda.pagamentos.map(p => p.forma))];
  const produtos: ProdutoVenda[] = venda.produtos.map(p => {
    const tp = totaisDoProduto(p);
    return {
      id: p.id, tipo: TIPO_PARA_V1[p.tipo], descricao: p.descricao,
      fornecedor_id: p.fornecedor?.id ?? '', fornecedor_nome: p.fornecedor?.nome ?? '',
      data_inicio: p.data_inicio, data_fim: p.data_fim, localizador: p.localizador,
      cia_aerea: p.detalhes.cia ?? '', trecho: p.detalhes.trechos ?? '', hotel_nome: p.detalhes.hotel ?? '',
      tipo_apto: p.detalhes.acomodacao ?? '', regime: p.detalhes.regime ?? '',
      produto_id: p.produto_crm_id, quantidade: p.passageiros.length || p.quantidade,
      valor_custo: deCentavos(tp.valor_fornecedor), valor_venda: deCentavos(tp.valor_cliente),
      comissao_fornecedor: deCentavos(tp.componentes.COMISSAO + tp.componentes.OVER),
      moeda: (p.moeda === 'USD' || p.moeda === 'EUR' ? p.moeda : 'BRL') as ProdutoVenda['moeda'], cambio: p.cambio,
      status: p.cancelado_em ? 'CANCELADO' : 'CONFIRMADO', aprovador: '', solicitante: '', centro_custo: venda.centro_custo, projeto: '',
    };
  });
  const vistos = new Set<string>();
  const passageiros = venda.produtos.flatMap(p => p.passageiros).filter(x => {
    const k = `${x.nome.toLowerCase()}|${x.documento}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  }).map(x => ({ nome: x.nome, tipo: x.tipo, documento: x.documento, data_nascimento: '', telefone: '', email: '' }));
  return {
    ...createVendaCRM(venda.numero),
    id: venda.id, numero: venda.numero, data_venda: venda.data_venda,
    tipo: venda.grupo_id ? 'GRUPO' : 'AVULSA', grupo_id: venda.grupo_id,
    cliente_id: venda.cliente.id, vendedor_id: venda.vendedor?.id ?? '',
    passageiros, produtos,
    valor_total_custo: custo, valor_total_venda: valor, valor_final: valor, valor_total: valor, custo_total: custo,
    desconto: deCentavos(t.componentes.DESCONTO), markup_realizado: receita, rentabilidade: receita, comissao: receita,
    margem_percentual: valor > 0 ? round2((receita / valor) * 100) : 0,
    forma_pagamento: formas.length > 1 ? 'MISTO' : (FORMA_ANTIGA[formas[0] ?? ''] ?? 'AVISTA_PIX'),
    parcelas: venda.pagamentos.reduce((a, p) => Math.max(a, p.parcelas), 1),
    pagamento_detalhado: venda.pagamentos.map(p => ({ forma: FORMAS[p.forma].rotulo, valor: deCentavos(p.valor_centavos), parcelas: p.parcelas })),
    status: 'CONFIRMADO',
    intermediario_id: venda.intermediario?.id || null, comissao_intermediario: deCentavos(t.repasse),
    centro_custo: venda.centro_custo, observacoes: venda.observacoes,
    origem: venda.origem, crm_venda_id: venda.crm_venda_id,
    modelo_venda: 2, situacao_venda: venda.situacao,
    itens_count: venda.produtos.length, contas_geradas: true, contas_geradas_em: new Date().toISOString(),
    resumo_contas: contas.resumo,
  };
}

/** Itens no formato antigo, para as telas e relatórios que ainda leem itens_venda. */
function itensDerivados(venda: Venda): ItemVendaInput[] {
  return venda.produtos.map((p, i) => {
    const tp = totaisDoProduto(p);
    const data: ItemVendaData & Record<string, unknown> = {
      tipo: TIPO_PARA_V1[p.tipo], descricao: p.descricao, fornecedor_nome: p.fornecedor?.nome ?? '',
      meio_pagamento: p.quem_cobra === 'FORNECEDOR' ? 'fornecedor' : 'proprio',
      valor_custo: deCentavos(tp.valor_fornecedor), valor_venda: deCentavos(tp.valor_cliente),
      comissao_percentual: 0, comissao_valor: deCentavos(tp.componentes.COMISSAO + tp.componentes.OVER),
      moeda: (p.moeda === 'USD' || p.moeda === 'EUR' ? p.moeda : 'BRL') as ItemVendaData['moeda'], cambio: p.cambio,
      localizador: p.localizador, data_inicio: p.data_inicio, data_fim: p.data_fim, observacoes: '',
      contas_geradas_ids: [], data_pagamento_fornecedor: p.data_pagamento_fornecedor,
      modelo_venda: 2, produto_id: p.id,
    };
    return { id: `${venda.id}:${p.id}`.slice(0, 200), venda_id: venda.id, fornecedor_id: p.fornecedor?.id ?? '', sequencia: i + 1, status: p.cancelado_em ? 'cancelado' : 'ativo', data };
  });
}

async function proximoNumero(exec: ExecutorSQL, tenantId: string): Promise<string> {
  const { rows } = await exec.query(`SELECT COUNT(*) AS c FROM vendas_crm WHERE tenant_id = $1`, [tenantId]);
  return `VND-${String(Number(rows[0]?.c ?? 0) + 1).padStart(4, '0')}`;
}

/** O que o pagamento guarda na coluna `dados` (E7): só o que existe. */
function dadosDoPagamento(g: Venda['pagamentos'][number]): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const k of ['taxa_cartao_centavos', 'taxa_cartao_percentual', 'taxa_cartao_fixa_centavos', 'dias_para_cair', 'forma_agencia', 'campos'] as const) {
    const v = g[k];
    if (v !== null && v !== undefined && v !== '') d[k] = v;
  }
  return d;
}

/**
 * Cartão (E7): congela no pagamento a taxa e os dias da forma de pagamento da
 * agência, onde ainda não foram definidos. Venda feita não muda quando o
 * cadastro da forma muda depois.
 */
async function congelarTaxasDoCartao(exec: ExecutorSQL, tenantId: string, venda: Venda): Promise<Venda> {
  if (!venda.pagamentos.some(taxaDoCartaoIndefinida)) return venda;
  // Sem a tabela de formas (base antiga), nada a congelar. Conferir antes:
  // um SELECT que falha dentro da transação a deixaria inutilizável.
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.formas_pagamento') IS NOT NULL AS ok`);
  if (!tem[0]?.ok) return venda;
  const { listarFormas } = await import('./formas-pagamento-servidor');
  const formas = await listarFormas(exec, tenantId);
  const porCodigo = new Map(formas.map(f => [f.codigo, f]));
  return {
    ...venda,
    pagamentos: venda.pagamentos.map(g => (taxaDoCartaoIndefinida(g)
      ? congelarTaxaDoCartao(g, porCodigo.get(g.cartao_tipo === 'debito' ? 'CARTAO_DEBITO' : 'CARTAO_CREDITO'))
      : g)),
  };
}

async function gravarFilhos(exec: ExecutorSQL, tenantId: string, venda: Venda): Promise<void> {
  const args = [tenantId, venda.id];
  for (const t of ['venda_componentes', 'venda_passageiros', 'venda_produtos', 'venda_pagamentos']) {
    await exec.query(`DELETE FROM ${t} WHERE tenant_id = $1 AND venda_id = $2`, args);
  }
  for (const p of venda.produtos) {
    await exec.query(
      `INSERT INTO venda_produtos (tenant_id, venda_id, id, sequencia, tipo, descricao, fornecedor_id, fornecedor_nome, fornecedor_externo,
         representante_id, representante_nome, representante_externo, quem_cobra, moeda, cambio, localizador, data_inicio, data_fim,
         data_pagamento_fornecedor, quantidade, valor_unitario_centavos, taxas_centavos, detalhes, cancelado_em, produto_crm_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULLIF($17,'')::date,NULLIF($18,'')::date,NULLIF($19,'')::date,$20,$21,$22,$23::jsonb,NULLIF($24,'')::date,$25)`,
      [tenantId, venda.id, p.id, p.sequencia, p.tipo, p.descricao, p.fornecedor?.id ?? '', p.fornecedor?.nome ?? '', p.fornecedor?.id_externo ?? '',
        p.representante?.id ?? '', p.representante?.nome ?? '', p.representante?.id_externo ?? '', p.quem_cobra, p.moeda, p.cambio, p.localizador,
        p.data_inicio, p.data_fim, p.data_pagamento_fornecedor, p.quantidade, p.valor_unitario_centavos, p.taxas_centavos,
        JSON.stringify(p.detalhes), p.cancelado_em ?? '', p.produto_crm_id],
    );
    for (const [k, x] of p.passageiros.entries()) {
      await exec.query(
        `INSERT INTO venda_passageiros (tenant_id, venda_id, produto_id, id, ordem, nome, tipo, documento, tarifa_centavos, taxas_centavos, outras_taxas_centavos, cancelado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULLIF($12,'')::date)`,
        [tenantId, venda.id, p.id, x.id, k + 1, x.nome, x.tipo, x.documento, x.tarifa_centavos, x.taxas_centavos, x.outras_taxas_centavos, x.cancelado_em ?? ''],
      );
    }
    for (const [k, c] of p.componentes.entries()) {
      await exec.query(
        `INSERT INTO venda_componentes (tenant_id, venda_id, produto_id, id, ordem, tipo, valor_centavos, percentual, passageiro_id, descricao, base)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tenantId, venda.id, p.id, c.id, k + 1, c.tipo, c.valor_centavos, c.percentual, c.passageiro_id, c.descricao, c.base ?? ''],
      );
    }
  }
  for (const [k, g] of venda.pagamentos.entries()) {
    await exec.query(
      `INSERT INTO venda_pagamentos (tenant_id, venda_id, id, ordem, forma, valor_centavos, parcelas, primeiro_vencimento, intervalo_dias,
         pagante, fornecedor, conta_bancaria_id, cartao_tipo, detalhe, venda_origem_credito, dados)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::date,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16::jsonb)`,
      [tenantId, venda.id, g.id, k + 1, g.forma, g.valor_centavos, g.parcelas, g.primeiro_vencimento, g.intervalo_dias,
        g.pagante ? JSON.stringify(g.pagante) : null, g.fornecedor ? JSON.stringify(g.fornecedor) : null, g.conta_bancaria_id, g.cartao_tipo, g.detalhe, g.venda_origem_credito,
        JSON.stringify(dadosDoPagamento(g))],
    );
  }
}

async function sincronizarPendencias(exec: ExecutorSQL, tenantId: string, vendaId: string, novas: PendenciaDaVenda[], avisos: AvisoDaVenda[], comCarteira = false): Promise<void> {
  const { rows } = await exec.query(`SELECT chave, situacao, valor_centavos FROM venda_pendencias WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId]);
  const atuais = new Map(rows.map(r => [txt(r.chave), { situacao: txt(r.situacao), valor: Number(r.valor_centavos) || 0 }]));
  const chaves = new Set(novas.map(p => p.chave));
  for (const p of novas) {
    const a = atuais.get(p.chave);
    const dados = JSON.stringify({ pagamento_id: p.pagamento_id, venda_origem_credito: p.venda_origem_credito, descricao: p.descricao });
    if (!a) {
      await exec.query(
        `INSERT INTO venda_pendencias (tenant_id, venda_id, chave, tipo, pessoa_id, pessoa_nome, valor_centavos, situacao, dados) VALUES ($1,$2,$3,$4,$5,$6,$7,'ABERTA',$8::jsonb)`,
        [tenantId, vendaId, p.chave, p.tipo, p.pessoa.id, p.pessoa.nome, p.valor_centavos, dados],
      );
    } else if (a.situacao === 'RESOLVIDA') {
      if (a.valor !== p.valor_centavos && comCarteira) {
        // Com a carteira (parte D), o valor novo vale e a carteira se acerta
        // sozinha (usa a diferença ou devolve o que sobrou).
        await exec.query(
          `UPDATE venda_pendencias SET valor_centavos = $4, dados = dados || $5::jsonb, atualizado_em = NOW() WHERE tenant_id = $1 AND venda_id = $2 AND chave = $3`,
          [tenantId, vendaId, p.chave, p.valor_centavos, dados],
        );
      } else if (a.valor !== p.valor_centavos) {
        avisos.push({ codigo: 'CREDITO_JA_USADO', valor_centavos: p.valor_centavos - a.valor, mensagem: 'O crédito do cliente já foi usado com outro valor. Ajuste na carteira de crédito do cliente.' });
      }
    } else {
      await exec.query(
        `UPDATE venda_pendencias SET valor_centavos = $4, pessoa_id = $5, pessoa_nome = $6, situacao = 'ABERTA', dados = $7::jsonb, atualizado_em = NOW()
          WHERE tenant_id = $1 AND venda_id = $2 AND chave = $3`,
        [tenantId, vendaId, p.chave, p.valor_centavos, p.pessoa.id, p.pessoa.nome, dados],
      );
    }
  }
  for (const [chave, a] of atuais) {
    if (chaves.has(chave) || a.situacao !== 'ABERTA') continue;
    await exec.query(`UPDATE venda_pendencias SET situacao = 'CANCELADA', atualizado_em = NOW() WHERE tenant_id = $1 AND venda_id = $2 AND chave = $3`, [tenantId, vendaId, chave]);
  }
  for (const [chave, a] of atuais) {
    if (!chaves.has(chave) && a.situacao === 'RESOLVIDA') {
      if (comCarteira) {
        // O crédito usado volta para a carteira (sincronizarCreditosDaVenda).
        await exec.query(`UPDATE venda_pendencias SET situacao = 'CANCELADA', atualizado_em = NOW() WHERE tenant_id = $1 AND venda_id = $2 AND chave = $3`, [tenantId, vendaId, chave]);
      } else {
        avisos.push({ codigo: 'CREDITO_JA_USADO', valor_centavos: a.valor, mensagem: 'Um crédito do cliente já usado saiu da venda. Devolva o valor na carteira de crédito do cliente.' });
      }
    }
  }
}

/** As contas que a venda geraria agora, sem gravar nada (prévia da tela). */
export async function previaDasContas(exec: ExecutorSQL, tenantId: string, venda: Venda): Promise<ContasDaVenda> {
  const contas = contasDaVenda({ versao: 2, venda, fornecedores: await fornecedoresInfo(exec, tenantId, idsDeFornecedores(venda)), hoje: hojeISO() });
  // Cliente que retém tributos na fonte (Lei 9.430, parte E): a conta a
  // receber dele sai líquida. Sem retenção cadastrada, as contas não mudam.
  return aplicarRetencoesDaAgencia(exec, tenantId, venda, contas);
}

/**
 * Grava a venda completa (nova ou alterada) e as contas dela, sozinhas.
 * `cabecalho` acrescenta campos ao JSON de vendas_crm (o CRM manda o
 * carimbo da plataforma, os ids externos...). Venda fechada: ErroVenda 409.
 */
export async function salvarVenda(
  exec: ExecutorSQL, tenantId: string, entrada: Venda,
  opts: {
    usuario: UsuarioDaAcao | null; origem: 'manual' | 'crm' | 'mudanca'; cabecalho?: Record<string, unknown>; evento?: TipoDeEventoDaVenda; detalheDoEvento?: Record<string, unknown>;
    /** Só o cancelamento (parte D): grava mesmo com a venda fechada, sem reabri-la. */
    ignorarFechamento?: boolean;
    /** Quem chama registra o próprio evento (o cancelamento, com motivo e resumo). */
    semEvento?: boolean;
  },
): Promise<ResultadoDaGravacao> {
  if (!tenantId) throw new ErroVenda('SEM_EMPRESA', 'Empresa não identificada.', 400);
  if (!entrada.id) throw new ErroVenda('SEM_ID', 'A venda precisa de id.', 400);
  let venda: Venda = { ...entrada, origem: opts.origem === 'crm' || opts.origem === 'mudanca' ? opts.origem : entrada.origem };
  await travarVenda(exec, tenantId, venda.id);
  const { rows: cabRows } = await exec.query(`SELECT data FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, venda.id]);
  const existente = (cabRows[0]?.data ?? null) as Record<string, unknown> | null;
  const { rows: modRows } = await exec.query(`SELECT situacao, numero, origem FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, venda.id]);
  // Venda trazida pela mudança de sistema (E7): continua "mudança" para sempre.
  if (txt(modRows[0]?.origem) === 'mudanca') venda = { ...venda, origem: 'mudanca' };
  const fechada = txt(modRows[0]?.situacao) === 'FECHADA';
  if (fechada && !opts.ignorarFechamento) {
    throw new ErroVenda('VENDA_FECHADA', 'A venda está fechada. Reabra a venda para mudar produtos ou pagamentos.', 409);
  }
  const nova = !existente;
  venda.numero = txt(existente?.numero) || txt(modRows[0]?.numero) || venda.numero || await proximoNumero(exec, tenantId);
  venda.situacao = fechada ? 'FECHADA' : 'ABERTA';
  // A venda que chega de novo do CRM não sabe do cancelamento feito aqui
  // (parte D): os cancelamentos gravados são reaplicados por cima.
  // (Só o que vem do CRM: a tela manda a venda já com o cancelamento dentro.)
  if (opts.evento === 'recebida_do_crm' && !nova) {
    const { reaplicarCancelamentosGravados } = await import('./cancelamento-servidor');
    venda = await reaplicarCancelamentosGravados(exec, tenantId, venda);
  }
  const { carteiraDisponivel, sincronizarCreditosDaVenda } = await import('./credito-cliente-servidor');
  const comCarteira = await carteiraDisponivel(exec);

  venda = await congelarTaxasDoCartao(exec, tenantId, venda);
  // Configuração de vendas da empresa da venda (E7). Uma empresa só: a de sempre.
  const empresaDaVenda = txt(opts.cabecalho?.empresa_id) || txt(existente?.empresa_id);
  const config = await lerConfigVenda(exec, tenantId, empresaDaVenda);
  const contas = await previaDasContas(exec, tenantId, venda);
  const receita = receitaDaVenda(venda, config.receita);

  // Cabeçalho (vendas_crm): o que já existia, o que quem chama acrescenta e,
  // por cima, os números calculados da venda.
  const calculado = cabecalhoDaVenda(venda, contas, receita.receita);
  const cab: Record<string, unknown> = { ...(existente ?? {}), ...(opts.cabecalho ?? {}), ...calculado };
  if (existente?.created_at) cab.created_at = existente.created_at;
  if (existente?.margem_prevista_original !== undefined && existente?.margem_prevista_original !== null) {
    cab.margem_prevista_original = existente.margem_prevista_original;
    cab.custo_previsto_original = existente.custo_previsto_original;
    cab.baseline_congelada_em = existente.baseline_congelada_em;
  } else {
    cab.margem_prevista_original = contas.resumo.lucro_previsto;
    cab.custo_previsto_original = contas.resumo.total_custos;
    cab.baseline_congelada_em = hojeISO();
  }
  await exec.query(
    `INSERT INTO vendas_crm (id, tenant_id, cliente_id, vendedor_id, status, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'CONFIRMADO', $5::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, cliente_id = EXCLUDED.cliente_id, vendedor_id = EXCLUDED.vendedor_id,
       status = EXCLUDED.status, updated_at = NOW()
     WHERE vendas_crm.tenant_id = EXCLUDED.tenant_id`,
    [venda.id, tenantId, venda.cliente.id, venda.vendedor?.id ?? '', JSON.stringify(cab)],
  );

  await exec.query(
    `INSERT INTO vendas_modelo (tenant_id, venda_id, versao_modelo, origem, situacao, numero, data_venda, cliente, vendedor, intermediario,
       grupo_id, centro_custo, observacoes, crm_venda_id, total_cliente_centavos, receita_centavos, operacao_propria, produtos_removidos)
     VALUES ($1,$2,2,$3,'ABERTA',$4,NULLIF($5,'')::date,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     ON CONFLICT (tenant_id, venda_id) DO UPDATE SET versao_modelo = 2, origem = EXCLUDED.origem, numero = EXCLUDED.numero,
       data_venda = EXCLUDED.data_venda, cliente = EXCLUDED.cliente, vendedor = EXCLUDED.vendedor, intermediario = EXCLUDED.intermediario,
       grupo_id = EXCLUDED.grupo_id, centro_custo = EXCLUDED.centro_custo, observacoes = EXCLUDED.observacoes, crm_venda_id = EXCLUDED.crm_venda_id,
       total_cliente_centavos = EXCLUDED.total_cliente_centavos, receita_centavos = EXCLUDED.receita_centavos,
       operacao_propria = EXCLUDED.operacao_propria, produtos_removidos = EXCLUDED.produtos_removidos,
       revisao = vendas_modelo.revisao + 1, atualizado_em = NOW()`,
    [tenantId, venda.id, venda.origem, venda.numero, venda.data_venda, JSON.stringify(venda.cliente), venda.vendedor ? JSON.stringify(venda.vendedor) : null,
      venda.intermediario ? JSON.stringify(venda.intermediario) : null, venda.grupo_id, venda.centro_custo, venda.observacoes, venda.crm_venda_id,
      totaisDaVenda(venda).valor_cliente, receita.receita, venda.operacao_propria === true, JSON.stringify(venda.produtos_removidos ?? [])],
  );
  await gravarFilhos(exec, tenantId, venda);

  // Itens no formato antigo (painel, produtos vendidos, telas antigas).
  await exec.query(`DELETE FROM itens_venda WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, venda.id]);
  for (const it of itensDerivados(venda)) {
    await exec.query(
      `INSERT INTO itens_venda (id, tenant_id, venda_id, fornecedor_id, sequencia, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET venda_id = EXCLUDED.venda_id, fornecedor_id = EXCLUDED.fornecedor_id, sequencia = EXCLUDED.sequencia,
         status = EXCLUDED.status, data = EXCLUDED.data, updated_at = NOW() WHERE itens_venda.tenant_id = EXCLUDED.tenant_id`,
      [it.id, tenantId, venda.id, it.fornecedor_id, it.sequencia, it.status, JSON.stringify(it.data)],
    );
  }

  // Venda trazida do sistema anterior (E7): as contas dela vieram das listas de
  // contas (em aberto e liquidadas) e ficam ligadas a ela. Gerar de novo
  // contaria o mesmo dinheiro duas vezes: as contas não nascem desta venda,
  // nem agora nem quando ela for editada ou cancelada aqui.
  const contasDaMudanca = venda.origem === 'mudanca';
  const regerado = contasDaMudanca
    ? { contas: { criadas: 0, atualizadas: 0, removidas: 0, preservadas: 0 }, avisos: [] as AvisoDaVenda[] }
    : await regerarContasDaVenda(exec, tenantId, venda.id, contas);
  const avisos = contasDaMudanca ? [] as AvisoDaVenda[] : [...contas.avisos, ...regerado.avisos];
  if (!contasDaMudanca) await sincronizarPendencias(exec, tenantId, venda.id, contas.pendencias, avisos, comCarteira);
  // Crédito do cliente (parte D): a carteira paga o que a forma pede, ou devolve.
  if (comCarteira && !contasDaMudanca) {
    const c = await sincronizarCreditosDaVenda(exec, tenantId, venda.id, opts.usuario ?? { id: '', nome: opts.origem === 'crm' ? 'CRM' : '' });
    if (c.faltando > 0) avisos.push({ codigo: 'CREDITO_INSUFICIENTE', valor_centavos: c.faltando, mensagem: `O cliente não tem crédito disponível para cobrir ${deCentavos(c.faltando).toFixed(2)} pagos com "Crédito do cliente". A pendência continua aberta até o crédito existir ou a forma mudar.` });
  }
  // Faturas ao cliente (E5, parte B): a forma Faturar entra na fatura pela regra do pagante.
  if (!contasDaMudanca) {
    await sincronizarFaturasDaVenda(exec, tenantId, venda.id, { avisos, venda_numero: venda.numero });
    // Dinheiro e cheque com "Liquidar automaticamente" (E7): a baixa de sempre, sozinha.
    const liquidacao = await liquidarContasDaVenda(exec, tenantId, venda.id, config.liquidar_automaticamente, hojeISO(), opts.usuario);
    if (liquidacao.liquidadas.length) {
      const n = liquidacao.liquidadas.length;
      avisos.push({ codigo: 'LIQUIDADA_AUTOMATICAMENTE', valor_centavos: Math.round(liquidacao.liquidadas.reduce((a, x) => a + x.valor, 0) * 100), mensagem: `${n === 1 ? '1 conta liquidada sozinha' : `${n} contas liquidadas sozinhas`} (${textoDoTotal(liquidacao)}), pela regra de Configurações › Vendas.` });
    }
    for (const x of liquidacao.recusadas) {
      avisos.push({ codigo: 'LIQUIDACAO_AUTOMATICA_RECUSADA', mensagem: `Uma conta de dinheiro ou cheque ficou em aberto: ${x.motivo}` });
    }
  }
  if (!opts.semEvento) await registrarEventoDaVenda(exec, tenantId, venda.id, opts.evento ?? (nova ? 'criada' : 'alterada'), {
    usuario: opts.usuario,
    detalhe: { ...(opts.detalheDoEvento ?? {}), contas: regerado.contas, total_cliente_centavos: totaisDaVenda(venda).valor_cliente, avisos: avisos.map(a => a.codigo) },
  });
  return { venda, contas: regerado.contas, avisos, pendencias: contas.pendencias, resumo: contas.resumo, nova };
}

// ============================================================
// Fechar e reabrir
// ============================================================

export interface PendenciaDoFechamento { codigo: string; mensagem: string; valor_centavos?: Centavos }

/** O que impede fechar a venda (e o que só pede confirmação). */
export function conferirFechamento(venda: Venda): { impedimentos: PendenciaDoFechamento[]; confirmar: PendenciaDoFechamento[] } {
  const t = totaisDaVenda(venda);
  const impedimentos: PendenciaDoFechamento[] = [];
  const confirmar: PendenciaDoFechamento[] = [];
  if (t.produtos_ativos === 0) impedimentos.push({ codigo: 'SEM_PRODUTO', mensagem: 'A venda não tem produto.' });
  if (venda.pagamentos.length > 0 && t.saldo_sem_forma > 0) impedimentos.push({ codigo: 'SALDO_SEM_FORMA', valor_centavos: t.saldo_sem_forma, mensagem: `Faltam ${deCentavos(t.saldo_sem_forma).toFixed(2)} sem forma de pagamento.` });
  if (t.saldo_sem_forma < 0) impedimentos.push({ codigo: 'PAGAMENTOS_ACIMA_DO_TOTAL', valor_centavos: -t.saldo_sem_forma, mensagem: `Os pagamentos passam do total em ${deCentavos(-t.saldo_sem_forma).toFixed(2)}.` });
  for (const p of venda.produtos) {
    if (p.cancelado_em) continue;
    const tp = totaisDoProduto(p);
    if (!p.fornecedor && !p.representante && tp.valor_fornecedor > 0 && !venda.operacao_propria) impedimentos.push({ codigo: 'PRODUTO_SEM_FORNECEDOR', mensagem: `${p.descricao || p.tipo}: falta o fornecedor.` });
    if (tp.receita_bruta === 0) confirmar.push({ codigo: 'PRODUTO_RECEITA_ZERO', mensagem: `${p.descricao || p.tipo}: a agência não ganha nada neste produto.` });
  }
  return { impedimentos, confirmar };
}

/** Fecha a venda. Venda de antes (v1) também fecha: ganha a linha no modelo, com as contas como estão. */
export async function fecharVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, opts: { usuario: UsuarioDaAcao; confirmar?: boolean }): Promise<VendaCarregada> {
  await travarVenda(exec, tenantId, vendaId);
  const atual = await carregarVenda(exec, tenantId, vendaId);
  if (!atual) throw new ErroVenda('NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  if (atual.situacao === 'FECHADA') throw new ErroVenda('JA_FECHADA', 'A venda já está fechada.', 409);
  const { impedimentos, confirmar } = conferirFechamento(atual.venda);
  if (atual.versao_modelo === 2 && impedimentos.length) {
    throw new ErroVenda('NAO_FECHA', impedimentos.map(i => i.mensagem).join(' '), 409, { impedimentos });
  }
  if (confirmar.length && !opts.confirmar) {
    throw new ErroVenda('CONFIRMAR', confirmar.map(i => i.mensagem).join(' '), 409, { confirmar });
  }
  await exec.query(
    `INSERT INTO vendas_modelo (tenant_id, venda_id, versao_modelo, origem, situacao, numero, data_venda, cliente, fechada_em, fechada_por)
     VALUES ($1, $2, 1, $3, 'FECHADA', $4, NULLIF($5,'')::date, $6::jsonb, NOW(), $7)
     ON CONFLICT (tenant_id, venda_id) DO UPDATE SET situacao = 'FECHADA', fechada_em = NOW(), fechada_por = EXCLUDED.fechada_por, atualizado_em = NOW()`,
    [tenantId, vendaId, atual.venda.origem, atual.venda.numero, atual.venda.data_venda, JSON.stringify(atual.venda.cliente), opts.usuario.nome || opts.usuario.id],
  );
  await exec.query(`UPDATE vendas_crm SET data = jsonb_set(data, '{situacao_venda}', '"FECHADA"', true), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, vendaId]);
  await registrarEventoDaVenda(exec, tenantId, vendaId, 'fechada', { usuario: opts.usuario, detalhe: { confirmado: confirmar.map(c => c.codigo) } });
  return (await carregarVenda(exec, tenantId, vendaId))!;
}

export const MOTIVO_MINIMO = 10;

/** Reabre a venda fechada. Motivo obrigatório; nenhuma conta muda (as baixadas ficam como estão). */
export async function reabrirVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, opts: { usuario: UsuarioDaAcao; motivo: string }): Promise<VendaCarregada> {
  const motivo = txt(opts.motivo).trim();
  if (motivo.length < MOTIVO_MINIMO) throw new ErroVenda('MOTIVO', `Diga o motivo para reabrir (pelo menos ${MOTIVO_MINIMO} letras).`, 400);
  await travarVenda(exec, tenantId, vendaId);
  const situacao = await situacaoDaVenda(exec, tenantId, vendaId);
  if (situacao !== 'FECHADA') throw new ErroVenda('NAO_FECHADA', 'A venda não está fechada.', 409);
  await exec.query(
    `UPDATE vendas_modelo SET situacao = 'ABERTA', fechada_em = NULL, fechada_por = NULL, atualizado_em = NOW() WHERE tenant_id = $1 AND venda_id = $2`,
    [tenantId, vendaId],
  );
  await exec.query(`UPDATE vendas_crm SET data = jsonb_set(data, '{situacao_venda}', '"ABERTA"', true), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, vendaId]);
  await registrarEventoDaVenda(exec, tenantId, vendaId, 'reaberta', { usuario: opts.usuario, motivo });
  return (await carregarVenda(exec, tenantId, vendaId))!;
}

// ============================================================
// Posição
// ============================================================

export interface PosicaoNoBanco {
  carregada: VendaCarregada;
  posicao: PosicaoDaVenda;
  contas_receber: Array<Record<string, unknown>>;
  contas_pagar: Array<Record<string, unknown>>;
  cobrancas: CobrancaDaPosicao[];
}

/** Todas as contas da venda (geradas e lançadas à mão ligadas a ela). */
export async function contasDaVendaNoBanco(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<{ contas_receber: Array<Record<string, unknown>>; contas_pagar: Array<Record<string, unknown>> }> {
  const { rows: cr } = await exec.query(
    `SELECT id, status, data FROM contas_receber WHERE tenant_id = $1 AND (venda_id = $2 OR data->>'origem_venda_id' = $2 OR data->>'venda_id' = $2) ORDER BY data->>'data_vencimento', id`,
    [tenantId, vendaId],
  );
  const { rows: cp } = await exec.query(
    `SELECT id, status, data FROM contas_pagar WHERE tenant_id = $1 AND (data->>'origem_venda_id' = $2 OR data->>'venda_id' = $2) ORDER BY data->>'data_vencimento', id`,
    [tenantId, vendaId],
  );
  const juntar = (r: Record<string, unknown>) => ({ ...(r.data as Record<string, unknown>), id: txt(r.id), status: txt((r.data as Record<string, unknown>)?.status ?? r.status) });
  // A conta que está numa fatura aparece pela situação da fatura (parte B);
  // a que entrou na fatura do fornecedor, pelo pagamento dela (parte C).
  return {
    contas_receber: await projetarContasNaFatura(exec, tenantId, cr.map(juntar)),
    contas_pagar: await refletirFaturasNasContas(exec, tenantId, cp.map(juntar)),
  };
}

export async function posicaoDaVendaNoBanco(exec: ExecutorSQL, tenantId: string, vendaId: string, hoje = hojeISO()): Promise<PosicaoNoBanco | null> {
  const carregada = await carregarVenda(exec, tenantId, vendaId);
  if (!carregada) return null;
  const { contas_receber, contas_pagar } = await contasDaVendaNoBanco(exec, tenantId, vendaId);
  let cobrancas: CobrancaDaPosicao[] = [];
  const { rows: temCob } = await exec.query(`SELECT to_regclass('public.cobrancas') IS NOT NULL AS ok`);
  if (temCob[0]?.ok && contas_receber.length) {
    const { rows } = await exec.query(
      `SELECT titulo_id, status, valor_centavos, vencimento FROM cobrancas WHERE tenant_id = $1 AND titulo_tabela = 'contas_receber' AND titulo_id = ANY($2::text[])`,
      [tenantId, contas_receber.map(c => txt(c.id))],
    );
    cobrancas = rows.map(r => ({ titulo_id: txt(r.titulo_id), status: txt(r.status), valor_centavos: Number(r.valor_centavos) || 0, vencimento: r.vencimento ? dataISO(r.vencimento) : null }));
  }
  const config = await lerConfigVenda(exec, tenantId);
  const posicao = posicaoDaVenda({
    venda: carregada.venda, contas_receber, contas_pagar, cobrancas, hoje, config: config.receita,
    pendencias: carregada.pendencias.map(p => ({ tipo: p.tipo, valor_centavos: p.valor_centavos, situacao: p.situacao })),
  });
  return { carregada, posicao, contas_receber, contas_pagar, cobrancas };
}

/** Componentes que a tela oferece, na ordem do mercado. */
export const ORDEM_DOS_COMPONENTES = TIPOS_COMPONENTE;
