/**
 * O lado do banco da comissão por MRR (regras em comissao-mrr.ts).
 *
 * Toda leitura e toda escrita é por empresa, e as rotas só chegam aqui depois
 * de exigirEcossistema (perfil-da-conta.ts).
 */
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { round2 } from './money';
import { sincronizarContaDaComissao } from './comissao-conta';
import type { ComissaoVenda } from './crm-types';
import {
  apurarComissaoMrr, copiarMetas, decidirComissaoMrr, idDaComissaoMrr, linhaDaComissaoMrr, validarFaixas, validarMeta,
  type ApuracaoMrr, type MetaMrr, type PlanoComFaixasDeMrr, type VendedorDoFinanceiro,
} from './comissao-mrr';
import type { VendaMrr } from './mrr-vendido';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

function lerMeta(r: Record<string, unknown>): MetaMrr {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const valores: Record<string, number> = {};
  for (const [k, v] of Object.entries((d.valores ?? {}) as Record<string, unknown>)) {
    const n = Number(v);
    if (k && Number.isFinite(n) && n >= 0) valores[k] = round2(n);
  }
  return {
    id: String(r.id),
    mes: String(r.mes ?? d.mes ?? ''),
    nome: String(d.nome ?? ''),
    produtos: Array.isArray(d.produtos) ? (d.produtos as unknown[]).map(String).filter(Boolean) : [],
    produtos_nomes: (d.produtos_nomes && typeof d.produtos_nomes === 'object' ? d.produtos_nomes : {}) as Record<string, string>,
    valores,
  };
}

export async function listarMetasMrr(exec: ExecutorSQL, tenantId: string, mes: string): Promise<MetaMrr[]> {
  if (!MES.test(mes)) return [];
  const { rows } = await exec.query(
    `SELECT id, mes, data FROM metas_mrr WHERE tenant_id = $1 AND mes = $2 ORDER BY created_at ASC, id ASC`,
    [tenantId, mes],
  );
  return rows.map(lerMeta);
}

export interface EntradaDeMeta {
  id?: unknown;
  mes: unknown;
  nome: unknown;
  produtos: unknown;
  produtos_nomes?: unknown;
  valores?: unknown;
}

/** Grava (cria ou edita) uma meta. Devolve a meta gravada, ou a mensagem do que impediu. */
export async function gravarMetaMrr(exec: ExecutorSQL, tenantId: string, e: EntradaDeMeta): Promise<{ ok: true; meta: MetaMrr } | { ok: false; erro: string }> {
  const valores: Record<string, number> = {};
  for (const [k, v] of Object.entries((e.valores && typeof e.valores === 'object' ? e.valores : {}) as Record<string, unknown>)) {
    if (v === '' || v === null || v === undefined) continue;
    valores[k] = Number(v);
  }
  const nomes: Record<string, string> = {};
  for (const [k, v] of Object.entries((e.produtos_nomes && typeof e.produtos_nomes === 'object' ? e.produtos_nomes : {}) as Record<string, unknown>)) {
    if (typeof v === 'string') nomes[k] = v.slice(0, 120);
  }
  const produtos = [...new Set(Array.isArray(e.produtos) ? (e.produtos as unknown[]).map(String).filter(Boolean) : [])];
  const meta: MetaMrr = {
    id: typeof e.id === 'string' && e.id ? e.id : `meta-mrr-${generateId()}`,
    mes: String(e.mes ?? ''),
    nome: String(e.nome ?? '').trim().slice(0, 80),
    produtos,
    produtos_nomes: Object.fromEntries(produtos.map(p => [p, nomes[p] ?? p])),
    valores,
  };
  // A meta que já existe só pode ser editada pela empresa dona dela.
  const { rows: existente } = await exec.query(`SELECT tenant_id FROM metas_mrr WHERE id = $1`, [meta.id]);
  if (existente.length && existente[0].tenant_id !== tenantId) return { ok: false, erro: 'Meta não encontrada.' };
  const outras = (await listarMetasMrr(exec, tenantId, meta.mes)).filter(m => m.id !== meta.id);
  const erro = validarMeta(meta, outras);
  if (erro) return { ok: false, erro };
  // Vendedor que não é desta empresa não entra na meta.
  if (Object.keys(valores).length) {
    const { rows } = await exec.query(`SELECT id FROM usuarios WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, Object.keys(valores)]);
    const daEmpresa = new Set(rows.map(r => String(r.id)));
    for (const k of Object.keys(meta.valores)) if (!daEmpresa.has(k)) delete meta.valores[k];
  }
  const { id, mes, ...data } = meta;
  await exec.query(
    `INSERT INTO metas_mrr (id, tenant_id, mes, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, mes = EXCLUDED.mes, updated_at = NOW()
     WHERE metas_mrr.tenant_id = EXCLUDED.tenant_id`,
    [id, tenantId, mes, JSON.stringify(data)],
  );
  return { ok: true, meta };
}

export async function apagarMetaMrr(exec: ExecutorSQL, tenantId: string, id: string): Promise<boolean> {
  const { rows } = await exec.query(`DELETE FROM metas_mrr WHERE id = $1 AND tenant_id = $2 RETURNING id`, [id, tenantId]);
  return rows.length > 0;
}

/** Copia as metas de `de` para `para`, se `para` ainda não tem nenhuma. */
export async function copiarMetasDoMes(exec: ExecutorSQL, tenantId: string, de: string, para: string): Promise<{ ok: true; copiadas: number } | { ok: false; erro: string }> {
  if (!MES.test(de) || !MES.test(para)) return { ok: false, erro: 'Mês de referência inválido.' };
  if ((await listarMetasMrr(exec, tenantId, para)).length) return { ok: false, erro: 'Este mês já tem metas: edite as que existem.' };
  const origem = await listarMetasMrr(exec, tenantId, de);
  if (!origem.length) return { ok: false, erro: 'O mês anterior não tem metas para copiar.' };
  for (const m of copiarMetas(origem, para, () => `meta-mrr-${generateId()}`)) {
    const r = await gravarMetaMrr(exec, tenantId, m);
    if (!r.ok) return r;
  }
  return { ok: true, copiadas: origem.length };
}

export async function lerVendedores(exec: ExecutorSQL, tenantId: string): Promise<VendedorDoFinanceiro[]> {
  const { rows } = await exec.query(`SELECT id, nome, email, external_id, data FROM usuarios WHERE tenant_id = $1`, [tenantId]);
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      nome: String(r.nome || d.nome || ''),
      email: String(r.email || d.email || '').toLowerCase(),
      external_id: String(r.external_id ?? d.external_id ?? ''),
      plano_comissao_id: String(d.plano_comissao_id ?? ''),
    };
  });
}

export async function lerPlanos(exec: ExecutorSQL, tenantId: string): Promise<PlanoComFaixasDeMrr[]> {
  const { rows } = await exec.query(`SELECT id, nome, data FROM planos_comissao WHERE tenant_id = $1`, [tenantId]);
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return { id: String(r.id), nome: String(r.nome || d.nome || ''), ativo: d.ativo !== false, mrr: (d.mrr ?? null) as PlanoComFaixasDeMrr['mrr'] };
  });
}

export async function apurarMes(exec: ExecutorSQL, tenantId: string, mes: string, vendas: readonly VendaMrr[]): Promise<ApuracaoMrr> {
  const [metas, vendedores, planos] = await Promise.all([listarMetasMrr(exec, tenantId, mes), lerVendedores(exec, tenantId), lerPlanos(exec, tenantId)]);
  return apurarComissaoMrr({ mes, metas, vendas, vendedores, planos });
}

export interface ResultadoDaGeracao {
  gravadas: number;
  canceladas: number;
  sem_mudanca: number;
  avisos: string[];
}

/**
 * Grava a comissão de MRR do mês de cada vendedor (uma linha por vendedor e
 * mês) e programa a conta a pagar pelo mesmo gancho de toda comissão.
 * Linha já aprovada ou paga não é reescrita (decidirComissaoMrr).
 */
export async function gerarComissoesMrr(
  exec: ExecutorSQL,
  tenantId: string,
  apuracao: ApuracaoMrr,
  hoje?: string,
): Promise<ResultadoDaGeracao> {
  const out: ResultadoDaGeracao = { gravadas: 0, canceladas: 0, sem_mudanca: 0, avisos: [] };
  const ids = apuracao.vendedores.map(v => idDaComissaoMrr(v.vendedor_id, apuracao.mes));
  // Quem tinha comissão gravada no mês e saiu da apuração (sem venda e sem meta) também precisa ser decidido.
  const { rows } = await exec.query(
    `SELECT id, vendedor_id, status, data FROM comissoes
      WHERE tenant_id = $1 AND (id = ANY($2::text[]) OR (data->>'origem' = 'mrr' AND data->'mrr'->>'mes' = $3))`,
    [tenantId, ids, apuracao.mes],
  );
  const gravadas = new Map(rows.map(r => [String(r.id), r]));

  const decidir = async (linha: ReturnType<typeof linhaDaComissaoMrr>) => {
    const atual = gravadas.get(linha.id);
    const existente = atual ? { status: String(atual.status), valor_comissao: Number((atual.data as Record<string, unknown>)?.valor_comissao) || 0 } : null;
    const decisao = decidirComissaoMrr(existente, linha);
    if (decisao.acao === 'nada') { if (existente) out.sem_mudanca++; return; }
    if (decisao.acao === 'manter') { out.avisos.push(decisao.motivo); return; }
    const anterior = (atual?.data ?? {}) as Partial<ComissaoVenda>;
    const gravar: ComissaoVenda = decisao.acao === 'cancelar'
      ? { ...(anterior as ComissaoVenda), status: 'CANCELADA', observacoes: `${anterior.observacoes ? `${anterior.observacoes} | ` : ''}Cancelada: sem comissão de MRR no recálculo.` }
      : { ...decisao.linha, observacoes: decisao.linha.observacoes };
    await exec.query(
      `INSERT INTO comissoes (id, tenant_id, venda_id, vendedor_id, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, venda_id = EXCLUDED.venda_id,
         vendedor_id = EXCLUDED.vendedor_id, updated_at = NOW()
       WHERE comissoes.tenant_id = EXCLUDED.tenant_id`,
      [gravar.id, tenantId, gravar.venda_id, gravar.vendedor_id, gravar.status, JSON.stringify(gravar)],
    );
    await sincronizarContaDaComissao(tenantId, gravar, exec, hoje);
    if (decisao.acao === 'cancelar') out.canceladas++;
    else out.gravadas++;
  };

  for (const v of apuracao.vendedores) await decidir(linhaDaComissaoMrr(v, apuracao.mes));
  // Vendedor que tinha comissão no mês e não aparece mais: a linha vale zero.
  const naApuracao = new Set(ids);
  for (const [id, r] of gravadas) {
    if (naApuracao.has(id)) continue;
    const d = (r.data ?? {}) as Record<string, unknown>;
    await decidir(linhaDaComissaoMrr({
      vendedor_id: String(r.vendedor_id), nome: String(d.vendedor_nome ?? ''), plano_id: String(d.plano_comissao_id ?? ''),
      plano_nome: String(d.plano_nome ?? ''), metas: [], mrr_nas_metas: 0, comissao: 0, pendencias: [],
    }, apuracao.mes));
  }
  for (const v of apuracao.vendedores) for (const p of v.pendencias) out.avisos.push(`${v.nome}: ${p}`);
  return out;
}

/** O que a tela de planos precisa para ligar as faixas: o erro, ou null. */
export function erroNasFaixas(bruto: unknown): string | null {
  return validarFaixas(bruto);
}
