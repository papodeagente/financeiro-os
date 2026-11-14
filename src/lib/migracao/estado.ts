/**
 * Mudança de sistema (E4, 05/11/2026): a agência está no meio de uma
 * mudança? Do momento em que um lote começa a ser aplicado até "Concluir
 * mudança" (ou até ser desfeito), a régua de cobrança, os avisos de
 * vencimento e a emissão de cobranças ficam parados NESTA agência: os
 * títulos trazidos do sistema anterior não podem disparar lembrete nem
 * boleto antes de a agência conferir as provas.
 *
 * Complementa nadaSai() (que vale só dentro do trabalho em andamento). Banco
 * sem o esquema da mudança (testes antigos, boot antes do initDB) responde
 * "nada segurado": quem pergunta segue como sempre.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { nadaSai } from '../nada-sai';

/** Situações do lote em que as saídas da agência ficam seguradas. */
export const STATUS_QUE_SEGURAM = ['aplicando', 'aplicado', 'desfazendo'] as const;

export const MOTIVO_DA_MUDANCA = 'mudança de sistema em andamento: as saídas ligam em "Concluir mudança"';

/** Motivo pelo qual nada sai desta agência agora, ou null. */
export async function mudancaSegurandoSaidas(exec: ExecutorSQL, tenantId: string): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const { rows: existe } = await exec.query(`SELECT to_regclass('public.migracao_lotes') IS NOT NULL AS ok`);
    if (!existe[0]?.ok) return null;
    const { rows } = await exec.query(
      `SELECT 1 FROM migracao_lotes WHERE tenant_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
      [tenantId, [...STATUS_QUE_SEGURAM]],
    );
    return rows.length ? MOTIVO_DA_MUDANCA : null;
  } catch {
    return null;
  }
}

/** nadaSai() do trabalho em andamento ou, senão, a mudança da agência. */
export async function nadaSaiDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<string | null> {
  return nadaSai() ?? (await mudancaSegurandoSaidas(exec, tenantId));
}
