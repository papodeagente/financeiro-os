/**
 * Quem pode abrir um documento (auditoria 04/11/2026, FIN-08).
 * Separado das rotas para ser testado sem subir o Next.
 */
import type { SessionPayload } from './auth';

export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Agência efetiva da sessão (a personificada, quando é a plataforma olhando). */
export function agenciaDaSessao(sessao: SessionPayload | null): string | null {
  return sessao?.impersonatingTenantId || sessao?.tenantId || null;
}

/** Dono do documento privado; null quando não está registrado. */
export async function donoDoArquivoPrivado(db: Consulta, nome: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT tenant_id FROM arquivos_privados WHERE nome = $1`, [nome]);
  return rows.length > 0 ? String(rows[0].tenant_id) : null;
}

/**
 * Decide o acesso a um documento.
 *  - plataforma (superadmin) abre qualquer um;
 *  - dono conhecido: só a sessão daquela agência;
 *  - dono desconhecido (só arquivo antigo, de antes do registro): qualquer
 *    sessão logada — melhor que o link aberto de antes, sem quebrar quem já
 *    usa; o inventário desses arquivos fica como pendência.
 */
export function podeAbrir(sessao: SessionPayload | null, dono: string | null, antigo: boolean): boolean {
  if (!sessao) return false;
  if (sessao.isSuperAdmin) return true;
  const agencia = agenciaDaSessao(sessao);
  if (!agencia) return false;
  if (dono) return dono === agencia;
  return antigo;
}
