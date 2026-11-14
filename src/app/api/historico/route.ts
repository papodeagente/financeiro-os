import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro, podeGerenciarUsuarios } from '@/lib/permissoes';
import { contasPermitidas, pode } from '@/lib/permissoes-servidor';
import { normalizeAuditRow } from '@/lib/audit-query';
import { STATUS_DE_BAIXA } from '@/lib/guarda-baixa';
import {
  entidadeDoHistorico, eventosDoHistorico, referenciasCitadas, type NomesDeReferencia,
} from '@/lib/historico-do-registro';
import { recusaModulo } from '@/lib/guarda-rota';

/**
 * Aba Histórico de um título ou cadastro (06/11/2026, E7). Somente leitura:
 * o registro de atividades (audit_log) filtrado por agência + tabela + id,
 * traduzido para a tela (historico-do-registro.ts).
 *
 *   GET /api/historico?entidade=contas_pagar&id=<id>&pagina=1
 *
 * Quem vê: tabelas do financeiro pedem "Acessar o financeiro" (e a conta
 * bancária liberada, quando a pessoa tem contas restritas); clientes e
 * fornecedores seguem a regra do Registro de atividades (administrador).
 */
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };
const POR_PAGINA = 50;
/** Um registro só: o histórico inteiro dele cabe aqui com folga. */
const LIMITE_DE_EVENTOS = 2000;

const resposta = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: HEADERS });

export async function GET(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    const sessao = await getSession();
    if (!sessao) return resposta({ error: 'Sessão necessária.' }, 401);
    const params = new URL(req.url).searchParams;
    const entidade = (params.get('entidade') ?? '').trim();
    const id = (params.get('id') ?? '').trim();
    const ent = entidadeDoHistorico(entidade);
    if (!ent) return resposta({ error: 'Este tipo de registro não tem histórico.' }, 400);
    if (!id || id.length > 200) return resposta({ error: 'Registro inválido.' }, 400);
    const paginaTxt = params.get('pagina') ?? '1';
    if (!/^\d{1,6}$/.test(paginaTxt) || Number(paginaTxt) < 1) return resposta({ error: 'Página inválida.' }, 400);

    if (ent.grupo === 'financeiro') {
      const bloqueio = bloqueioFinanceiro(sessao, 'ler');
      if (bloqueio) return resposta({ error: bloqueio.erro }, bloqueio.status);
      if (!(await pode(sessao, 'ver_financeiro'))) return resposta({ error: 'Seu perfil de acesso não inclui isto no financeiro.' }, 403);
    } else if (!podeGerenciarUsuarios(sessao)) {
      return resposta({ error: 'O histórico deste cadastro está disponível para administradores, como o Registro de atividades.' }, 403);
    }

    const tenantId = sessao.impersonatingTenantId || sessao.tenantId;
    if (!tenantId) return resposta({ error: 'Agência não identificada.' }, 403);
    await initDB();
    if (!pool) return resposta({ error: 'Histórico temporariamente indisponível.' }, 503);

    // Conta bancária não liberada para a pessoa: o histórico dela (e o dos
    // títulos já baixados nela) também não aparece. Mesma regra das listas.
    const contas = await contasPermitidas(sessao);
    if (contas !== null && !(await liberado(entidade, id, tenantId, contas))) {
      return resposta({ error: 'Registro não encontrado.' }, 404);
    }

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE tenant_id = $1 AND entidade = $2 AND entidade_id = $3
        ORDER BY created_at DESC, id DESC LIMIT $4`,
      [tenantId, entidade, id, LIMITE_DE_EVENTOS],
    );
    const logs = rows.map(normalizeAuditRow);
    const nomes = await nomesDasReferencias(tenantId, referenciasCitadas(entidade, logs));
    const eventos = eventosDoHistorico(entidade, logs, nomes);
    const total = eventos.length;
    const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const pagina = Math.min(Number(paginaTxt), totalPaginas);
    return resposta({
      entidade, id, nome: ent.nome,
      eventos: eventos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA),
      total, pagina, total_paginas: totalPaginas,
    });
  } catch (e) {
    console.error('[historico] falha ao ler:', e instanceof Error ? e.message : e);
    return resposta({ error: 'Não foi possível carregar o histórico. Tente de novo.' }, 500);
  }
}

/** O registro está numa conta bancária liberada para a pessoa? */
async function liberado(entidade: string, id: string, tenantId: string, contas: readonly string[]): Promise<boolean> {
  if (!pool) return false;
  if (entidade === 'contas_bancarias') return contas.includes(id);
  if (entidade !== 'contas_pagar' && entidade !== 'contas_receber') return true;
  // O título pode estar ativo ou na lista de excluídas.
  let { rows } = await pool.query(`SELECT data FROM ${entidade} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (rows.length === 0) {
    const { rows: existe } = await pool.query(`SELECT to_regclass('public.contas_excluidas') IS NOT NULL AS ok`);
    if (existe[0]?.ok === true) {
      ({ rows } = await pool.query(
        `SELECT data FROM contas_excluidas WHERE tenant_id = $1 AND tabela = $2 AND id = $3`, [tenantId, entidade, id]));
    }
  }
  const d = (rows[0]?.data ?? null) as Record<string, unknown> | null;
  if (!d) return true;
  if (!STATUS_DE_BAIXA.includes(String(d.status ?? ''))) return true;
  const conta = typeof d.conta_bancaria_id === 'string' ? d.conta_bancaria_id : '';
  return conta === '' || contas.includes(conta);
}

/** Troca os ids de categoria, centro e conta pelos nomes (só da agência). */
async function nomesDasReferencias(
  tenantId: string, refs: { categoria: string[]; centro: string[]; conta: string[] },
): Promise<NomesDeReferencia> {
  const nomes = new Map<string, string>();
  if (!pool) return nomes;
  const ler = async (tipo: string, sql: string, ids: string[]) => {
    if (!ids.length) return;
    try {
      const { rows } = await pool!.query(sql, [tenantId, ids.slice(0, 200)]);
      for (const r of rows) if (r.nome) nomes.set(`${tipo}:${r.id}`, String(r.nome));
    } catch { /* tabela ausente: o nome fica "cadastro removido" */ }
  };
  await ler('categoria',
    `SELECT id, TRIM(concat_ws(' · ', NULLIF(COALESCE(NULLIF(data->>'codigo', ''), codigo), ''), COALESCE(NULLIF(data->>'nome', ''), descricao))) AS nome
       FROM plano_contas WHERE tenant_id = $1 AND id = ANY($2::text[])`, refs.categoria);
  await ler('centro',
    `SELECT id, COALESCE(NULLIF(nome, ''), data->>'nome') AS nome FROM centros_custo WHERE tenant_id = $1 AND id = ANY($2::text[])`, refs.centro);
  await ler('conta',
    `SELECT id, COALESCE(NULLIF(data->>'nome', ''), nome) AS nome FROM contas_bancarias WHERE tenant_id = $1 AND id = ANY($2::text[])`, refs.conta);
  return nomes;
}
