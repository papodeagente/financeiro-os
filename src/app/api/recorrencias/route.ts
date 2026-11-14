/**
 * Recorrência (05/11/2026): POST cria a série.
 * Corpo: { modo: 'previa' | 'gravar', id?, tabela, tipo: 'recorrente' | 'parcelado',
 *          regra, inicio, valor (reais), modelo, horizonte_meses? }.
 * A prévia devolve datas e valores; gravar cria a série e os títulos numa
 * transação. Repetir o mesmo `id` não duplica (devolve ja_existia).
 */
import { ehPrevia, lerCorpo, rodarRota } from '@/lib/recorrencia-rota';
import { ErroRecorrencia, criarSerieNoExecutor, prepararSerie, previaDaSerie } from '@/lib/recorrencia-servidor';
import pool from '@/lib/db';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { conferirMoedaDoCadastro } from '@/lib/moedas';
import { lerCatalogoDaAgencia } from '@/lib/moedas-servidor';
import { recusaDosObrigatorios } from '@/lib/campos-personalizados-servidor';
import { recusaModulo } from '@/lib/guarda-rota';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  return rodarRota('escrever', async ({ tenantId, hoje, tx }) => {
    const corpo = await lerCorpo(req);
    const serie = prepararSerie(corpo);
    // E7, frente D: a moeda do catálogo da agência e os campos obrigatórios
    // da empresa, como no lançamento de uma conta só.
    const exec = pool as unknown as ExecutorSQL;
    const moeda = conferirMoedaDoCadastro(serie.modelo.moeda ?? '', await lerCatalogoDaAgencia(exec, tenantId));
    if ('erro' in moeda) throw new ErroRecorrencia(moeda.erro);
    if (!ehPrevia(corpo)) {
      const faltou = await recusaDosObrigatorios(exec, tenantId, serie.tabela, serie.modelo);
      if (faltou) throw new ErroRecorrencia(faltou);
    }
    if (ehPrevia(corpo)) return { previa: previaDaSerie(serie, hoje), id: serie.id };
    const r = await tx(exec => criarSerieNoExecutor(exec, tenantId, serie, hoje));
    return { ok: true, ...r };
  });
}
