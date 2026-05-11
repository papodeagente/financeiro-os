import pool, { initDB } from './db';
import { generateId } from './utils';
import { createHmac } from 'crypto';
import { getProdutoGrupo } from './financial-calculations';
import type { GrupoViagem } from './types';
import {
  createContaReceber,
  createContaPagar,
  type ContaReceber,
  type ContaPagar,
} from './crm-types';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface CrmConfig {
  ativo: boolean;
  webhook_url_entur: string;
  webhook_url_crm: string;
  api_key_entur: string;
  api_key_crm: string;
  retry_max: number;
  circuit_breaker_threshold: number;
  circuit_breaker_status: 'fechado' | 'aberto' | 'semi-aberto';
}

interface CrmStatus {
  ativo: boolean;
  circuit_breaker: 'fechado' | 'aberto' | 'semi-aberto';
  eventos_pendentes: number;
  eventos_falha: number;
  eventos_processados_hoje: number;
  ultimo_evento_saida: { tipo: string; status: string; timestamp: string } | null;
  ultimo_evento_entrada: { tipo: string; processado: boolean; timestamp: string } | null;
}

// ──────────────────────────────────────────
// Outbound payload builders
// ──────────────────────────────────────────

// Builds the payload sent to the CRM when a product (GrupoViagem) is
// published or updated. The CRM uses this to populate the product list
// at /settings/products, so we include the headline numbers (cost,
// sale, margin) plus the full price tree for richer displays.
export function buildProdutoPayload(grupo: GrupoViagem): Record<string, unknown> {
  const summary = getProdutoGrupo(grupo);

  // Public-facing host. Configurable via env so non-prod tenants can use
  // their own domains without code changes. Falls back to the
  // Coolify-injected URL, then to production.
  const publicUrl = (
    process.env.PUBLIC_APP_URL
    || process.env.COOLIFY_URL
    || (process.env.COOLIFY_FQDN ? `https://${process.env.COOLIFY_FQDN}` : '')
    || 'https://fin.enturos.com'
  ).replace(/\/$/, '');

  // --- Headline figures -------------------------------------------------
  // Escolhe o tipo de apto de referência. Grupo usa o primeiro da tarifa
  // ativa (DBL por convenção, mas pode ser SGL/TPL/QDP se foi o configurado).
  // Proposta usa SGL (cotação pontual, 1 pax). Em ambos os casos, faz
  // fallback para SGL se o tipo escolhido vier zerado.
  const tarifas = (grupo.tarifas_ativas || ['sgl', 'dbl', 'tpl', 'qdp']) as string[];
  const tipoRefPreferido = (grupo.tipo ?? 'GRUPO') === 'PROPOSTA' ? 'sgl' : (tarifas[0] ?? 'dbl');

  // Custo REAL no tipo de apto: somatório dos valores brutos (sem markup,
  // sem venda manual) direto da estrutura do grupo. Não usar
  // summary.custos_por_apto quando há venda manual — nesse caso
  // lineValues[servico] é a venda, não o custo.
  const PAX_MAP: Record<string, number> = { sgl: 1, dbl: 2, tpl: 3, qdp: 4, chd: 1 };
  const cambio = (k: string) => grupo.cambio?.[k]?.valor || 1;
  const minPositivo = (arr: Array<number | null | undefined>) => {
    const ok = arr.filter((v): v is number => typeof v === 'number' && v > 0);
    return ok.length === 0 ? 0 : Math.min(...ok);
  };

  const calcCustoNoTipo = (tipo: string): number => {
    const pax = PAX_MAP[tipo] || 1;
    let soma = 0;
    // TKT: melhor valor_adt por trecho × pax (ou totalChd se chd)
    for (const trecho of grupo.tkt?.trechos || []) {
      const best = tipo === 'chd'
        ? minPositivo((trecho.fontes || []).map(f => f.valor_chd))
        : minPositivo((trecho.fontes || []).map(f => f.valor_adt)) * pax;
      soma += best * cambio('tkt');
    }
    // HTL: melhor valor_<tipo> por hotel (preço total do quarto)
    for (const hotel of grupo.htl?.hoteis || []) {
      const best = minPositivo((hotel.fontes || []).map(f => {
        const v = (f as unknown as Record<string, number | null>)[`valor_${tipo}`];
        return typeof v === 'number' ? v : null;
      }));
      soma += best * cambio('htl');
    }
    // REC
    for (const passeio of grupo.rec?.passeios || []) {
      const best = tipo === 'chd'
        ? minPositivo((passeio.fornecedores || []).map(f => f.valor_chd))
        : minPositivo((passeio.fornecedores || []).map(f => f.valor_adt)) * pax;
      soma += best * cambio('rec');
    }
    // CAR (valor_veiculo rateado por minPax × pax do apto)
    const minPax = grupo.params.qtd_min_pax || 1;
    for (const transp of grupo.car?.transportes || []) {
      const best = minPositivo((transp.empresas || []).map(e => e.valor_veiculo));
      soma += (best / minPax) * pax * cambio('car');
    }
    // GUIA (idem CAR)
    for (const dest of grupo.guia?.destinos || []) {
      const best = minPositivo((dest.fornecedores || []).map(f => f.valor_total));
      soma += (best / minPax) * pax * cambio('guia');
    }
    // SEG (per room — CHD usa SGL)
    const segKey = tipo === 'chd' ? 'sgl' : tipo;
    const bestSeg = minPositivo((grupo.seg?.seguradoras || []).map(s => {
      const v = (s as unknown as Record<string, number | null>)[`valor_${segKey}`];
      return typeof v === 'number' ? v : null;
    }));
    soma += bestSeg * cambio('seg');
    // NAVIO (per cabin)
    const bestNavio = minPositivo((grupo.navio?.fornecedores || []).map(f => {
      const v = (f as unknown as Record<string, number | null>)[`valor_${tipo}`];
      return typeof v === 'number' ? v : null;
    }));
    soma += bestNavio * cambio('navio');
    // ING
    for (const atr of grupo.ing?.atrativos || []) {
      const best = tipo === 'chd'
        ? minPositivo((atr.fontes || []).map(f => f.valor_chd))
        : minPositivo((atr.fontes || []).map(f => f.valor_adt)) * pax;
      soma += best * cambio('ing');
    }
    return soma;
  };

  const precosAvista = summary.precos.avista as Record<string, number>;
  const calcVendaNoTipo = (tipo: string): number => precosAvista?.[tipo] ?? 0;

  // Tenta tipo preferido; se zerou tudo, percorre outros tipos com valor.
  const ordemTentativa: string[] = [tipoRefPreferido, 'dbl', 'sgl', 'tpl', 'qdp'];
  let tipoRef = tipoRefPreferido;
  let preco_custo = 0;
  let preco_venda = 0;
  for (const t of ordemTentativa) {
    const c = calcCustoNoTipo(t);
    const v = calcVendaNoTipo(t);
    if (c > 0 || v > 0) {
      tipoRef = t;
      preco_custo = c;
      preco_venda = v;
      break;
    }
  }
  preco_custo = Number(preco_custo.toFixed(2));
  preco_venda = Number(preco_venda.toFixed(2));
  const margem = Number(Math.max(preco_venda - preco_custo, 0).toFixed(2));
  const margem_percentual = preco_venda > 0
    ? Number(((margem / preco_venda) * 100).toFixed(2))
    : 0;

  // --- Suppliers list (unique by name, tagged by service) ----------------
  // CRM /settings/products usually wants one "supplier" per product, but
  // travel groups bundle many — we send them all so the CRM can show or
  // pick a primary one. Keeps name, type and an estimated cost share.
  const fornecedoresMap = new Map<string, { nome: string; tipo: string; servico: string; valor_estimado: number; fornecedor_id?: string; external_id?: string }>();
  const addFornecedor = (
    nome: string,
    tipo: string,
    servico: string,
    valor: number,
    fornecedorIdInterno?: string,
  ) => {
    if (!nome) return;
    if (!Number.isFinite(valor) || valor <= 0) return;
    const key = fornecedorIdInterno ? `id::${fornecedorIdInterno}` : `${tipo}::${nome}`;
    const prev = fornecedoresMap.get(key);
    fornecedoresMap.set(key, {
      nome,
      tipo,
      servico,
      valor_estimado: (prev?.valor_estimado || 0) + valor,
      fornecedor_id: fornecedorIdInterno || prev?.fornecedor_id,
      external_id: fornecedorIdInterno ? `entur_fornecedor_${fornecedorIdInterno}` : prev?.external_id,
    });
  };
  // Helper p/ ler qualquer campo de valor — checa custo E venda
  const hasAnyValue = (obj: Record<string, unknown>, keys: string[]) =>
    keys.some(k => {
      const v = obj[k];
      return typeof v === 'number' && v > 0;
    });

  // TKT (companhias aereas)
  for (const trecho of grupo.tkt?.trechos || []) {
    for (const fonte of trecho.fontes || []) {
      if (!hasAnyValue(fonte as unknown as Record<string, unknown>, ['valor_adt', 'valor_chd', 'valor_venda_adt', 'valor_venda_chd'])) continue;
      addFornecedor(fonte.nome, 'TKT', 'Aéreo', Number(fonte.valor_adt) || Number(fonte.valor_venda_adt) || 0, fonte.fornecedor_id);
    }
  }
  // HTL (hoteis)
  for (const hotel of grupo.htl?.hoteis || []) {
    for (const fonte of hotel.fontes || []) {
      const keys = ['valor_sgl', 'valor_dbl', 'valor_tpl', 'valor_qdp', 'valor_chd',
                    'valor_venda_sgl', 'valor_venda_dbl', 'valor_venda_tpl', 'valor_venda_qdp', 'valor_venda_chd'];
      if (!hasAnyValue(fonte as unknown as Record<string, unknown>, keys)) continue;
      addFornecedor(fonte.nome, 'HTL', 'Hotel', Number(fonte.valor_dbl) || Number(fonte.valor_sgl) || 0, fonte.fornecedor_id);
    }
  }
  // REC (receptivos)
  for (const passeio of grupo.rec?.passeios || []) {
    for (const fonte of passeio.fornecedores || []) {
      if (!hasAnyValue(fonte as unknown as Record<string, unknown>, ['valor_adt', 'valor_chd', 'valor_venda_adt', 'valor_venda_chd'])) continue;
      addFornecedor(fonte.nome, 'REC', 'Receptivo', Number(fonte.valor_adt) || 0, fonte.fornecedor_id);
    }
  }
  // CAR (transportes)
  for (const transp of grupo.car?.transportes || []) {
    for (const empresa of transp.empresas || []) {
      if (!hasAnyValue(empresa as unknown as Record<string, unknown>, ['valor_veiculo', 'valor_venda_veiculo'])) continue;
      addFornecedor(empresa.nome, 'CAR', 'Transporte', Number(empresa.valor_veiculo) || 0, empresa.fornecedor_id);
    }
  }
  // GUIA
  for (const destino of grupo.guia?.destinos || []) {
    for (const f of destino.fornecedores || []) {
      if (!hasAnyValue(f as unknown as Record<string, unknown>, ['valor_total', 'valor_venda_total'])) continue;
      addFornecedor(f.nome, 'GUIA', 'Guia', Number(f.valor_total) || 0);
    }
  }
  // SEG
  for (const s of grupo.seg?.seguradoras || []) {
    const keys = ['valor_sgl', 'valor_dbl', 'valor_tpl', 'valor_qdp',
                  'valor_venda_sgl', 'valor_venda_dbl', 'valor_venda_tpl', 'valor_venda_qdp'];
    if (!hasAnyValue(s as unknown as Record<string, unknown>, keys)) continue;
    addFornecedor(s.nome, 'SEG', 'Seguro', Number(s.valor_dbl) || 0);
  }
  // NAVIO
  for (const n of grupo.navio?.fornecedores || []) {
    const keys = ['valor_sgl', 'valor_dbl', 'valor_tpl', 'valor_qdp', 'valor_chd',
                  'valor_venda_sgl', 'valor_venda_dbl', 'valor_venda_tpl', 'valor_venda_qdp', 'valor_venda_chd'];
    if (!hasAnyValue(n as unknown as Record<string, unknown>, keys)) continue;
    addFornecedor(n.nome, 'NAVIO', 'Cruzeiro', Number(n.valor_dbl) || 0);
  }
  // ING
  for (const a of grupo.ing?.atrativos || []) {
    for (const f of a.fontes || []) {
      if (!hasAnyValue(f as unknown as Record<string, unknown>, ['valor_adt', 'valor_chd', 'valor_inf', 'valor_meia', 'valor_venda_adt', 'valor_venda_chd'])) continue;
      addFornecedor(f.nome, 'ING', 'Ingresso', Number(f.valor_adt) || 0);
    }
  }
  const fornecedores = Array.from(fornecedoresMap.values());

  // --- Links --------------------------------------------------------------
  // link_proposta: only when there's a proposta attached (status >= PROPOSTA).
  // link_produto: internal edit URL — always works for the agency user.
  const propostaId = grupo.proposta_id;
  const link_proposta = propostaId
    ? `${publicUrl}/p/${String(propostaId).slice(0, 8)}`
    : null;
  const link_produto = `${publicUrl}/grupo/${grupo.id}`;

  // Pick the first hotel image we find — used as the product cover.
  const imagem = grupo.htl?.hoteis?.[0]?.info?.hotel_imagem || null;

  // Distinct list of destinations across all periods.
  const destinos = Array.from(
    new Set((grupo.periodos || []).map(p => p.destino).filter(Boolean)),
  );
  const hoteis = Array.from(
    new Set((grupo.periodos || []).map(p => p.hotel).filter(Boolean)),
  );

  // Trip duration in nights.
  let duracao_noites: number | null = null;
  if (summary.datas.primeira_partida && summary.datas.ultimo_retorno) {
    const ms =
      new Date(summary.datas.ultimo_retorno).getTime() -
      new Date(summary.datas.primeira_partida).getTime();
    if (!Number.isNaN(ms) && ms > 0) {
      duracao_noites = Math.round(ms / (1000 * 60 * 60 * 24));
    }
  }

  return {
    // Identification
    grupo_id: grupo.id,
    grp_id: grupo.grp_id,
    nome: grupo.origem_destino,
    descricao: grupo.descricao_orcamento || '',
    imagem,
    status_pipeline: grupo.status_pipeline,

    // Headline figures — what /settings/products renders.
    // tipo_ref indica o apto de referência (sgl/dbl/tpl/qdp). Útil para o
    // CRM apresentar "Preço DBL: R$ X" em vez de só "Preço: R$ X".
    preco_custo,
    preco_venda,
    margem,
    margem_percentual,
    tipo_ref: tipoRef,
    moeda: 'BRL',

    // Suppliers (one entry per supplier×service)
    fornecedores,

    // Direct links
    link_proposta,
    link_produto,

    // Trip facts
    destinos,
    hoteis,
    data_inicio: summary.datas.primeira_partida,
    data_fim: summary.datas.ultimo_retorno,
    duracao_noites,
    qtd_min_pax: summary.qtd_min_pax,
    qtd_max_pax: summary.qtd_max_pax,

    // Full price tree by tariff (SGL/DBL/TPL/QDP/CHD) and payment form
    tarifas_ativas: grupo.tarifas_ativas,
    precos: summary.precos,
    precos_por_pax: summary.precos_por_pax,
    parcelas_apto: summary.parcelas_apto,
    custos_por_apto: summary.custos_por_apto,

    // Markup, tx, parcelas, etc.
    params: summary.params,
    deadlines: summary.deadlines,

    updated_at: grupo.updated_at,
  };
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function hmacSign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const BACKOFF_MINUTES = [1, 5, 30, 120, 480]; // 1min, 5min, 30min, 2h, 8h

function calcNextRetry(tentativas: number): Date {
  const idx = Math.min(tentativas, BACKOFF_MINUTES.length - 1);
  const ms = BACKOFF_MINUTES[idx] * 60 * 1000;
  return new Date(Date.now() + ms);
}

async function getCrmConfig(tenantId: string): Promise<CrmConfig | null> {
  if (!pool) return null;
  await initDB();
  const { rows } = await pool.query(
    "SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
    [tenantId],
  );
  if (rows.length === 0) return null;
  return rows[0].data as CrmConfig;
}

// Lists every active CRM config across tenants. Used only by the legacy
// (tenant-less) webhook fallback to reverse-lookup the tenant via HMAC.
async function listarCrmConfigsAtivas(): Promise<Array<{ tenantId: string; config: CrmConfig }>> {
  if (!pool) return [];
  await initDB();
  const { rows } = await pool.query(
    `SELECT tenant_id, data FROM crm_config WHERE id = 'singleton'`,
  );
  return rows
    .map(r => ({ tenantId: r.tenant_id as string, config: r.data as CrmConfig }))
    .filter(r => r.config?.ativo);
}

// ──────────────────────────────────────────
// Idempotent upserts by external_id
// --------------------------------------------------------------------
// The CRM emits prefixed external IDs ("crm_contact_<id>", "crm_user_<id>",
// "crm_supplier_<id>") that don't exist locally. These helpers resolve
// them to internal IDs, creating the row on first sight using the
// denormalized data the CRM sends alongside.
// ──────────────────────────────────────────

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

// Strip everything that isn't a digit. Returns '' for empty/invalid input.
// 14 digits = CNPJ, 11 digits = CPF — we accept both lengths so the same
// helper works for any document; downstream dedupes use (tenant_id, cnpj)
// for fornecedores and (tenant_id, cpf_cnpj) for clientes.
export function normalizeCnpj(v: unknown): string {
  const s = asStr(v).replace(/\D+/g, '');
  return s.length === 11 || s.length === 14 ? s : '';
}

function asNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// Normalizes the date-like value the CRM may send (Date, ISO string, or
// "YYYY-MM-DD") into the "YYYY-MM-DD" form the UI expects.
function asDateYMD(v: unknown): string {
  if (!v) return '';
  const s = asStr(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// CRM may use varied tokens ("pix", "Pix", "nao_definida", "cartao_credito").
// Coerce to the strict enum the UI renders.
function mapFormaRecebimento(s: string): ContaReceber['forma_recebimento'] {
  const u = s.toUpperCase();
  if (u.includes('PIX')) return 'PIX';
  if (u.includes('TED')) return 'TED';
  if (u.includes('CART')) return 'CARTAO';
  if (u.includes('BOL')) return 'BOLETO';
  if (u.includes('DIN')) return 'DINHEIRO';
  if (u.includes('CHEQ')) return 'CHEQUE';
  return '';
}

// ──────────────────────────────────────────
// Builders — pure mapping from CRM payload to local entity shape
// --------------------------------------------------------------------
// Exported so they can be unit-tested without a DB connection. The
// caller is still responsible for INSERTing the returned object.
// ──────────────────────────────────────────

interface VendaContext {
  vendaId: string;
  clienteId: string;
  clienteNome: string;
  enturGrupoId: string;
  crmVendaId: string;
}

// Resolves the commission the agency earns from a single supplier on this
// sale. Uses what the CRM sent (preferred), falls back to a proportional
// split of the total commission across suppliers' costs.
//
//   1. forn.comissao / forn.valor_comissao  → uses verbatim
//   2. forn.percentual_comissao             → percent over valor_custo
//   3. proportional split of `comissaoTotal` weighted by valor_custo
export function calcularComissaoFornecedor(
  forn: Record<string, unknown>,
  fornecedoresArray: Array<Record<string, unknown>>,
  comissaoTotal: number,
): number {
  if (forn.comissao != null) return asNum(forn.comissao);
  if (forn.valor_comissao != null) return asNum(forn.valor_comissao);

  const valorCusto = asNum(forn.valor_custo);

  if (forn.percentual_comissao != null) {
    const pct = asNum(forn.percentual_comissao);
    return Number(((valorCusto * pct) / 100).toFixed(2));
  }

  if (comissaoTotal > 0 && fornecedoresArray.length > 0) {
    const custoTotalSomado = fornecedoresArray.reduce(
      (acc, f) => acc + asNum(f.valor_custo),
      0,
    );
    if (custoTotalSomado <= 0) {
      // No costs to weigh by — split equally.
      return Number((comissaoTotal / fornecedoresArray.length).toFixed(2));
    }
    return Number(((valorCusto / custoTotalSomado) * comissaoTotal).toFixed(2));
  }

  return 0;
}

// Builds the supplier-side commission as a ContaReceber row. This replaces
// the old "1 CR per cliente parcela" flow — the customer pays the supplier
// directly, and only the commission flows back to the agency.
export function buildComissaoReceberFromFornecedor(
  forn: Record<string, unknown>,
  fornecedorId: string,
  ctx: VendaContext,
  valorComissao: number,
): ContaReceber {
  const fornecedorNome = asStr(forn.fornecedor_nome);
  const servico = asStr(forn.servico);
  const descricao = servico
    ? `Comissão ${servico} — ${fornecedorNome || 'Fornecedor'}`
    : `Comissão — ${fornecedorNome || 'Fornecedor'}`;
  const vencimento = asDateYMD(forn.vencimento_comissao || forn.vencimento_pagamento);

  return {
    ...createContaReceber(),
    id: generateId(),
    origem: 'COMISSAO_FORNECEDOR',
    venda_id: ctx.vendaId,
    grupo_id: ctx.enturGrupoId || null,
    cliente_id: ctx.clienteId,
    cliente_nome: ctx.clienteNome,
    descricao,
    valor_original: valorComissao,
    valor_final: valorComissao,
    data_vencimento: vencimento,
    forma_recebimento: '',
    parcela_numero: 1,
    total_parcelas: 1,
    status: 'PENDENTE',
    auto_gerado: true,
    origem_venda_id: ctx.vendaId,
    origem_item_id: fornecedorId,
    observacoes: ctx.crmVendaId
      ? `Comissão devida por ${fornecedorNome || 'fornecedor'} (venda ${ctx.crmVendaId})`
      : `Comissão devida por ${fornecedorNome || 'fornecedor'}`,
  };
}

// Aggregate fallback when the CRM doesn't itemize suppliers (fornecedores=[]).
// Creates one "summary" ContaPagar with the total cost so the agency still
// sees the liability — the user can later split per supplier manually.
export function buildContaPagarAgregada(
  ctx: VendaContext,
  custoTotal: number,
): ContaPagar {
  const valor = asNum(custoTotal);
  const base = createContaPagar();
  return {
    ...base,
    id: generateId(),
    origem: 'VENDA',
    venda_id: ctx.vendaId,
    grupo_id: ctx.enturGrupoId || null,
    fornecedor_id: '',
    fornecedor_nome: 'Custo da venda (a detalhar)',
    descricao: `Custo da venda ${ctx.crmVendaId || ctx.vendaId}`,
    valor_original: valor,
    valor_final: valor,
    valor_brl: valor,
    data_vencimento: '',
    status: 'PENDENTE',
    auto_gerado: true,
    origem_venda_id: ctx.vendaId,
    observacoes: ctx.crmVendaId
      ? `Custo agregado — fornecedor(es) não detalhado(s) pelo CRM (venda ${ctx.crmVendaId}). Editar para vincular fornecedor e anexar comprovante.`
      : 'Custo agregado — fornecedor(es) não detalhado(s) pelo CRM. Editar para vincular fornecedor e anexar comprovante.',
    ...({ requer_comprovante: true } as object),
  } as ContaPagar;
}

// Aggregate fallback for the supplier commission when fornecedores=[] but
// there is a positive gross margin. Uses 'COMISSAO_FORNECEDOR' so the UI
// renders the "Comissão" badge consistently with the per-supplier flow.
export function buildComissaoReceberAgregada(
  ctx: VendaContext,
  valorComissao: number,
): ContaReceber {
  const valor = asNum(valorComissao);
  return {
    ...createContaReceber(),
    id: generateId(),
    origem: 'COMISSAO_FORNECEDOR',
    venda_id: ctx.vendaId,
    grupo_id: ctx.enturGrupoId || null,
    cliente_id: ctx.clienteId,
    cliente_nome: ctx.clienteNome,
    descricao: `Margem — Venda ${ctx.crmVendaId || ctx.vendaId}`,
    valor_original: valor,
    valor_final: valor,
    data_vencimento: '',
    forma_recebimento: '',
    parcela_numero: 1,
    total_parcelas: 1,
    status: 'PENDENTE',
    auto_gerado: true,
    origem_venda_id: ctx.vendaId,
    observacoes: ctx.crmVendaId
      ? `Margem agregada — fornecedor(es) não detalhado(s) pelo CRM (venda ${ctx.crmVendaId})`
      : 'Margem agregada — fornecedor(es) não detalhado(s) pelo CRM',
  };
}

// ContaPagar = supplier cost. Flagged with requer_comprovante=true because
// the customer typically pays the supplier directly — the agency still
// needs proof of payment to close the books.
export function buildContaPagarFromFornecedor(
  forn: Record<string, unknown>,
  fornecedorId: string,
  ctx: VendaContext,
): ContaPagar {
  const fornecedorNome = asStr(forn.fornecedor_nome);
  const fornecedorCnpj = normalizeCnpj(forn.fornecedor_cnpj);
  const valorCusto = asNum(forn.valor_custo);
  const servico = asStr(forn.servico);
  const descricao = servico
    ? `${servico} — ${fornecedorNome || 'Fornecedor'}`
    : `${fornecedorNome || 'Fornecedor'} — Venda ${ctx.crmVendaId || ctx.vendaId}`;

  // The interface doesn't have a typed `requer_comprovante` field, so we
  // attach it as a JSONB extension. Any UI/report that wants to surface
  // it reads from data->>'requer_comprovante'.
  const base = createContaPagar();
  return {
    ...base,
    id: generateId(),
    origem: 'VENDA',
    venda_id: ctx.vendaId,
    grupo_id: ctx.enturGrupoId || null,
    fornecedor_id: fornecedorId,
    fornecedor_nome: fornecedorNome,
    descricao,
    valor_original: valorCusto,
    valor_final: valorCusto,
    valor_brl: valorCusto,
    data_vencimento: asDateYMD(forn.vencimento_pagamento),
    status: 'PENDENTE',
    auto_gerado: true,
    origem_venda_id: ctx.vendaId,
    observacoes: ctx.crmVendaId
      ? `Pago pelo cliente direto ao fornecedor — comprovante obrigatório (venda ${ctx.crmVendaId})`
      : 'Pago pelo cliente direto ao fornecedor — comprovante obrigatório',
    // JSONB extensions consumed via JSON path (UI/reports).
    ...({
      requer_comprovante: true,
      fornecedor_cnpj: fornecedorCnpj,
    } as object),
  } as ContaPagar;
}

async function upsertClienteByExternalId(
  externalId: string,
  dados: { nome?: unknown; cpf?: unknown; email?: unknown; telefone?: unknown },
  tenantId: string,
): Promise<string> {
  if (!pool || !externalId) throw new Error('upsertCliente: external_id obrigatorio');

  const { rows } = await pool.query(
    `SELECT id FROM clientes WHERE external_id = $1 AND tenant_id = $2 LIMIT 1`,
    [externalId, tenantId],
  );
  if (rows.length > 0) return rows[0].id as string;

  const id = generateId();
  const nome = asStr(dados.nome);
  const cpf = asStr(dados.cpf);
  const email = asStr(dados.email);
  const telefone = asStr(dados.telefone);
  const data = {
    id,
    nome,
    cpf_cnpj: cpf,
    tipo: 'fisica',
    email,
    telefone,
    origem: 'crm',
    external_id: externalId,
  };
  await pool.query(
    `INSERT INTO clientes (id, nome, cpf_cnpj, tipo, data, external_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'fisica', $4, $5, $6, NOW(), NOW())`,
    [id, nome, cpf, JSON.stringify(data), externalId, tenantId],
  );
  return id;
}

async function upsertVendedorByExternalId(
  externalId: string,
  dados: { nome?: unknown; email?: unknown },
  tenantId: string,
): Promise<string> {
  if (!pool || !externalId) throw new Error('upsertVendedor: external_id obrigatorio');

  const { rows } = await pool.query(
    `SELECT id FROM usuarios WHERE external_id = $1 AND tenant_id = $2 LIMIT 1`,
    [externalId, tenantId],
  );
  if (rows.length > 0) return rows[0].id as string;

  const id = generateId();
  const nome = asStr(dados.nome);
  const email = asStr(dados.email);
  const data = { id, nome, email, origem: 'crm', external_id: externalId };
  await pool.query(
    `INSERT INTO usuarios (id, nome, email, data, external_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [id, nome, email, JSON.stringify(data), externalId, tenantId],
  );
  return id;
}

// 3-stage upsert so the same supplier is never duplicated across systems.
//
//   1) match by (tenant_id, external_id) — strongest signal, idempotent
//      across replays of the same CRM event
//   2) match by (tenant_id, cnpj)        — survives CRM id changes
//      (resync/merge) and recognizes the same supplier between systems.
//      When matched here we also store the latest external_id on the row
//      so step 1 wins on the next call.
//   3) INSERT — new supplier
async function upsertFornecedorByExternalId(
  externalId: string,
  dados: { nome?: unknown; cnpj?: unknown },
  tenantId: string,
): Promise<string> {
  if (!pool || !externalId) throw new Error('upsertFornecedor: external_id obrigatorio');

  // (1) match by external_id
  const byExt = await pool.query(
    `SELECT id, data FROM fornecedores_crm
      WHERE external_id = $1 AND tenant_id = $2 LIMIT 1`,
    [externalId, tenantId],
  );
  if (byExt.rows.length > 0) {
    return byExt.rows[0].id as string;
  }

  const cnpj = normalizeCnpj(dados.cnpj);
  const nome = asStr(dados.nome);

  // (2) match by cnpj
  if (cnpj) {
    const byCnpj = await pool.query(
      `SELECT id, data FROM fornecedores_crm
        WHERE cnpj = $1 AND tenant_id = $2 LIMIT 1`,
      [cnpj, tenantId],
    );
    if (byCnpj.rows.length > 0) {
      const existingId = byCnpj.rows[0].id as string;
      const prevData = (byCnpj.rows[0].data as Record<string, unknown>) || {};
      // Stamp the latest external_id on the row so future calls hit (1).
      const mergedData = { ...prevData, external_id: externalId };
      await pool.query(
        `UPDATE fornecedores_crm
            SET external_id = $1, data = $2, updated_at = NOW()
          WHERE id = $3 AND tenant_id = $4`,
        [externalId, JSON.stringify(mergedData), existingId, tenantId],
      );
      return existingId;
    }
  }

  // (3) new row
  const id = generateId();
  const data = {
    id,
    nome_fantasia: nome,
    razao_social: nome,
    cnpj,
    categoria: '',
    origem: 'crm',
    external_id: externalId,
  };
  await pool.query(
    `INSERT INTO fornecedores_crm (id, nome_fantasia, cnpj, categoria, data, external_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, '', $4, $5, $6, NOW(), NOW())`,
    [id, nome, cnpj, JSON.stringify(data), externalId, tenantId],
  );
  return id;
}

// ──────────────────────────────────────────
// emitirEventoCRM — fire-and-forget
// ──────────────────────────────────────────

export async function emitirEventoCRM(
  tipo: string,
  payload: Record<string, unknown>,
  opcoes: { tenantId: string; idempotency_key?: string }
): Promise<void> {
  try {
    if (!pool) return;
    if (!opcoes?.tenantId) return; // tenant context required
    await initDB();

    const tenantId = opcoes.tenantId;
    const id = opcoes.idempotency_key || generateId();
    const timestamp = new Date().toISOString();
    const eventBody = { id, tipo, timestamp, versao: 'v1', origem: 'entur-os', payload };

    // Insert as PENDENTE (scoped to tenant).
    await pool.query(
      `INSERT INTO crm_eventos_saida (id, tipo, status, tentativas, data, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'PENDENTE', 0, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, tipo, JSON.stringify(eventBody), tenantId]
    );

    const config = await getCrmConfig(tenantId);
    if (!config || !config.ativo || config.circuit_breaker_status === 'aberto') {
      return;
    }

    if (!config.webhook_url_crm) return;

    const bodyStr = JSON.stringify(eventBody);
    const signature = hmacSign(bodyStr, config.api_key_crm || '');
    const start = Date.now();

    try {
      const res = await fetch(config.webhook_url_crm, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-entur-event': tipo,
          'x-entur-signature': signature,
          'x-entur-event-id': id,
          'x-entur-timestamp': timestamp,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(5000),
      });

      const latencia = Date.now() - start;

      if (res.ok) {
        await pool.query(
          `UPDATE crm_eventos_saida SET status = 'ENVIADO', latencia_ms = $2, updated_at = NOW() WHERE id = $1`,
          [id, latencia]
        );
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      // Delivery failed — schedule retry
      const tentativas = 1;
      const proxima = calcNextRetry(tentativas);
      await pool.query(
        `UPDATE crm_eventos_saida SET status = 'FALHA', tentativas = $2, proxima_tentativa = $3, updated_at = NOW() WHERE id = $1`,
        [id, tentativas, proxima.toISOString()]
      );

      // Check circuit breaker (scoped to this tenant's recent failures).
      const { rows } = await pool.query(
        `SELECT COUNT(*) as cnt FROM crm_eventos_saida
         WHERE status = 'FALHA' AND tenant_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [tenantId]
      );
      const failCount = parseInt(rows[0].cnt, 10);
      if (failCount >= (config.circuit_breaker_threshold || 10)) {
        await pool.query(
          `UPDATE crm_config SET data = jsonb_set(data, '{circuit_breaker_status}', '"aberto"'), updated_at = NOW()
           WHERE id = 'singleton' AND tenant_id = $1`,
          [tenantId]
        );
      }
    }
  } catch {
    // Never propagate errors from CRM integration
  }
}

// ──────────────────────────────────────────
// processarEventoCRM — inbound events
// ──────────────────────────────────────────

export async function processarEventoCRM(
  tipo: string,
  payload: Record<string, unknown>,
  idempotency_key: string,
  tenantId: string,
): Promise<{ processado: boolean; acao: string; erro?: string }> {
  try {
    if (!pool) return { processado: false, acao: 'sem banco de dados' };
    if (!tenantId) return { processado: false, acao: 'tenant ausente' };
    await initDB();

    // Idempotency is scoped per-tenant: same idempotency_key from different
    // tenants is treated as different events.
    const { rows: existing } = await pool.query(
      `SELECT id FROM crm_eventos_entrada WHERE idempotency_key = $1 AND tenant_id = $2`,
      [idempotency_key, tenantId]
    );
    if (existing.length > 0) {
      return { processado: true, acao: 'duplicata ignorada' };
    }

    const id = generateId();
    await pool.query(
      `INSERT INTO crm_eventos_entrada (id, idempotency_key, tipo, status, processado, data, tenant_id, created_at)
       VALUES ($1, $2, $3, 'RECEBIDO', false, $4, $5, NOW())`,
      [id, idempotency_key, tipo, JSON.stringify({ tipo, payload, received_at: new Date().toISOString() }), tenantId]
    );

    let acao = '';

    switch (tipo) {
      case 'VENDA_FECHADA': {
        // 1) Resolve external IDs (cliente, vendedor, fornecedores) to
        //    internal IDs. Creates rows on first sight using denormalized
        //    data the CRM sends.
        const clienteExternalId = asStr(payload.cliente_id);
        if (!clienteExternalId) {
          throw new Error('VENDA_FECHADA sem cliente_id');
        }
        const clienteId = await upsertClienteByExternalId(
          clienteExternalId,
          {
            nome: payload.cliente_nome,
            cpf: payload.cliente_cpf,
            email: payload.cliente_email,
            telefone: payload.cliente_telefone,
          },
          tenantId,
        );

        const vendedorExternalId = asStr(payload.vendedor_id);
        let vendedorId = '';
        if (vendedorExternalId) {
          vendedorId = await upsertVendedorByExternalId(
            vendedorExternalId,
            { nome: payload.vendedor_nome, email: payload.vendedor_email },
            tenantId,
          );
        }

        // 2) Compute commercial metrics. The CRM may send `custo_total`,
        //    `rentabilidade` and `comissao` directly (preferred — that's
        //    what the salesperson committed to). Otherwise we derive from
        //    the fornecedores breakdown.
        const valorTotal = Number(payload.valor_total) || 0;
        const fornecedoresPayload = (payload.fornecedores as Array<Record<string, unknown>>) || [];
        const custoFornecedores = fornecedoresPayload.reduce(
          (acc, f) => acc + (Number(f.valor_custo) || 0),
          0,
        );
        const custoTotal = payload.custo_total != null
          ? Number(payload.custo_total)
          : custoFornecedores;
        const rentabilidade = payload.rentabilidade != null
          ? Number(payload.rentabilidade)
          : Math.max(valorTotal - custoTotal, 0);
        const comissao = payload.comissao != null
          ? Number(payload.comissao)
          : null;
        const margemPercentual = valorTotal > 0
          ? Number(((rentabilidade / valorTotal) * 100).toFixed(2))
          : 0;

        // Total commission to distribute across suppliers. Prefer the
        // explicit value from the CRM; treat 0 as "not modeled" (the CRM
        // sends 0 when it doesn't track commission per deal yet) and fall
        // back to the gross margin so the agency still sees a receivable.
        const comissaoTotal = (comissao != null && comissao > 0) ? comissao : rentabilidade;

        // Cliente parcelas (condicoes_pagamento) are kept as a payment
        // history reference on the venda — they DO NOT become contas a
        // receber. The customer pays the supplier directly; only the
        // commission flows back to the agency.
        const parcelasCliente = (payload.condicoes_pagamento as Array<Record<string, unknown>>) || [];

        const vendaId = generateId();
        // Data da venda: prefere o que veio do CRM (data real do fechamento),
        // senão usa hoje.
        const dataVenda = asStr(payload.data_venda) || new Date().toISOString().slice(0, 10);
        // Próximo número sequencial — usado pelas telas legadas (dashboard,
        // /vendas). Formato VND-NNNN.
        const { rows: countRows } = await pool.query(
          `SELECT COUNT(*) AS c FROM vendas_crm WHERE tenant_id = $1`,
          [tenantId],
        );
        const numeroVenda = `VND-${String(parseInt(countRows[0].c) + 1).padStart(4, '0')}`;

        const vendaId_ = vendaId;
        const vendaData = {
          // ---- Identificação ----
          id: vendaId,
          numero: numeroVenda,                     // legado: dashboard mostra
          cliente_id: clienteId,
          cliente_external_id: clienteExternalId,
          vendedor_id: vendedorId,
          vendedor_external_id: vendedorExternalId,
          grupo_id: payload.entur_grupo_id || '',
          proposta_id: payload.entur_proposta_id || '',
          crm_venda_id: payload.crm_venda_id || '',

          // ---- Datas ----
          data_venda: dataVenda,                    // legado: filtros mensais
          created_at: new Date().toISOString(),

          // ---- Métricas comerciais (novo modelo) ----
          valor_total: valorTotal,
          custo_total: custoTotal,
          rentabilidade,
          margem_percentual: margemPercentual,
          comissao: comissaoTotal,

          // ---- Aliases para schema LEGADO (DRE/indicadores/dashboard lêem) ----
          valor_final: valorTotal,                  // alias valor_total
          valor_total_venda: valorTotal,
          valor_total_custo: custoTotal,            // alias custo_total
          markup_realizado: comissaoTotal,          // margem bruta
          desconto: 0,

          // ---- Arrays obrigatórios (telas fazem reduce/forEach) ----
          passageiros: [],
          pagantes: [],
          produtos: [],                             // CRM ainda não envia itemizado

          // ---- Status e metadata ----
          moeda: payload.moeda || 'BRL',
          status: 'CONFIRMADO',                     // legado: enum StatusVendaCRM
          tipo: payload.entur_grupo_id ? 'GRUPO' : 'AVULSA',
          origem: 'crm',
          forma_pagamento: 'AVISTA_PIX',
          parcelas: parcelasCliente.length || 1,
          // Audit trail of how the customer is paying the supplier(s).
          // Not financial liability for the agency.
          parcelas_cliente: parcelasCliente,
        };
        await pool.query(
          `INSERT INTO vendas_crm (id, cliente_id, vendedor_id, status, data, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, 'CONFIRMADO', $4, $5, NOW(), NOW())`,
          [vendaId_, clienteId, vendedorId, JSON.stringify(vendaData), tenantId]
        );

        // 3) Generate CP + CR. Two paths:
        //    a) Per-supplier (CRM detailed fornecedores[] with id+nome+custo)
        //    b) Aggregated   (CRM didn't itemize — fornecedores=[]) — uses
        //       custo_total / margem to keep the agency seeing the venda
        //       in /financeiro-ag/{receber,pagar}.
        const ctx: VendaContext = {
          vendaId,
          clienteId,
          clienteNome: asStr(payload.cliente_nome),
          enturGrupoId: asStr(payload.entur_grupo_id),
          crmVendaId: asStr(payload.crm_venda_id),
        };

        let cpGerados = 0;
        let crGerados = 0;
        let crValor = 0;
        let modo = '';

        const fornecedoresValidos = fornecedoresPayload.filter(
          f => !!asStr(f.fornecedor_id),
        );

        if (fornecedoresValidos.length > 0) {
          // (a) Per-supplier
          modo = 'per-supplier';
          for (const forn of fornecedoresValidos) {
            const fornExternalId = asStr(forn.fornecedor_id);
            const fornecedorId = await upsertFornecedorByExternalId(
              fornExternalId,
              {
                nome: forn.fornecedor_nome,
                cnpj: forn.fornecedor_cnpj,
              },
              tenantId,
            );

            const contaPagar = buildContaPagarFromFornecedor(forn, fornecedorId, ctx);
            await pool.query(
              `INSERT INTO contas_pagar (id, fornecedor_id, status, data, tenant_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW())`,
              [contaPagar.id, fornecedorId, contaPagar.status, JSON.stringify(contaPagar), tenantId],
            );
            cpGerados++;

            const valorComissao = calcularComissaoFornecedor(forn, fornecedoresValidos, comissaoTotal);
            if (valorComissao > 0) {
              const contaReceber = buildComissaoReceberFromFornecedor(forn, fornecedorId, ctx, valorComissao);
              await pool.query(
                `INSERT INTO contas_receber (id, venda_id, cliente_id, status, data, tenant_id, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())`,
                [contaReceber.id, vendaId, clienteId, contaReceber.status, JSON.stringify(contaReceber), tenantId],
              );
              crGerados++;
              crValor += valorComissao;
            }
          }
        } else {
          // (b) Aggregated — CRM didn't list suppliers
          modo = 'aggregated';
          if (custoTotal > 0) {
            const cp = buildContaPagarAgregada(ctx, custoTotal);
            await pool.query(
              `INSERT INTO contas_pagar (id, fornecedor_id, status, data, tenant_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW())`,
              [cp.id, '', cp.status, JSON.stringify(cp), tenantId],
            );
            cpGerados++;
          }
          if (comissaoTotal > 0) {
            const cr = buildComissaoReceberAgregada(ctx, comissaoTotal);
            await pool.query(
              `INSERT INTO contas_receber (id, venda_id, cliente_id, status, data, tenant_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())`,
              [cr.id, vendaId, clienteId, cr.status, JSON.stringify(cr), tenantId],
            );
            crGerados++;
            crValor += comissaoTotal;
          }
        }

        acao = `venda criada (${vendaId}, ${modo}): ${cpGerados} CP (custo R$ ${custoTotal.toFixed(2)}), ${crGerados} CR (comissão R$ ${crValor.toFixed(2)})`;
        break;
      }

      case 'PAGAMENTO_CONFIRMADO': {
        const { entur_venda_id, parcela: numParcela, valor, data_pagamento } = payload;
        const { rows: receber } = await pool.query(
          `SELECT id, data FROM contas_receber WHERE venda_id = $1`,
          [entur_venda_id]
        );
        for (const row of receber) {
          const d = row.data as Record<string, unknown>;
          if (d.parcela === numParcela) {
            d.status = 'RECEBIDO';
            d.data_pagamento = data_pagamento;
            d.valor_recebido = valor;
            await pool.query(
              `UPDATE contas_receber SET status = 'RECEBIDO', data = $2, updated_at = NOW() WHERE id = $1`,
              [row.id, JSON.stringify(d)]
            );
          }
        }
        acao = `pagamento confirmado parcela ${numParcela}`;
        break;
      }

      case 'PAGAMENTO_ATRASADO': {
        const { entur_venda_id: vendaIdAtr, parcela: parcAtr } = payload;
        const { rows: receberAtr } = await pool.query(
          `SELECT id, data FROM contas_receber WHERE venda_id = $1`,
          [vendaIdAtr]
        );
        for (const row of receberAtr) {
          const d = row.data as Record<string, unknown>;
          if (d.parcela === parcAtr) {
            d.status = 'ATRASADO';
            d.dias_atraso = payload.dias_atraso;
            await pool.query(
              `UPDATE contas_receber SET status = 'ATRASADO', data = $2, updated_at = NOW() WHERE id = $1`,
              [row.id, JSON.stringify(d)]
            );
          }
        }
        acao = `parcela ${parcAtr} marcada como atrasada`;
        break;
      }

      case 'CLIENTE_ATUALIZADO': {
        const externalId = asStr(payload.cliente_id);
        const camposAlterados = payload.campos_alterados as Record<string, unknown> | undefined;
        if (externalId && camposAlterados) {
          // CRM sends prefixed external_id ("crm_contact_<id>"), not internal id.
          const { rows: cliRows } = await pool.query(
            `SELECT id, data FROM clientes WHERE external_id = $1 LIMIT 1`,
            [externalId]
          );
          if (cliRows.length > 0) {
            const merged = { ...cliRows[0].data, ...camposAlterados };
            await pool.query(
              `UPDATE clientes SET data = $2, updated_at = NOW() WHERE id = $1`,
              [cliRows[0].id, JSON.stringify(merged)]
            );
          }
        }
        acao = `cliente ${externalId} atualizado`;
        break;
      }

      case 'ORCAMENTO_ATRIBUIDO': {
        // O CRM avisa que o produto entrou em um card de funil (estagio
        // 'ORCAMENTO'). Apenas atualiza status_pipeline e referencia ao
        // deal — SEM efeito financeiro (nada de CR/CP).
        const grupoId = asStr(payload.grupo_id || payload.entur_grupo_id);
        const crmDealId = asStr(payload.crm_deal_id || payload.crm_venda_id);
        const dealUrl = asStr(payload.deal_url);
        if (!grupoId) {
          acao = 'ORCAMENTO_ATRIBUIDO sem grupo_id';
          break;
        }
        const { rows: gRows } = await pool.query(
          `SELECT data FROM grupos WHERE id = $1 AND tenant_id = $2`,
          [grupoId, tenantId],
        );
        if (gRows.length === 0) {
          acao = `grupo ${grupoId} nao encontrado`;
          break;
        }
        const gData = gRows[0].data as Record<string, unknown>;
        gData.status_pipeline = 'ORCAMENTO';
        if (crmDealId) gData.orcamento_id = crmDealId;
        if (dealUrl) gData.crm_deal_url = dealUrl;
        await pool.query(
          `UPDATE grupos SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          [JSON.stringify(gData), grupoId, tenantId],
        );
        acao = `grupo ${grupoId} -> ORCAMENTO${crmDealId ? ` (deal ${crmDealId})` : ''}`;
        break;
      }

      case 'PROPOSTA_VISUALIZADA': {
        const { proposta_id, timestamp, duracao_segundos } = payload;
        if (proposta_id) {
          const { rows: propRows } = await pool.query(
            `SELECT data FROM propostas WHERE id = $1`,
            [proposta_id]
          );
          if (propRows.length > 0) {
            const propData = propRows[0].data as Record<string, unknown>;
            const views = (propData.visualizacoes as Array<unknown>) || [];
            views.push({ timestamp, duracao_segundos, origem: 'crm' });
            propData.visualizacoes = views;
            await pool.query(
              `UPDATE propostas SET data = $2, updated_at = NOW() WHERE id = $1`,
              [proposta_id, JSON.stringify(propData)]
            );
          }
        }
        acao = `visualizacao registrada para proposta ${proposta_id}`;
        break;
      }

      default:
        acao = `tipo desconhecido: ${tipo}`;
    }

    // Mark as processed
    await pool.query(
      `UPDATE crm_eventos_entrada SET processado = true, status = 'PROCESSADO' WHERE id = $1`,
      [id]
    );

    return { processado: true, acao };
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro desconhecido';
    // Try to record the error
    try {
      if (pool) {
        await pool.query(
          `UPDATE crm_eventos_entrada SET erro = $2 WHERE idempotency_key = $1`,
          [idempotency_key, erro]
        );
      }
    } catch { /* ignore */ }
    return { processado: false, acao: 'erro no processamento', erro };
  }
}

// ──────────────────────────────────────────
// statusIntegracaoCRM
// ──────────────────────────────────────────

export async function statusIntegracaoCRM(tenantId: string): Promise<CrmStatus> {
  const defaults: CrmStatus = {
    ativo: false,
    circuit_breaker: 'fechado',
    eventos_pendentes: 0,
    eventos_falha: 0,
    eventos_processados_hoje: 0,
    ultimo_evento_saida: null,
    ultimo_evento_entrada: null,
  };

  try {
    if (!pool || !tenantId) return defaults;
    await initDB();

    const config = await getCrmConfig(tenantId);
    if (config) {
      defaults.ativo = config.ativo;
      defaults.circuit_breaker = config.circuit_breaker_status || 'fechado';
    }

    const pendentes = await pool.query(
      `SELECT COUNT(*) as cnt FROM crm_eventos_saida WHERE status = 'PENDENTE' AND tenant_id = $1`,
      [tenantId]
    );
    defaults.eventos_pendentes = parseInt(pendentes.rows[0].cnt, 10);

    const falhas = await pool.query(
      `SELECT COUNT(*) as cnt FROM crm_eventos_saida WHERE status = 'FALHA' AND tenant_id = $1`,
      [tenantId]
    );
    defaults.eventos_falha = parseInt(falhas.rows[0].cnt, 10);

    const hoje = await pool.query(
      `SELECT COUNT(*) as cnt FROM crm_eventos_entrada
       WHERE processado = true AND tenant_id = $1 AND created_at > CURRENT_DATE`,
      [tenantId]
    );
    defaults.eventos_processados_hoje = parseInt(hoje.rows[0].cnt, 10);

    const ultimoSaida = await pool.query(
      `SELECT tipo, status, created_at FROM crm_eventos_saida
       WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );
    if (ultimoSaida.rows.length > 0) {
      defaults.ultimo_evento_saida = {
        tipo: ultimoSaida.rows[0].tipo,
        status: ultimoSaida.rows[0].status,
        timestamp: ultimoSaida.rows[0].created_at,
      };
    }

    const ultimoEntrada = await pool.query(
      `SELECT tipo, processado, created_at FROM crm_eventos_entrada
       WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );
    if (ultimoEntrada.rows.length > 0) {
      defaults.ultimo_evento_entrada = {
        tipo: ultimoEntrada.rows[0].tipo,
        processado: ultimoEntrada.rows[0].processado,
        timestamp: ultimoEntrada.rows[0].created_at,
      };
    }

    return defaults;
  } catch {
    return defaults;
  }
}

// ──────────────────────────────────────────
// retentarEventosFalha
// ──────────────────────────────────────────

export async function retentarEventosFalha(tenantId: string, ids?: string[]): Promise<{
  retentados: number;
  sucesso: number;
  falha: number;
}> {
  const result = { retentados: 0, sucesso: 0, falha: 0 };
  try {
    if (!pool || !tenantId) return result;
    await initDB();

    const config = await getCrmConfig(tenantId);
    if (!config || !config.ativo || !config.webhook_url_crm) return result;

    let query = `SELECT id, tipo, tentativas, data FROM crm_eventos_saida
                 WHERE status = 'FALHA' AND tenant_id = $1`;
    if (ids && ids.length > 0) {
      query += ` AND id = ANY($2)`;
    }
    query += ` ORDER BY created_at ASC LIMIT 50`;

    const { rows } = ids && ids.length > 0
      ? await pool.query(query, [tenantId, ids])
      : await pool.query(query, [tenantId]);

    for (const row of rows) {
      result.retentados++;
      const bodyStr = JSON.stringify(row.data);
      const signature = hmacSign(bodyStr, config.api_key_crm || '');
      const start = Date.now();

      try {
        const res = await fetch(config.webhook_url_crm, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-entur-event': row.tipo,
            'x-entur-signature': signature,
            'x-entur-event-id': row.id,
            'x-entur-timestamp': new Date().toISOString(),
          },
          body: bodyStr,
          signal: AbortSignal.timeout(5000),
        });

        const latencia = Date.now() - start;

        if (res.ok) {
          await pool.query(
            `UPDATE crm_eventos_saida SET status = 'ENVIADO', latencia_ms = $2, updated_at = NOW() WHERE id = $1`,
            [row.id, latencia]
          );
          result.sucesso++;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        const tentativas = (row.tentativas || 0) + 1;
        const proxima = calcNextRetry(tentativas);
        await pool.query(
          `UPDATE crm_eventos_saida SET tentativas = $2, proxima_tentativa = $3, updated_at = NOW() WHERE id = $1`,
          [row.id, tentativas, proxima.toISOString()]
        );
        result.falha++;
      }
    }

    return result;
  } catch {
    return result;
  }
}

// ──────────────────────────────────────────
// disparaEventosPendentes — processa eventos em PENDENTE
// --------------------------------------------------------------------
// Eventos ficam em PENDENTE quando a config CRM estava desativada no
// momento do gatilho. Depois que o usuario ativa a config, esses
// eventos antigos nao sao retentados automaticamente — este endpoint
// disparado pela UI processa todos eles em lote.
// ──────────────────────────────────────────

export async function disparaEventosPendentes(tenantId: string): Promise<{
  processados: number;
  sucesso: number;
  falha: number;
}> {
  const result = { processados: 0, sucesso: 0, falha: 0 };
  try {
    if (!pool || !tenantId) return result;
    await initDB();

    const config = await getCrmConfig(tenantId);
    if (!config || !config.ativo || !config.webhook_url_crm) return result;
    if (config.circuit_breaker_status === 'aberto') return result;

    const { rows } = await pool.query(
      `SELECT id, tipo, tentativas, data FROM crm_eventos_saida
        WHERE status = 'PENDENTE' AND tenant_id = $1
        ORDER BY created_at ASC LIMIT 200`,
      [tenantId],
    );

    for (const row of rows) {
      result.processados++;
      const bodyStr = JSON.stringify(row.data);
      const signature = hmacSign(bodyStr, config.api_key_crm || '');
      const start = Date.now();

      try {
        const res = await fetch(config.webhook_url_crm, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-entur-event': row.tipo,
            'x-entur-signature': signature,
            'x-entur-event-id': row.id,
            'x-entur-timestamp': new Date().toISOString(),
          },
          body: bodyStr,
          signal: AbortSignal.timeout(5000),
        });

        const latencia = Date.now() - start;

        if (res.ok) {
          await pool.query(
            `UPDATE crm_eventos_saida SET status = 'ENVIADO', latencia_ms = $2, updated_at = NOW() WHERE id = $1`,
            [row.id, latencia],
          );
          result.sucesso++;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        const tentativas = (row.tentativas || 0) + 1;
        const proxima = calcNextRetry(tentativas);
        await pool.query(
          `UPDATE crm_eventos_saida SET status = 'FALHA', tentativas = $2, proxima_tentativa = $3, updated_at = NOW() WHERE id = $1`,
          [row.id, tentativas, proxima.toISOString()],
        );
        result.falha++;
      }
    }

    return result;
  } catch {
    return result;
  }
}

// ──────────────────────────────────────────
// Verify inbound HMAC signature
// ──────────────────────────────────────────

// Direct verification when the tenant is known from the request path.
export async function verificarAssinaturaCRM(
  body: string,
  signature: string,
  tenantId: string,
): Promise<boolean> {
  try {
    if (!tenantId || !signature) return false;
    const config = await getCrmConfig(tenantId);
    if (!config || !config.api_key_entur) return false;
    const expected = hmacSign(body, config.api_key_entur);
    return expected === signature;
  } catch {
    return false;
  }
}

// Reverse-lookup for the legacy tenant-less webhook URL: tries each active
// CRM config and returns the tenantId whose api_key_entur matches the
// HMAC signature. Used only as a backward-compat fallback.
export async function resolverTenantPorAssinaturaCRM(
  body: string,
  signature: string,
): Promise<string | null> {
  try {
    if (!signature) return null;
    const configs = await listarCrmConfigsAtivas();
    for (const { tenantId, config } of configs) {
      if (!config.api_key_entur) continue;
      const expected = hmacSign(body, config.api_key_entur);
      if (expected === signature) return tenantId;
    }
    return null;
  } catch {
    return null;
  }
}
