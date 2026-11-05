/**
 * Recorrência (05/11/2026): POST cria a série.
 * Corpo: { modo: 'previa' | 'gravar', id?, tabela, tipo: 'recorrente' | 'parcelado',
 *          regra, inicio, valor (reais), modelo, horizonte_meses? }.
 * A prévia devolve datas e valores; gravar cria a série e os títulos numa
 * transação. Repetir o mesmo `id` não duplica (devolve ja_existia).
 */
import { ehPrevia, lerCorpo, rodarRota } from '@/lib/recorrencia-rota';
import { criarSerieNoExecutor, prepararSerie, previaDaSerie } from '@/lib/recorrencia-servidor';

export async function POST(req: Request) {
  return rodarRota('escrever', async ({ tenantId, hoje, tx }) => {
    const corpo = await lerCorpo(req);
    const serie = prepararSerie(corpo);
    if (ehPrevia(corpo)) return { previa: previaDaSerie(serie, hoje), id: serie.id };
    const r = await tx(exec => criarSerieNoExecutor(exec, tenantId, serie, hoje));
    return { ok: true, ...r };
  });
}
