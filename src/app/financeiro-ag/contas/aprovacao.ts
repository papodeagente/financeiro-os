'use client';

import { toast } from '@/lib/toast';

export type PedidoDeAprovacao = { tipo: 'limites' | 'pagamento'; conta_pagar_id?: string; status?: string };

/**
 * A liquidação ficou fora dos limites ou acima da alçada (05/11/2026): o aviso
 * traz o botão "Pedir aprovação", igual ao da liquidação de uma conta
 * (src/components/fin/useLiquidacao.ts). Limites: o mesmo pedido de baixa,
 * com a mesma chave, vira pedido de aprovação e é gravado sozinho quando
 * aprovado. Alçada: pede a aprovação do pagamento daquela conta.
 */
export function oferecerAprovacao(
  motivo: string,
  pedir: PedidoDeAprovacao,
  corpoDoPedido: Record<string, unknown>,
  chave: string,
): void {
  if (pedir.tipo === 'pagamento' && pedir.status === 'PENDENTE') {
    toast.info('Pagamento aguardando aprovação.', 'Quando for aprovado, liquide de novo.');
    return;
  }
  toast.comAcao('Precisa de aprovação', motivo, {
    rotulo: 'Pedir aprovação',
    onClick: () => {
      const req = pedir.tipo === 'pagamento'
        ? fetch('/api/aprovacoes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'pedir_pagamento', conta_pagar_id: pedir.conta_pagar_id }),
        })
        : fetch('/api/baixas', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': chave },
          body: JSON.stringify({ ...corpoDoPedido, pedir_aprovacao: true }),
        });
      void req.then(async r => {
        const c = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) { toast.error('Não foi possível pedir aprovação.', c.error || `Erro ${r.status}`); return; }
        toast.success('Pedido de aprovação enviado.', pedir.tipo === 'pagamento'
          ? 'Quando for aprovado, liquide de novo.'
          : 'As baixas são registradas sozinhas quando o pedido for aprovado.');
      }).catch(() => toast.error('Não foi possível pedir aprovação.'));
    },
  });
}
