/**
 * Copiar mês no servidor (05/11/2026).
 * Corpo: { modo: 'previa' | 'gravar', tabela, mes_origem: 'AAAA-MM', mes_destino: 'AAAA-MM' }.
 * Copia as contas lançadas à mão (mesmo critério de sempre) com o mesmo dia
 * no mês de destino. A chave copia:<mês>:<título> impede a cópia repetida.
 */
import { ehPrevia, lerCorpo, rodarRota } from '@/lib/recorrencia-rota';
import { copiarMesNoExecutor, lerTabela } from '@/lib/recorrencia-servidor';

export async function POST(req: Request) {
  return rodarRota('escrever', async ({ tenantId, hoje, tx }) => {
    const corpo = await lerCorpo(req);
    const pedido = {
      tabela: lerTabela(corpo.tabela ?? 'contas_pagar'),
      mes_origem: String(corpo.mes_origem ?? ''),
      mes_destino: String(corpo.mes_destino ?? ''),
      previa: ehPrevia(corpo),
    };
    return tx(exec => copiarMesNoExecutor(exec, tenantId, pedido, hoje));
  });
}
