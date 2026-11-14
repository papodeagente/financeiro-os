/**
 * Endereço do portal do cliente para os avisos ao CRM (05/11/2026).
 *
 * O portal (/c/[token]), a tabela dos links (`cobranca_portal_links`) e as
 * rotas que criam, mostram e revogam o link são da PARTE B
 * (src/lib/cobranca/portal-servidor.ts). Aqui só se monta o `url_portal`
 * dos eventos COBRANCA_*, no MESMO formato da parte B:
 * - link ativo com o token cifrado no cofre: o mesmo endereço de sempre;
 * - nenhum link ativo: cria um (32 bytes aleatórios, SHA-256 no banco,
 *   cópia cifrada), como `criarLink` da parte B;
 * - link ativo sem a cópia cifrada (cofre desligado quando foi criado):
 *   endereço vazio — não dá para remontar sem revogar o que o cliente tem.
 *
 * Na integração, isto pode chamar `estadoDoLink`/`criarLink` da parte B
 * direto (mesma tabela, mesmo hash).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ExecutorSQL } from '../caixa-atomico';
import { cifrar, cofreDisponivel, decifrar } from '../cofre';
import { getDefaultPublicBase } from '../proposta-link';

export const TABELA_LINKS_DO_PORTAL = 'cobranca_portal_links';

export function hashDoTokenDoPortal(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function urlDoPortal(token: string, base?: string): string {
  return `${(base || getDefaultPublicBase()).replace(/\/+$/, '')}/c/${token}`;
}

/** O link do portal do cliente para mandar ao CRM ('' quando não dá para montar). */
export async function urlDoPortalParaCrm(exec: ExecutorSQL, tenantId: string, clienteId: string, base?: string): Promise<string> {
  if (!clienteId) return '';
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.${TABELA_LINKS_DO_PORTAL}') IS NOT NULL AS ok`);
  if (!tem[0]?.ok) return '';
  const { rows } = await exec.query(
    `SELECT token_cifrado FROM ${TABELA_LINKS_DO_PORTAL}
      WHERE tenant_id = $1 AND cliente_id = $2 AND revogado_em IS NULL AND (expira_em IS NULL OR expira_em > NOW())
      ORDER BY criado_em DESC LIMIT 1`,
    [tenantId, clienteId],
  );
  if (rows.length) {
    const cifrado = rows[0].token_cifrado;
    if (!cifrado || !cofreDisponivel()) return '';
    try {
      return urlDoPortal(decifrar(typeof cifrado === 'string' ? JSON.parse(cifrado) : cifrado), base);
    } catch {
      return '';
    }
  }
  if (!cofreDisponivel()) return '';
  const { rows: cli } = await exec.query('SELECT 1 FROM clientes WHERE tenant_id = $1 AND id = $2', [tenantId, clienteId]);
  if (!cli.length) return '';
  const token = randomBytes(32).toString('base64url');
  const r = await exec.query(
    `INSERT INTO ${TABELA_LINKS_DO_PORTAL} (id, tenant_id, cliente_id, token_hash, token_cifrado, criado_por)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'cobranca')
     ON CONFLICT (tenant_id, cliente_id) WHERE revogado_em IS NULL DO NOTHING
     RETURNING id`,
    [`pl-${randomBytes(9).toString('base64url')}`, tenantId, clienteId, hashDoTokenDoPortal(token), JSON.stringify(cifrar(token))],
  );
  // Outro processo criou ao mesmo tempo: usa o dele.
  if (!r.rows.length) return urlDoPortalParaCrm(exec, tenantId, clienteId, base);
  return urlDoPortal(token, base);
}
