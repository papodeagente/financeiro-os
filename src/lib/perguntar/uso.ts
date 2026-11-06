/**
 * "Perguntar em texto": o limite de uso por agência e o registro das
 * perguntas (quem perguntou, quais consultas rodaram). Controle: fora da
 * auditoria por linha (audit-schema.ts), como leituras_de_documento.
 *
 * Não importa nada do Next, para os testes rodarem contra um Postgres real.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { generateId } from '../utils';

export const PERGUNTAS_IA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS perguntas_ia (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  usuario_id TEXT NOT NULL DEFAULT '',
  pergunta TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'respondendo',
  ferramentas JSONB NOT NULL DEFAULT '[]'::jsonb,
  rodadas INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_perguntas_ia_recentes ON perguntas_ia (tenant_id, criado_em DESC);
`;

/**
 * Perguntas por agência a cada 24 horas (confirmar o número com o dono: cada
 * pergunta custa de uma a quatro chamadas à IA, na conta da agência).
 */
export const LIMITE_DE_PERGUNTAS_POR_DIA = 150;

export interface UsoDoDia { usados: number; limite: number }

export async function usoDoDia(exec: ExecutorSQL, tenantId: string): Promise<UsoDoDia> {
  const { rows } = await exec.query(
    `SELECT COUNT(*)::int AS n FROM perguntas_ia WHERE tenant_id = $1 AND criado_em > NOW() - INTERVAL '24 hours'`,
    [tenantId],
  );
  return { usados: Number(rows[0]?.n ?? 0), limite: LIMITE_DE_PERGUNTAS_POR_DIA };
}

/**
 * Reserva a vez da pergunta (conta no limite antes de chamar a IA). A trava
 * por agência impede que perguntas simultâneas passem juntas do limite.
 */
export async function reservarPergunta(
  exec: ExecutorSQL, args: { tenantId: string; usuarioId: string; pergunta: string },
): Promise<{ tipo: 'reservada'; id: string } | { tipo: 'limite'; uso: UsoDoDia }> {
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext('perguntas_ia:' || $1))`, [args.tenantId]);
  const uso = await usoDoDia(exec, args.tenantId);
  if (uso.usados >= uso.limite) return { tipo: 'limite', uso };
  const id = generateId();
  await exec.query(
    `INSERT INTO perguntas_ia (id, tenant_id, usuario_id, pergunta) VALUES ($1, $2, $3, $4)`,
    [id, args.tenantId, args.usuarioId, args.pergunta.slice(0, 500)],
  );
  return { tipo: 'reservada', id };
}

export async function concluirPergunta(
  exec: ExecutorSQL, args: { tenantId: string; id: string; estado: 'respondida' | 'falhou'; ferramentas: string[]; rodadas: number },
): Promise<void> {
  await exec.query(
    `UPDATE perguntas_ia SET estado = $3, ferramentas = $4::jsonb, rodadas = $5, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
    [args.tenantId, args.id, args.estado, JSON.stringify(args.ferramentas.slice(0, 20)), args.rodadas],
  );
}
