import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { podeGerenciarUsuarios } from '@/lib/permissoes';
import { registrarEventoAuditoria } from '@/lib/audit';
import { AuditFilterError, AUDIT_EXPORT_LIMIT, auditCsv, buildAuditFilter, normalizeAuditRow } from '@/lib/audit-query';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

// Somente leitura. Não exportar CRUD: ninguém pode forjar ou reescrever eventos.
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: HEADERS });
    if (!podeGerenciarUsuarios(session)) {
      return NextResponse.json({ error: 'A auditoria está disponível apenas para administradores.' }, { status: 403, headers: HEADERS });
    }
    const tenantId = session.impersonatingTenantId || session.tenantId;
    if (!tenantId) return NextResponse.json({ error: 'Agência não identificada.' }, { status: 403, headers: HEADERS });
    const params = new URL(req.url).searchParams;
    const filter = buildAuditFilter(params, tenantId);
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Auditoria temporariamente indisponível.' }, { status: 503, headers: HEADERS });

    if (params.get('format') === 'csv') {
      const result = await pool.query(
        `SELECT * FROM audit_log WHERE ${filter.where}
         ORDER BY created_at DESC, id DESC LIMIT $${filter.values.length + 1}`,
        [...filter.values, AUDIT_EXPORT_LIMIT + 1],
      );
      if (result.rows.length > AUDIT_EXPORT_LIMIT) {
        return NextResponse.json({ error: 'A exportação aceita até 50.000 registros. Reduza o período ou use mais filtros.' }, { status: 422, headers: HEADERS });
      }
      const csv = auditCsv(result.rows.map(normalizeAuditRow));
      await registrarEventoAuditoria({
        session, tenantId, acao: 'EXPORTAR', modulo: 'Configurações', entidade: 'audit_log',
        descricao: `Exportou ${result.rows.length} registros de auditoria em CSV.`,
      });
      return new Response(csv, { headers: {
        ...HEADERS, 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
      } });
    }

    // Total, página e facetas compartilham snapshot, inclusive sob novas gravações.
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const count = await client.query(`SELECT COUNT(*)::int AS total FROM audit_log WHERE ${filter.where}`, filter.values);
      const total = count.rows[0].total as number;
      const totalPages = Math.max(1, Math.ceil(total / filter.pageSize));
      const page = Math.min(filter.page, totalPages);
      const rows = await client.query(
        `SELECT * FROM audit_log WHERE ${filter.where} ORDER BY created_at DESC, id DESC
         LIMIT $${filter.values.length + 1} OFFSET $${filter.values.length + 2}`,
        [...filter.values, filter.pageSize, (page - 1) * filter.pageSize],
      );
      const facets = await client.query(`
        SELECT COALESCE(jsonb_agg(DISTINCT modulo) FILTER (WHERE modulo <> ''), '[]') AS modulos,
               COALESCE(jsonb_agg(DISTINCT acao) FILTER (WHERE acao <> ''), '[]') AS acoes,
               COALESCE(jsonb_agg(DISTINCT COALESCE(data->>'origem', 'SISTEMA')), '[]') AS origens
        FROM audit_log WHERE tenant_id = $1`, [tenantId]);
      const users = await client.query(`
        SELECT DISTINCT ON (usuario_id) usuario_id AS id,
          COALESCE(NULLIF(data->>'usuario_nome', ''), 'Sistema') AS nome
        FROM audit_log WHERE tenant_id = $1 AND usuario_id <> ''
        ORDER BY usuario_id, created_at DESC, audit_log.id DESC`, [tenantId]);
      const coverage = await client.query(`SELECT created_at, data FROM audit_config WHERE id = 'capture-v1'`);
      await client.query('COMMIT');
      return NextResponse.json({
        items: rows.rows.map(normalizeAuditRow), total, page, pageSize: filter.pageSize, totalPages,
        facets: { ...facets.rows[0], usuarios: users.rows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) },
        coverage: { startedAt: coverage.rows[0]?.created_at || null, tables: coverage.rows[0]?.data?.tables?.length || 0 },
      }, { headers: HEADERS });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof AuditFilterError) return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
    console.error('[auditoria] Falha ao consultar histórico:', error instanceof Error ? error.name : 'Erro');
    return NextResponse.json({ error: 'Não foi possível consultar a auditoria. Tente novamente.' }, { status: 500, headers: HEADERS });
  }
}
