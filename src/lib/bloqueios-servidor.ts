// Leitura e gravação dos bloqueios do financeiro em agencia.data
// (05/11/2026). A regra em si é pura: ./bloqueios-financeiros.
import { normalizarBloqueios, type BloqueiosFinanceiros } from './bloqueios-financeiros';
import type { ExecutorPermissoes } from './permissoes-servidor';

export async function lerBloqueios(exec: ExecutorPermissoes, tenantId: string): Promise<BloqueiosFinanceiros> {
  const { rows } = await exec.query(
    `SELECT data->'bloqueios_financeiros' AS b FROM agencia WHERE tenant_id = $1
      ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId]);
  return normalizarBloqueios(rows[0]?.b);
}

/** Grava só a chave dos bloqueios, sem tocar no resto dos dados da agência. */
export async function gravarBloqueios(exec: ExecutorPermissoes, tenantId: string, entrada: unknown): Promise<BloqueiosFinanceiros> {
  const config = normalizarBloqueios(entrada);
  const { rows } = await exec.query(
    `SELECT id FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId]);
  if (rows[0]) {
    await exec.query(
      `UPDATE agencia SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{bloqueios_financeiros}', $3::jsonb, true), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`, [rows[0].id, tenantId, JSON.stringify(config)]);
  } else {
    await exec.query(
      `INSERT INTO agencia (id, tenant_id, data, updated_at) VALUES ($1, $2, $3::jsonb, NOW())`,
      [`agencia-${tenantId}`, tenantId, JSON.stringify({ bloqueios_financeiros: config })]);
  }
  return config;
}
