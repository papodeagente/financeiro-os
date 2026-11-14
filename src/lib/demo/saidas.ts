/**
 * Agência de demonstração: nada sai (14/11/2026).
 *
 * A agência marcada `tenants.data.demo = true` é a conta de teste do
 * Fernando, com dados fictícios. Nada dela pode chegar a uma pessoa ou a um
 * sistema de verdade. Os pontos de saída perguntam aqui antes de agir:
 *
 *  - CRM (e-mail, WhatsApp, avisos de venda, comissão, relatório, Asaas pelo
 *    CRM): `lerCrmConfig` devolve "sem integração" e `crmLigado` diz não.
 *    Todo envio ao CRM passa por um dos dois.
 *  - Cobrança (Asaas, Pagar.me): a fábrica do provedor recusa, EXCETO o
 *    Asaas em sandbox (chave `$aact_hmlg_`), que não cobra ninguém.
 *  - Nota fiscal (emissor/prefeitura): emitir e cancelar recusam.
 *
 * Banco sem a coluna ou sem a agência responde "não é demo": quem pergunta
 * segue como sempre.
 */

export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const MOTIVO_DEMO = 'agência de demonstração: nada sai daqui para fora';

const CACHE_MS = 30_000;
const cache = new Map<string, { demo: boolean; ate: number }>();

/** A agência é a de demonstração? (cache de 30 s por agência) */
export async function ehAgenciaDemo(db: Consulta, tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  const agora = Date.now();
  const guardado = cache.get(tenantId);
  if (guardado && guardado.ate > agora) return guardado.demo;
  try {
    // Pergunta antes se a tabela existe: dentro de uma transação, um erro aqui
    // envenenaria a transação de quem chamou (testes com esquema parcial).
    const { rows: t } = await db.query(`SELECT to_regclass('public.tenants') IS NOT NULL AS ok`);
    if (t[0]?.ok !== true) return false;
    const { rows } = await db.query(`SELECT (data->>'demo') = 'true' AS demo FROM tenants WHERE id = $1`, [tenantId]);
    const demo = rows[0]?.demo === true;
    cache.set(tenantId, { demo, ate: agora + CACHE_MS });
    return demo;
  } catch {
    return false;
  }
}

/** Esquece o que sabe (ao criar ou recriar a agência de demonstração). */
export function esquecerDemo(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** Chave do Asaas de sandbox (o mesmo prefixo que escolhe a URL em plataformas/asaas.ts). */
export function chaveDeSandboxDoAsaas(apiKey: unknown): boolean {
  return String(apiKey ?? '').startsWith('$aact_hmlg_');
}

/** Motivo pelo qual nada sai desta agência, ou null. */
export async function recusaDaDemo(db: Consulta, tenantId: string): Promise<string | null> {
  return (await ehAgenciaDemo(db, tenantId)) ? MOTIVO_DEMO : null;
}

/**
 * Provedor de cobrança: na demonstração só o Asaas em sandbox. Null quando
 * pode chamar.
 */
export async function recusaDoProvedorNaDemo(
  db: Consulta, tenantId: string, provedor: string, apiKey: unknown,
): Promise<string | null> {
  if (!(await ehAgenciaDemo(db, tenantId))) return null;
  if (provedor === 'asaas' && chaveDeSandboxDoAsaas(apiKey)) return null;
  return `${MOTIVO_DEMO}. Na demonstração só o Asaas em sandbox emite cobrança (chave que começa com $aact_hmlg_).`;
}
