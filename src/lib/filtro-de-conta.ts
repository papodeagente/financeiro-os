// Filtro por conta bancária liberada (05/11/2026). Puro: recebe as linhas já
// lidas e a lista de `contasPermitidas` (null = todas, e aí nada muda).
import { STATUS_DE_BAIXA } from './guarda-baixa';

export interface FiltroDeConta {
  /** A própria tabela é o cadastro de contas: filtra pelo `id`. */
  cadastro?: boolean;
  /** Campos com id de conta bancária. A linha some se QUALQUER um não estiver liberado. */
  campos?: string[];
  /** Só esconde linhas já baixadas (pagas/recebidas) numa conta não liberada. */
  soBaixados?: boolean;
}

export function linhaLiberada(item: Record<string, unknown>, filtro: FiltroDeConta, contas: ReadonlySet<string>): boolean {
  if (filtro.cadastro) return contas.has(String(item.id ?? ''));
  if (filtro.soBaixados && !STATUS_DE_BAIXA.includes(String(item.status ?? ''))) return true;
  for (const campo of filtro.campos ?? []) {
    const conta = item[campo];
    if (typeof conta === 'string' && conta !== '' && !contas.has(conta)) return false;
  }
  return true;
}

export function filtrarPorConta<T extends Record<string, unknown>>(
  itens: T[], filtro: FiltroDeConta | undefined, contas: readonly string[] | null,
): T[] {
  if (!filtro || contas === null) return itens;
  const set = new Set(contas);
  return itens.filter(item => linhaLiberada(item, filtro, set));
}
