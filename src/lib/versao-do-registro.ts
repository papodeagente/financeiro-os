/**
 * Aviso de edição simultânea (06/11/2026, E7).
 *
 * Quem abre um título ou uma conta bancária recebe junto a "versão" do
 * registro (`_versao`: o instante da última gravação, em microssegundos). Ao
 * salvar, a tela devolve a versão que leu. Se outra pessoa gravou nesse meio
 * tempo, a versão não bate e o servidor responde 409 com
 * `{ error, conflito: true }`: a tela oferece recarregar, em vez de gravar por
 * cima do que a outra pessoa fez.
 *
 * Sem `_versao` no pedido (telas e integrações antigas), nada muda: grava
 * como sempre. `_versao` nunca é guardado dentro do registro.
 */

/** Versão da linha, em SQL: microssegundos do updated_at, como texto. */
export const SQL_VERSAO = `(FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000000))::bigint::text`;

/** Mesma expressão, com o apelido da tabela (ex.: `t.`). */
export const sqlVersaoDe = (apelido: string) => `(FLOOR(EXTRACT(EPOCH FROM ${apelido}.updated_at) * 1000000))::bigint::text`;

export const MENSAGEM_CONFLITO =
  'Alguém mudou este registro depois que você abriu. Recarregue para ver a versão atual antes de salvar.';

export const MENSAGEM_CONFLITO_TITULO =
  'Alguém mudou esta conta depois que você abriu. Recarregue para ver a versão atual antes de salvar.';

/** A versão que a tela leu, ou null quando não mandou (grava como sempre). */
export function versaoLida(item: Record<string, unknown>): string | null {
  const v = item._versao;
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
  return null;
}

/** Tira as marcas de controle que nunca vão para o registro gravado. */
export function semMarcasDeControle<T extends Record<string, unknown>>(item: T): T {
  const { _versao: _v, ...resto } = item as Record<string, unknown>;
  void _v;
  return resto as T;
}

/** A versão lida é diferente da que está no banco? */
export function versaoMudou(lida: string | null, atual: unknown): boolean {
  if (lida === null) return false;
  return String(atual ?? '') !== lida;
}
