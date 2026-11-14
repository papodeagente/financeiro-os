/**
 * Referência própria da cobrança no provedor (05/11/2026).
 *
 * Vai em `externalReference` (Asaas) e `code` (Pagar.me, até 52
 * caracteres): `f1;<agência>;<cobrança>`, e `f1;<agência>;k<carnê>` para o
 * carnê. Serve a duas coisas:
 * 1. o aviso do provedor que traz `f1;` é nosso e vai para a cobrança, não
 *    vira venda direta;
 * 2. o Asaas não tem chave de idempotência: depois de um timeout, a
 *    referência é como se descobre se a cobrança já foi criada.
 */
export const PREFIXO_REFERENCIA = 'f1;';
const LIMITE = 52;

export function referenciaDaCobranca(tenantId: string, cobrancaId: string): string {
  return validar(`${PREFIXO_REFERENCIA}${tenantId};${cobrancaId}`);
}

export function referenciaDoCarne(tenantId: string, carneId: string): string {
  return validar(`${PREFIXO_REFERENCIA}${tenantId};k${carneId}`);
}

function validar(ref: string): string {
  if (ref.length > LIMITE) throw new Error(`Referência longa demais para o provedor (${ref.length} > ${LIMITE}).`);
  return ref;
}

export interface ReferenciaLida {
  tenantId: string;
  /** Id da cobrança (vazio quando é de carnê). */
  cobrancaId: string;
  /** Id do carnê (vazio quando é de uma cobrança). */
  carneId: string;
}

/** Lê `f1;<agência>;<id>`. Null quando não é uma referência nossa. */
export function lerReferencia(valor: unknown): ReferenciaLida | null {
  const t = String(valor ?? '').trim();
  if (!t.startsWith(PREFIXO_REFERENCIA)) return null;
  const partes = t.slice(PREFIXO_REFERENCIA.length).split(';');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const [tenantId, id] = partes;
  if (id.startsWith('k') && id.length > 1) return { tenantId, cobrancaId: '', carneId: id.slice(1) };
  return { tenantId, cobrancaId: id, carneId: '' };
}

export function ehReferenciaNossa(valor: unknown): boolean {
  return lerReferencia(valor) !== null;
}
