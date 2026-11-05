/**
 * O PERFIL DA CONTA (Bruno, 04/11/2026): "separar apenas a Conta nº 1 para
 * fazer alterações só nela, não como piloto, mas como o financeiro da Entur,
 * que gerencia todo o ecossistema do Entur OS. As outras contas seguem
 * específicas para agências de viagens."
 *
 *   agencia      toda conta, como sempre foi
 *   ecossistema  a conta da Entur: recebe o que é do ecossistema (hoje, a
 *                comissão por MRR, comissao-mrr.ts)
 *
 * O perfil mora em `tenants.data.perfil` e é ligado à mão, uma vez, pelo SQL
 * revisado (nunca pelo número da conta no código: se um dia outra empresa
 * precisar do mesmo perfil, é ligar). Sem nada gravado, a conta é agência.
 *
 * A trava vale no SERVIDOR: esconder o menu não protege nada. Toda rota do
 * ecossistema chama exigirEcossistema antes de ler ou gravar.
 */
import pool from './db';
import type { ExecutorSQL } from './caixa-atomico';

export type PerfilDaConta = 'agencia' | 'ecossistema';

/** O perfil a partir de `tenants.data`. Qualquer coisa fora do combinado é agência. */
export function perfilDosDados(data: unknown): PerfilDaConta {
  return data && typeof data === 'object' && (data as Record<string, unknown>).perfil === 'ecossistema' ? 'ecossistema' : 'agencia';
}

export async function perfilDaConta(tenantId: string, exec: ExecutorSQL | null = pool as unknown as ExecutorSQL | null): Promise<PerfilDaConta> {
  if (!exec || !tenantId) return 'agencia';
  const { rows } = await exec.query(`SELECT data FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]);
  return perfilDosDados(rows[0]?.data);
}

/**
 * null quando a conta é o ecossistema; senão a resposta que a rota devolve.
 * 404, e não 403: para uma agência a página e a rota simplesmente não existem.
 */
export async function exigirEcossistema(tenantId: string, exec?: ExecutorSQL | null): Promise<{ status: number; erro: string } | null> {
  const perfil = await perfilDaConta(tenantId, exec);
  return perfil === 'ecossistema' ? null : { status: 404, erro: 'Recurso indisponível para esta conta.' };
}
