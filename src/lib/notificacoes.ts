import type { PoolClient } from 'pg';
import pool from './db';
import { generateId } from './utils';
import { podeVerTodasVendas } from './permissoes';
import type { SessionPayload } from './auth';
import {
  PREFERENCIAS_NOTIFICACOES_PADRAO, TIPOS_NOTIFICACAO, normalizarPreferencias,
  type PreferenciasNotificacoes, type TipoNotificacao,
} from './notificacoes-config';

export type { TipoNotificacao } from './notificacoes-config';

export interface Notificacao {
  id: string; tipo: TipoNotificacao; titulo: string; descricao: string;
  link: string; lida: boolean; created_at: string;
}

export interface CriarNotificacaoInput {
  tenantId: string; tipo: TipoNotificacao; titulo: string; descricao?: string;
  link?: string; vendedorId?: string; data?: Record<string, unknown>;
  chaveDeduplicacao?: string;
}

type Executor = Pick<PoolClient, 'query'>;

const safeLocalLink = (link?: string) => {
  const value = (link || '').trim();
  if (!value || !value.startsWith('/') || value.startsWith('//')
    || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '';
  return value.slice(0, 1_000);
};

export async function criarNotificacao(input: CriarNotificacaoInput): Promise<void> {
  if (!pool || !input.tenantId || !TIPOS_NOTIFICACAO.some(item => item.tipo === input.tipo)) return;
  try {
    const key = input.chaveDeduplicacao?.trim().slice(0, 500) || null;
    await pool.query(
      `INSERT INTO notificacoes
         (id, tenant_id, tipo, titulo, descricao, link, vendedor_id, lida, data, chave_deduplicacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8::jsonb, $9)
       ON CONFLICT (tenant_id, chave_deduplicacao)
         WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> ''
       DO NOTHING`,
      [generateId(), input.tenantId, input.tipo, input.titulo.trim().slice(0, 300),
        (input.descricao || '').trim().slice(0, 2_000), safeLocalLink(input.link),
        input.vendedorId || '', JSON.stringify(input.data || {}), key],
    );
  } catch (error) {
    console.error('[notificacoes] Falha ao criar notificação:', error instanceof Error ? error.name : 'Erro');
  }
}

interface EscopoNotificacoes {
  tenantId: string; usuarioId: string; todos: boolean; vendedorIds: string[];
}

async function resolverEscopo(session: SessionPayload, executor: Executor): Promise<EscopoNotificacoes> {
  const tenantId = session.impersonatingTenantId || session.tenantId;
  const vendedorIds = new Set([session.userId].filter(Boolean));
  if (!podeVerTodasVendas(session)) {
    const { rows } = await executor.query(
      `SELECT data FROM usuarios WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, tenantId],
    );
    const user = rows[0]?.data as Record<string, unknown> | undefined;
    if (typeof user?.membro_id === 'string' && user.membro_id) vendedorIds.add(user.membro_id);
    if (Array.isArray(user?.membro_ids_legado)) {
      for (const id of user.membro_ids_legado) if (typeof id === 'string' && id) vendedorIds.add(id);
    }
  }
  return { tenantId, usuarioId: session.userId, todos: podeVerTodasVendas(session), vendedorIds: [...vendedorIds] };
}

const VISIBILIDADE = `n.tenant_id = $1 AND ($4::boolean OR (
  n.tipo <> 'VENDA_VENDEDOR_NAO_CADASTRADO' AND
  CASE
    WHEN COALESCE(n.data->>'proposta_id', '') <> '' AND EXISTS (
      SELECT 1 FROM propostas objeto WHERE objeto.id = n.data->>'proposta_id' AND objeto.tenant_id = n.tenant_id
    ) THEN EXISTS (
      SELECT 1 FROM propostas objeto WHERE objeto.id = n.data->>'proposta_id'
        AND objeto.tenant_id = n.tenant_id AND objeto.vendedor_id = ANY($3::text[])
    )
    WHEN COALESCE(n.data->>'venda_id', '') <> '' AND EXISTS (
      SELECT 1 FROM vendas_crm objeto WHERE objeto.id = n.data->>'venda_id' AND objeto.tenant_id = n.tenant_id
    ) THEN EXISTS (
      SELECT 1 FROM vendas_crm objeto WHERE objeto.id = n.data->>'venda_id'
        AND objeto.tenant_id = n.tenant_id AND objeto.vendedor_id = ANY($3::text[])
    )
    ELSE n.vendedor_id <> '' AND n.vendedor_id = ANY($3::text[])
  END
))`;

const baseParams = (scope: EscopoNotificacoes) => [scope.tenantId, scope.usuarioId, scope.vendedorIds, scope.todos];

export async function obterPreferencias(executor: Executor, tenantId: string, usuarioId: string) {
  const { rows } = await executor.query(
    `SELECT data FROM notificacoes_preferencias WHERE tenant_id = $1 AND usuario_id = $2 LIMIT 1`,
    [tenantId, usuarioId],
  );
  return rows.length ? normalizarPreferencias(rows[0].data) : structuredClone(PREFERENCIAS_NOTIFICACOES_PADRAO);
}

export async function carregarPreferencias(session: SessionPayload): Promise<PreferenciasNotificacoes> {
  if (!pool) throw new Error('DB_UNAVAILABLE');
  return obterPreferencias(pool as unknown as Executor,
    session.impersonatingTenantId || session.tenantId, session.userId);
}

export async function salvarPreferencias(session: SessionPayload, preferences: PreferenciasNotificacoes) {
  if (!pool) throw new Error('DB_UNAVAILABLE');
  const tenantId = session.impersonatingTenantId || session.tenantId;
  await pool.query(
    `INSERT INTO notificacoes_preferencias (id, tenant_id, usuario_id, data)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant_id, usuario_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [generateId(), tenantId, session.userId, JSON.stringify(preferences)],
  );
  return preferences;
}

export async function consultarNotificacoes(session: SessionPayload, options: {
  page: number; limit: number; apenasNaoLidas: boolean; tipo?: TipoNotificacao;
}) {
  if (!pool) throw new Error('DB_UNAVAILABLE');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const scope = await resolverEscopo(session, client);
    const preferences = await obterPreferencias(client, scope.tenantId, scope.usuarioId);
    const enabledTypes = TIPOS_NOTIFICACAO.filter(item => preferences.tipos[item.tipo]).map(item => item.tipo);
    const params: unknown[] = [...baseParams(scope), enabledTypes];
    const clauses = [VISIBILIDADE, 'n.tipo = ANY($5::text[])'];
    if (options.tipo) {
      params.push(options.tipo);
      clauses.push(`n.tipo = $${params.length}`);
    }
    if (options.apenasNaoLidas) clauses.push('COALESCE(leitura.lida, n.lida) = FALSE');
    const where = clauses.join(' AND ');
    const joins = `LEFT JOIN notificacoes_leituras leitura
      ON leitura.tenant_id = n.tenant_id AND leitura.usuario_id = $2 AND leitura.notificacao_id = n.id`;
    const totalResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM notificacoes n ${joins} WHERE ${where}`,
      params,
    );
    const total = Number(totalResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / options.limit));
    const page = Math.min(options.page, totalPages);
    const { rows } = await client.query(
      `SELECT n.id, n.tipo, n.titulo, n.descricao, n.link,
              COALESCE(leitura.lida, n.lida) AS lida, n.created_at
         FROM notificacoes n ${joins} WHERE ${where}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, options.limit, (page - 1) * options.limit],
    );
    const unreadResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM notificacoes n ${joins}
        WHERE ${VISIBILIDADE} AND n.tipo = ANY($5::text[])
          AND COALESCE(leitura.lida, n.lida) = FALSE`,
      [...baseParams(scope), enabledTypes],
    );
    await client.query('COMMIT');
    return {
      items: rows.map(row => ({
        id: String(row.id), tipo: row.tipo as TipoNotificacao, titulo: String(row.titulo || ''),
        descricao: String(row.descricao || ''), link: safeLocalLink(String(row.link || '')),
        lida: Boolean(row.lida),
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      })),
      // A preferência decide apenas se a interface exibe o selo no sino.
      // O total real continua disponível para o cabeçalho e para a ação
      // "marcar todas", que não podem afirmar "tudo em dia" incorretamente.
      unread: Number(unreadResult.rows[0]?.total || 0),
      total, page, totalPages, preferences,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function marcarComoLida(
  session: SessionPayload, notificationId: string, lida: boolean,
): Promise<boolean> {
  if (!pool) throw new Error('DB_UNAVAILABLE');
  const scope = await resolverEscopo(session, pool as unknown as Executor);
  const result = await pool.query(
    `INSERT INTO notificacoes_leituras (id, tenant_id, usuario_id, notificacao_id, lida)
     SELECT 'nl_' || gen_random_uuid()::text, $1, $2, n.id, $6
       FROM notificacoes n WHERE ${VISIBILIDADE} AND n.id = $5
     ON CONFLICT (tenant_id, usuario_id, notificacao_id)
     DO UPDATE SET lida = EXCLUDED.lida, updated_at = NOW()
     RETURNING id`,
    [...baseParams(scope), notificationId, lida],
  );
  return (result.rowCount || 0) > 0;
}

export async function marcarTodasComoLidas(
  session: SessionPayload, tipo?: TipoNotificacao,
): Promise<number> {
  if (!pool) throw new Error('DB_UNAVAILABLE');
  const scope = await resolverEscopo(session, pool as unknown as Executor);
  const preferences = await obterPreferencias(pool as unknown as Executor, scope.tenantId, scope.usuarioId);
  const enabledTypes = TIPOS_NOTIFICACAO.filter(item => preferences.tipos[item.tipo]).map(item => item.tipo);
  const params: unknown[] = [...baseParams(scope), enabledTypes];
  let tipoClause = '';
  if (tipo) {
    params.push(tipo);
    tipoClause = `AND n.tipo = $${params.length}`;
  }
  const result = await pool.query(
    `INSERT INTO notificacoes_leituras (id, tenant_id, usuario_id, notificacao_id, lida)
     SELECT 'nl_' || gen_random_uuid()::text, $1, $2, n.id, TRUE
       FROM notificacoes n
       LEFT JOIN notificacoes_leituras leitura
         ON leitura.tenant_id = n.tenant_id AND leitura.usuario_id = $2 AND leitura.notificacao_id = n.id
      WHERE ${VISIBILIDADE} AND n.tipo = ANY($5::text[]) ${tipoClause}
        AND COALESCE(leitura.lida, n.lida) = FALSE
     ON CONFLICT (tenant_id, usuario_id, notificacao_id)
     DO UPDATE SET lida = TRUE, updated_at = NOW()
     RETURNING id`,
    params,
  );
  return result.rowCount || 0;
}
