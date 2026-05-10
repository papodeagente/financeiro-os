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
// published or updated. Pulls dates, destinations, images and the full
// price tree (avista/cartao/boleto by SGL/DBL/TPL/QDP/CHD) from the
// product calculator so the CRM can attach it to a deal.
export function buildProdutoPayload(grupo: GrupoViagem): Record<string, unknown> {
  const summary = getProdutoGrupo(grupo);

  // Pick the first hotel image we find — used as the product cover.
  const imagem = grupo.htl?.hoteis?.[0]?.info?.hotel_imagem || null;

  // Distinct list of destinations across all periods.
  const destinos = Array.from(
    new Set((grupo.periodos || []).map(p => p.destino).filter(Boolean)),
  );

  // Hotels named in the periods.
  const hoteis = Array.from(
    new Set((grupo.periodos || []).map(p => p.hotel).filter(Boolean)),
  );

  // Trip duration in nights (last_check_out - first_check_in).
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
    grupo_id: grupo.id,
    grp_id: grupo.grp_id,
    nome: grupo.origem_destino,
    descricao: grupo.descricao_orcamento || '',
    imagem,
    status_pipeline: grupo.status_pipeline,

    // Trip facts
    destinos,
    hoteis,
    data_inicio: summary.datas.primeira_partida,
    data_fim: summary.datas.ultimo_retorno,
    duracao_noites,
    qtd_min_pax: summary.qtd_min_pax,
    qtd_max_pax: summary.qtd_max_pax,

    // Pricing — full breakdown by tariff (SGL/DBL/TPL/QDP/CHD) and
    // payment form (avista/cartao/boleto). Per-apto and per-pax.
    tarifas_ativas: grupo.tarifas_ativas,
    precos: summary.precos,
    precos_por_pax: summary.precos_por_pax,
    parcelas_apto: summary.parcelas_apto,

    // Cost breakdown by service line (TKT/HTL/REC/CAR/...). Useful for
    // the CRM to display where the price comes from.
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

export function buildContaReceberFromParcela(
  parcela: Record<string, unknown>,
  ctx: VendaContext,
  parcelaIndex: number,
  totalParcelas: number,
): ContaReceber {
  const parcelaNumero = Number(parcela.parcela) || (parcelaIndex + 1);
  const valor = asNum(parcela.valor);
  const descricao = totalParcelas > 1
    ? `Parcela ${parcelaNumero}/${totalParcelas} — Venda ${ctx.crmVendaId || ctx.vendaId}`
    : `Venda ${ctx.crmVendaId || ctx.vendaId}`;

  return {
    ...createContaReceber(),
    id: generateId(),
    origem: 'VENDA',
    venda_id: ctx.vendaId,
    grupo_id: ctx.enturGrupoId || null,
    cliente_id: ctx.clienteId,
    cliente_nome: ctx.clienteNome,
    descricao,
    valor_original: valor,
    valor_final: valor,
    data_vencimento: asDateYMD(parcela.vencimento),
    forma_recebimento: mapFormaRecebimento(asStr(parcela.forma_pagamento)),
    parcela_numero: parcelaNumero,
    total_parcelas: totalParcelas,
    status: 'PENDENTE',
    auto_gerado: true,
    origem_venda_id: ctx.vendaId,
    observacoes: ctx.crmVendaId
      ? `Importado do CRM (venda ${ctx.crmVendaId})`
      : 'Importado do CRM',
  };
}

export function buildContaPagarFromFornecedor(
  forn: Record<string, unknown>,
  fornecedorId: string,
  ctx: VendaContext,
): ContaPagar {
  const fornecedorNome = asStr(forn.fornecedor_nome);
  const valorCusto = asNum(forn.valor_custo);
  const servico = asStr(forn.servico);
  const descricao = servico
    ? `${servico} — ${fornecedorNome || 'Fornecedor'}`
    : `${fornecedorNome || 'Fornecedor'} — Venda ${ctx.crmVendaId || ctx.vendaId}`;

  return {
    ...createContaPagar(),
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
      ? `Importado do CRM (venda ${ctx.crmVendaId})`
      : 'Importado do CRM',
  };
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

async function upsertFornecedorByExternalId(
  externalId: string,
  dados: { nome?: unknown },
  tenantId: string,
): Promise<string> {
  if (!pool || !externalId) throw new Error('upsertFornecedor: external_id obrigatorio');

  const { rows } = await pool.query(
    `SELECT id FROM fornecedores_crm WHERE external_id = $1 AND tenant_id = $2 LIMIT 1`,
    [externalId, tenantId],
  );
  if (rows.length > 0) return rows[0].id as string;

  const id = generateId();
  const nome = asStr(dados.nome);
  const data = {
    id,
    nome_fantasia: nome,
    razao_social: nome,
    cnpj: '',
    categoria: '',
    origem: 'crm',
    external_id: externalId,
  };
  await pool.query(
    `INSERT INTO fornecedores_crm (id, nome_fantasia, cnpj, categoria, data, external_id, tenant_id, created_at, updated_at)
     VALUES ($1, $2, '', '', $3, $4, $5, NOW(), NOW())`,
    [id, nome, JSON.stringify(data), externalId, tenantId],
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

        const vendaId = generateId();
        const vendaData = {
          id: vendaId,
          cliente_id: clienteId,
          cliente_external_id: clienteExternalId,
          vendedor_id: vendedorId,
          vendedor_external_id: vendedorExternalId,
          grupo_id: payload.entur_grupo_id || '',
          proposta_id: payload.entur_proposta_id || '',
          crm_venda_id: payload.crm_venda_id || '',
          valor_total: valorTotal,
          custo_total: custoTotal,
          rentabilidade,
          margem_percentual: margemPercentual,
          comissao,
          moeda: payload.moeda || 'BRL',
          status: 'vendido',
          origem: 'crm',
          data_venda: new Date().toISOString(),
        };
        await pool.query(
          `INSERT INTO vendas_crm (id, cliente_id, vendedor_id, status, data, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, 'vendido', $4, $5, NOW(), NOW())`,
          [vendaId, clienteId, vendedorId, JSON.stringify(vendaData), tenantId]
        );

        // 3) Create contas_receber and contas_pagar. JSONB shape must
        //    match what the UI renders — uses the shared builders so any
        //    schema change here is captured by the unit tests.
        const ctx: VendaContext = {
          vendaId,
          clienteId,
          clienteNome: asStr(payload.cliente_nome),
          enturGrupoId: asStr(payload.entur_grupo_id),
          crmVendaId: asStr(payload.crm_venda_id),
        };

        const parcelas = (payload.condicoes_pagamento as Array<Record<string, unknown>>) || [];
        const totalParcelas = parcelas.length || 1;

        for (let i = 0; i < parcelas.length; i++) {
          const conta = buildContaReceberFromParcela(parcelas[i], ctx, i, totalParcelas);
          await pool.query(
            `INSERT INTO contas_receber (id, venda_id, cliente_id, status, data, tenant_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())`,
            [conta.id, vendaId, clienteId, conta.status, JSON.stringify(conta), tenantId],
          );
        }

        const fornecedores = (payload.fornecedores as Array<Record<string, unknown>>) || [];
        for (const forn of fornecedores) {
          const fornExternalId = asStr(forn.fornecedor_id);
          if (!fornExternalId) continue;
          const fornecedorId = await upsertFornecedorByExternalId(
            fornExternalId,
            { nome: forn.fornecedor_nome },
            tenantId,
          );
          const conta = buildContaPagarFromFornecedor(forn, fornecedorId, ctx);
          await pool.query(
            `INSERT INTO contas_pagar (id, fornecedor_id, status, data, tenant_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW())`,
            [conta.id, fornecedorId, conta.status, JSON.stringify(conta), tenantId],
          );
        }
        acao = `venda criada (${vendaId}), cliente ${clienteId}, ${parcelas.length} receber, ${fornecedores.length} pagar`;
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
