import { randomUUID } from 'node:crypto';
import pool, { initDB } from './db';
import { getSession, type SessionPayload } from './auth';
import { getAuditContext } from './audit-context';
import type { AcaoAuditoria, LogAuditoria } from './crm-types';

interface EventoAuditoria {
  tenantId?: string;
  /** Login fornece a sessão recém-validada; null indica visitante. */
  session?: SessionPayload | null;
  acao: AcaoAuditoria;
  modulo: string;
  entidade: string;
  entidadeId?: string;
  descricao: string;
  origem?: LogAuditoria['origem'];
  alteracoes?: LogAuditoria['alteracoes'];
}

/** Ações sem mutação de tabelas: sessões, arquivos e exportações.
 * Nunca recebe body da requisição; identidade e horário vêm do servidor.
 */
export async function registrarEventoAuditoria(input: EventoAuditoria): Promise<void> {
  const session = input.session === undefined ? await getSession() : input.session;
  const tenantId = input.tenantId || session?.impersonatingTenantId || session?.tenantId;
  if (!tenantId) throw new Error('Agência necessária para registrar auditoria.');
  await initDB();
  if (!pool) throw new Error('Banco de dados indisponível para auditoria.');
  const context = await getAuditContext();
  const id = randomUUID();
  const item = {
    id, usuario_id: session?.userId || '', usuario_nome: session?.nome || 'Visitante',
    perfil: session?.perfil || '', acao: input.acao, modulo: input.modulo,
    entidade: input.entidade, entidade_id: input.entidadeId || '', descricao: input.descricao,
    origem: input.origem || (session ? 'USUARIO' : 'PUBLICO'),
    alteracoes: input.alteracoes || [], request_id: context.requestId || '',
    rota: context.path || '', metodo: context.method || '',
  };
  await pool.query(
    `INSERT INTO audit_log (id, tenant_id, usuario_id, acao, modulo, entidade, entidade_id, data, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
       $8::jsonb || jsonb_build_object('timestamp', clock_timestamp()), clock_timestamp())`,
    [id, tenantId, item.usuario_id, item.acao, item.modulo, item.entidade, item.entidade_id, JSON.stringify(item)],
  );
}
