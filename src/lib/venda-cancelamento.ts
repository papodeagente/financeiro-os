/**
 * Cancelar uma venda: o que morre junto com ela.
 *
 * Caminho único para o cancelamento feito na tela (PUT /api/vendas-crm/[id])
 * e para o que vem do CRM (VENDA_CANCELADA). Dois caminhos para a mesma
 * regra divergiriam no primeiro conserto feito em só um deles.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { STATUS_BAIXADOS } from './caixa-atomico';

const TABELAS_CONTAS = ['contas_receber', 'contas_pagar'] as const;

/**
 * Cancela as contas auto_geradas da venda que ainda estão em aberto.
 *
 * Contas já baixadas (RECEBIDO/PARCIAL/PAGO) NÃO são tocadas: o dinheiro já
 * se moveu e cancelar sem estorno deixaria o saldo bancário mentindo. Para
 * desfazer uma baixa, o caminho é o endpoint da própria conta.
 *
 * Devolve quantas contas de cada lado foram canceladas agora; rodar de novo
 * cancela zero.
 */
export async function cancelarContasDaVenda(
  exec: ExecutorSQL,
  vendaId: string,
  tenantId: string,
): Promise<{ receber: number; pagar: number }> {
  const saida = { receber: 0, pagar: 0 };
  for (const tabela of TABELAS_CONTAS) {
    const r = await exec.query(
      `UPDATE ${tabela}
          SET data = jsonb_set(data, '{status}', '"CANCELADO"'::jsonb, true),
              status = 'CANCELADO',
              updated_at = NOW()
        WHERE tenant_id = $1
          AND data->>'origem_venda_id' = $2
          AND data->>'auto_gerado' = 'true'
          AND NOT (COALESCE(data->>'status', '') = ANY($3::text[]))
          AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
      [tenantId, vendaId, [...STATUS_BAIXADOS]],
    );
    if (tabela === 'contas_receber') saida.receber = r.rowCount ?? 0;
    else saida.pagar = r.rowCount ?? 0;
  }
  return saida;
}
