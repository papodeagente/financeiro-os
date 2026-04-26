import pool from './db';
import { generateId } from './utils';

export type TipoNotificacao =
  | 'PROPOSTA_ACEITA'
  | 'PROPOSTA_FEEDBACK'
  | 'PROPOSTA_VISUALIZADA'
  | 'PROPOSTA_LEAD';

export interface Notificacao {
  id: string;
  tenant_id: string;
  tipo: TipoNotificacao;
  titulo: string;
  descricao: string;
  link: string;
  vendedor_id: string;
  lida: boolean;
  data: Record<string, unknown>;
  created_at: string;
}

interface CriarNotificacaoInput {
  tenantId: string;
  tipo: TipoNotificacao;
  titulo: string;
  descricao?: string;
  link?: string;
  vendedorId?: string;
  data?: Record<string, unknown>;
}

export async function criarNotificacao(input: CriarNotificacaoInput): Promise<void> {
  if (!pool || !input.tenantId) return;
  try {
    await pool.query(
      `INSERT INTO notificacoes (id, tenant_id, tipo, titulo, descricao, link, vendedor_id, lida, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8::jsonb)`,
      [
        generateId(),
        input.tenantId,
        input.tipo,
        input.titulo,
        input.descricao || '',
        input.link || '',
        input.vendedorId || '',
        JSON.stringify(input.data || {}),
      ],
    );
  } catch (e) {
    console.error('[notificacoes] failed to insert', e);
  }
}

export async function listarNotificacoes(
  tenantId: string,
  opts: { apenasNaoLidas?: boolean; limit?: number } = {},
): Promise<Notificacao[]> {
  if (!pool) return [];
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const where = opts.apenasNaoLidas ? 'AND lida = FALSE' : '';
  const { rows } = await pool.query(
    `SELECT id, tenant_id, tipo, titulo, descricao, link, vendedor_id, lida, data, created_at
       FROM notificacoes
      WHERE tenant_id = $1 ${where}
      ORDER BY created_at DESC
      LIMIT $2`,
    [tenantId, limit],
  );
  return rows.map(r => ({
    id: r.id,
    tenant_id: r.tenant_id,
    tipo: r.tipo,
    titulo: r.titulo,
    descricao: r.descricao,
    link: r.link,
    vendedor_id: r.vendedor_id,
    lida: r.lida,
    data: r.data || {},
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
}

export async function contarNaoLidas(tenantId: string): Promise<number> {
  if (!pool) return 0;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM notificacoes WHERE tenant_id = $1 AND lida = FALSE`,
    [tenantId],
  );
  return rows[0]?.c ?? 0;
}

export async function marcarComoLida(tenantId: string, id: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE notificacoes SET lida = TRUE WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
}

export async function marcarTodasComoLidas(tenantId: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE notificacoes SET lida = TRUE WHERE tenant_id = $1 AND lida = FALSE`,
    [tenantId],
  );
}
