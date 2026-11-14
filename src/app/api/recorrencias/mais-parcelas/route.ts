/**
 * Mais parcelas (05/11/2026): gera N cópias de um título existente.
 * Corpo: { modo: 'previa' | 'gravar', tabela, titulo_id, quantidade,
 *          periodicidade ('MENSAL'…), emissao_no_vencimento, chave? }.
 * Recusa título gerado por venda, grupo, plataforma ou fatura de cartão.
 */
import { ehPrevia, lerCorpo, rodarRota } from '@/lib/recorrencia-rota';
import { lerTabela, maisParcelasNoExecutor } from '@/lib/recorrencia-servidor';
import type { ChavePreset } from '@/lib/recorrencia';
import { recusaModulo } from '@/lib/guarda-rota';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  return rodarRota('escrever', async ({ tenantId, hoje, tx }) => {
    const corpo = await lerCorpo(req);
    const pedido = {
      tabela: lerTabela(corpo.tabela),
      titulo_id: String(corpo.titulo_id ?? ''),
      quantidade: corpo.quantidade as number,
      periodicidade: String(corpo.periodicidade ?? '') as ChavePreset,
      emissao_no_vencimento: corpo.emissao_no_vencimento === true,
      previa: ehPrevia(corpo),
      chave: typeof corpo.chave === 'string' ? corpo.chave.slice(0, 80) : undefined,
    };
    return tx(exec => maisParcelasNoExecutor(exec, tenantId, pedido, hoje));
  });
}
