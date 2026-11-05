/**
 * "Nada sai" (05/11/2026): enquanto um trabalho roda dentro de comNadaSai()
 * — importação do sistema anterior, ensaio, sandbox — nada é avisado para
 * fora: nenhum evento ao CRM, nenhuma notificação, cobrança, régua ou nota.
 * Os pontos de saída perguntam nadaSai() antes de agir.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const contexto = new AsyncLocalStorage<{ motivo: string }>();

/** Roda `fn` com as saídas desligadas. */
export function comNadaSai<T>(motivo: string, fn: () => Promise<T>): Promise<T> {
  return contexto.run({ motivo }, fn);
}

/** Motivo pelo qual as saídas estão desligadas agora, ou null. */
export function nadaSai(): string | null {
  return contexto.getStore()?.motivo ?? null;
}
