/**
 * A venda que o CRM perdeu (VENDA_CANCELADA).
 *
 * POR QUE EXISTE. O CRM já mandava este evento quando um negócio ganho era
 * perdido ou voltava a ficar em aberto, e o financeiro o descartava em
 * silêncio: a venda seguia confirmada, com as contas a receber e a pagar
 * inflando o "a receber" e o "a pagar" de uma viagem que não ia acontecer.
 *
 * O QUE O CRM PEDE, e o que acontece:
 *   - "cancelar": a venda é cancelada, com as contas EM ABERTO que ela gerou.
 *     Conta baixada fica como está, porque o dinheiro já se moveu. Se entrou
 *     dinheiro, alguém precisa decidir se ele volta para o cliente: isso vira
 *     uma notificação, e nada é estornado sozinho.
 *   - "aprovar": nada é cancelado. Vira uma notificação pedindo que alguém
 *     confirme o cancelamento na tela da venda.
 * Pedido sem ação conhecida é tratado como "aprovar": cancelar dinheiro exige
 * ordem explícita.
 *
 * Idempotente: a venda já cancelada não muda, e a notificação tem chave de
 * deduplicação.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { valorNoCaixa } from './caixa-atomico';
import { cancelarContasDaVenda } from './venda-cancelamento';
import { round2 } from './money';
import { formatBRL } from './utils';

const txt = (v: unknown): string =>
  (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

export type AcaoCancelamentoCRM = 'cancelar' | 'aprovar';

export interface PedidoDeCancelamentoCRM {
  crmVendaId: string;
  /** 'lost' (perdido) ou 'won_reverted' (deixou de ser ganho), como o CRM manda. */
  motivo: string;
  acao: AcaoCancelamentoCRM;
}

export function lerPedidoDeCancelamento(p: Record<string, unknown>): PedidoDeCancelamentoCRM {
  const acao = txt(p.acao_solicitada).toLowerCase();
  return {
    crmVendaId: txt(p.crm_venda_id) || txt(p.crm_deal_id),
    motivo: txt(p.motivo),
    acao: acao === 'cancelar' ? 'cancelar' : 'aprovar',
  };
}

/** O que aconteceu no CRM, em português de gente. */
export function frasesDoMotivo(motivo: string): { negocio: string; curto: string } {
  if (motivo === 'lost') return { negocio: 'O negócio foi marcado como perdido no CRM', curto: 'perdida no CRM' };
  if (motivo === 'won_reverted') return { negocio: 'O negócio deixou de estar ganho no CRM e voltou a ficar em aberto', curto: 'reaberta no CRM' };
  return {
    negocio: motivo ? `O negócio foi cancelado no CRM (motivo: ${motivo})` : 'O negócio foi cancelado no CRM',
    curto: 'cancelada no CRM',
  };
}

export interface NotificacaoDoCancelamento {
  titulo: string;
  descricao: string;
  chave: string;
}

export interface ResultadoCancelamentoCRM {
  encontrada: boolean;
  vendaId: string;
  numero: string;
  vendedorId: string;
  cancelada: boolean;
  jaEstavaCancelada: boolean;
  contasCanceladas: { receber: number; pagar: number };
  /** Dinheiro que já entrou por esta venda e ficou lançado. */
  recebido: number;
  /** Dinheiro que já saiu para fornecedores por esta venda. */
  pago: number;
  /** Pagamento da plataforma confirmado e ainda por cair (cartão parcelado). */
  aCairDaPlataforma: number;
  notificacao: NotificacaoDoCancelamento | null;
  acao: string;
}

/**
 * Aplica o pedido do CRM, dentro da transação de quem chama. A notificação
 * volta no resultado e é criada por quem chama, depois do COMMIT.
 */
export async function aplicarCancelamentoDoCrm(
  exec: ExecutorSQL,
  tenantId: string,
  pedido: PedidoDeCancelamentoCRM,
  eventoId: string,
): Promise<ResultadoCancelamentoCRM> {
  const vazio: ResultadoCancelamentoCRM = {
    encontrada: false, vendaId: '', numero: '', vendedorId: '', cancelada: false, jaEstavaCancelada: false,
    contasCanceladas: { receber: 0, pagar: 0 }, recebido: 0, pago: 0, aCairDaPlataforma: 0, notificacao: null, acao: '',
  };
  const { rows } = await exec.query(
    `SELECT id, status, vendedor_id, data FROM vendas_crm
      WHERE tenant_id = $1 AND data->>'crm_venda_id' = $2
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [tenantId, pedido.crmVendaId],
  );
  if (rows.length === 0) {
    return { ...vazio, acao: `venda ${pedido.crmVendaId} não existe no financeiro: nada a cancelar` };
  }

  const v = rows[0];
  const vendaId = String(v.id);
  const d = (v.data ?? {}) as Record<string, unknown>;
  const numero = txt(d.numero) || vendaId;
  const vendedorId = txt(v.vendedor_id) || txt(d.vendedor_id);
  const jaCancelada = txt(v.status).toUpperCase() === 'CANCELADO' || txt(d.status).toUpperCase() === 'CANCELADO';
  const base = { ...vazio, encontrada: true, vendaId, numero, vendedorId, jaEstavaCancelada: jaCancelada };

  // O dinheiro que já se moveu por esta venda: contas geradas por ela e
  // recebimentos de plataforma vinculados a ela.
  const { rows: receb } = await exec.query(
    `SELECT data FROM contas_receber
      WHERE tenant_id = $1
        AND (venda_id = $2 OR data->>'origem_venda_id' = $2 OR data->>'venda_id' = $2)
        AND COALESCE(data->>'status', '') IN ('RECEBIDO', 'PARCIAL')`,
    [tenantId, vendaId],
  );
  const { rows: pagas } = await exec.query(
    `SELECT data FROM contas_pagar
      WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2
        AND COALESCE(data->>'status', '') IN ('PAGO', 'PARCIAL')`,
    [tenantId, vendaId],
  );
  // O que a plataforma já confirmou e ainda vai repassar: não é caixa, mas é
  // dinheiro do cliente que alguém precisa devolver na plataforma.
  const { rows: aCair } = await exec.query(
    `SELECT COALESCE(SUM(CASE WHEN jsonb_typeof(data->'valor_final') = 'number'
                              THEN (data->>'valor_final')::numeric ELSE 0 END), 0) AS total
       FROM contas_receber
      WHERE tenant_id = $1
        AND (venda_id = $2 OR data->>'venda_id' = $2)
        AND COALESCE(data->>'plataforma_transacao', '') <> ''
        AND COALESCE(data->>'status', '') IN ('PENDENTE', 'ATRASADO')`,
    [tenantId, vendaId],
  );
  const recebido = round2(receb.reduce((s, r) => s + valorNoCaixa(r.data as Record<string, unknown>, 'valor_recebido'), 0));
  const pago = round2(pagas.reduce((s, r) => s + valorNoCaixa(r.data as Record<string, unknown>, 'valor_pago'), 0));
  const aCairDaPlataforma = round2(Number(aCair[0]?.total ?? 0));
  const frases = frasesDoMotivo(pedido.motivo);
  // A chave muda quando a venda é refeita pelo CRM (created_at é regravado a
  // cada VENDA_FECHADA): a mesma venda perdida duas vezes avisa duas vezes.
  const chave = `crm-venda-cancelada:${vendaId}:${pedido.acao}:${txt(d.created_at)}`;
  const partes = [
    recebido > 0 ? `${formatBRL(recebido)} já foram recebidos` : '',
    aCairDaPlataforma > 0 ? `${formatBRL(aCairDaPlataforma)} ainda vão cair pela plataforma` : '',
    pago > 0 ? `${formatBRL(pago)} já foram pagos a fornecedores` : '',
  ].filter(Boolean);
  const dinheiro = partes.length <= 1
    ? (partes[0] ?? '')
    : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;

  if (pedido.acao === 'aprovar') {
    if (jaCancelada) return { ...base, recebido, pago, aCairDaPlataforma, acao: `venda ${vendaId} já estava cancelada: nada a aprovar` };
    return {
      ...base, recebido, pago, aCairDaPlataforma,
      notificacao: {
        titulo: `Venda ${numero} ${frases.curto}: confirme o cancelamento`,
        descricao: `${frases.negocio}, que pediu aprovação antes de cancelar. Nada foi cancelado aqui. Abra a venda e cancele se o cliente desistiu mesmo.${dinheiro ? ` Atenção: ${dinheiro} por esta venda.` : ''}`,
        chave,
      },
      acao: `venda ${vendaId} ${frases.curto}: cancelamento aguardando aprovação, nada foi cancelado`,
    };
  }

  if (jaCancelada) {
    return { ...base, recebido, pago, aCairDaPlataforma, acao: `venda ${vendaId} já estava cancelada: nada mudou` };
  }

  const contas = await cancelarContasDaVenda(exec, vendaId, tenantId);
  const registro = {
    motivo: pedido.motivo,
    evento_id: eventoId,
    em: new Date().toISOString(),
    recebido,
    pago,
    a_cair_da_plataforma: aCairDaPlataforma,
  };
  await exec.query(
    `UPDATE vendas_crm
        SET status = 'CANCELADO',
            data = data || jsonb_build_object('status', 'CANCELADO', 'cancelada_no_crm', $3::jsonb),
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [vendaId, tenantId, JSON.stringify(registro)],
  );

  const comDinheiro = recebido > 0 || pago > 0 || aCairDaPlataforma > 0;
  return {
    ...base,
    cancelada: true,
    contasCanceladas: contas,
    recebido,
    pago,
    aCairDaPlataforma,
    notificacao: comDinheiro
      ? {
          titulo: `Venda ${numero} ${frases.curto} com dinheiro já movimentado`,
          descricao: `${frases.negocio} e a venda foi cancelada aqui, com as contas em aberto. Mas ${dinheiro}, e isso continua lançado: decida se o dinheiro volta para o cliente ou fica com a agência.`,
          chave,
        }
      : null,
    acao: `venda ${vendaId} cancelada pelo CRM (${pedido.motivo || 'sem motivo'}): ${contas.receber} conta(s) a receber e ${contas.pagar} a pagar canceladas${dinheiro ? `; ${dinheiro} e ficaram como estavam` : ''}`,
  };
}
