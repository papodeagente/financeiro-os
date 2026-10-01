/**
 * A unificação no banco. A regra está em unificacao.ts; aqui é leitura,
 * plano e gravação, sempre dentro da transação de quem chama.
 *
 * Idempotência, que importa porque o webhook da plataforma reprocessa a
 * mesma transação a cada aviso de status: o que esta transação JÁ consumiu
 * das contas da venda fica carimbado nelas, e cada nova passada só aplica a
 * diferença entre o total recebido agora e o que já foi consumido. Parcela
 * nova consome mais; aviso repetido não consome nada.
 *
 * O carimbo guarda o valor e o status ORIGINAIS da conta, e nunca é
 * sobrescrito por uma segunda passada — senão desfazer devolveria o valor
 * já reduzido em vez do combinado na venda.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { num, round2 } from '../money';
import {
  carimbo as montarCarimbo,
  planoDeUnificacao,
  type CarimboDeSubstituicao,
  type ContaDaVenda,
  type PlanoDeUnificacao,
} from './unificacao';

export interface AlvoDaUnificacao {
  vendaId: string;
  plataforma: string;
  idTransacao: string;
}

interface LinhaConta extends ContaDaVenda {
  observacoes: string;
  carimbo: CarimboDeSubstituicao | null;
}

/** As contas da venda que vieram do CRM (ou foram criadas à mão): nunca as da plataforma. */
async function contasDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<LinhaConta[]> {
  const { rows } = await exec.query(
    `SELECT id, data FROM contas_receber
      WHERE tenant_id = $1
        AND (venda_id = $2 OR data->>'origem_venda_id' = $2 OR data->>'venda_id' = $2)
        AND COALESCE(data->>'plataforma_transacao', '') = ''`,
    [tenantId, vendaId],
  );
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      status: String(d.status ?? ''),
      valor_final: num(d.valor_final),
      data_vencimento: String(d.data_vencimento ?? ''),
      plataforma_transacao: null,
      observacoes: String(d.observacoes ?? ''),
      carimbo: (d.substituida_por_plataforma ?? null) as CarimboDeSubstituicao | null,
    };
  });
}

/** O bruto que a plataforma recebeu nesta transação (soma das parcelas vivas). */
async function totalDaTransacao(exec: ExecutorSQL, tenantId: string, plataforma: string, idTransacao: string): Promise<number> {
  const { rows } = await exec.query(
    `SELECT COALESCE(SUM((data->>'valor_final')::numeric), 0) AS total
       FROM contas_receber
      WHERE tenant_id = $1
        AND data->>'plataforma_origem' = $2
        AND data->>'plataforma_transacao' = $3
        AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
    [tenantId, plataforma, idTransacao],
  );
  return round2(num(rows[0]?.total));
}

/** Quanto desta transação já está carimbado nas contas da venda. */
function jaConsumido(contas: readonly LinhaConta[], plataforma: string, idTransacao: string): number {
  let total = 0;
  for (const c of contas) {
    const k = c.carimbo;
    if (!k || k.plataforma !== plataforma || k.id_transacao !== idTransacao) continue;
    total += k.acao === 'CANCELAR' ? num(k.valor_original) : round2(num(k.valor_original) - c.valor_final);
  }
  return round2(total);
}

export interface ResultadoUnificacao extends PlanoDeUnificacao {
  total_plataforma: number;
  ja_consumido: number;
}

/**
 * Faz o recebimento da plataforma consumir as contas pendentes da venda.
 * Chamado dentro da transação de vincular (manual) e do vínculo automático.
 */
export async function unificarRecebimento(
  exec: ExecutorSQL,
  tenantId: string,
  alvo: AlvoDaUnificacao,
): Promise<ResultadoUnificacao> {
  const [contas, total] = await Promise.all([
    contasDaVenda(exec, tenantId, alvo.vendaId),
    totalDaTransacao(exec, tenantId, alvo.plataforma, alvo.idTransacao),
  ]);
  const consumidoAntes = jaConsumido(contas, alvo.plataforma, alvo.idTransacao);
  const plano = planoDeUnificacao(contas, round2(total - consumidoAntes));

  for (const a of plano.acoes) {
    const conta = contas.find(c => c.id === a.id);
    if (!conta) continue;
    // Segunda passada numa conta já carimbada por ESTA transação: o original
    // é o do carimbo, não o estado atual (já reduzido).
    const anterior = conta.carimbo && conta.carimbo.plataforma === alvo.plataforma && conta.carimbo.id_transacao === alvo.idTransacao
      ? conta.carimbo
      : null;
    const k = anterior
      ? { ...anterior, acao: a.acao }
      : montarCarimbo(a, alvo.plataforma, alvo.idTransacao, conta.status);

    const nota = a.acao === 'CANCELAR'
      ? `Substituída pelo recebimento da plataforma ${alvo.plataforma} (transação ${alvo.idTransacao}).`
      : `Recebimento da plataforma ${alvo.plataforma} (transação ${alvo.idTransacao}) cobriu parte: valor reduzido de ${k.valor_original.toFixed(2)} para ${a.valor_novo.toFixed(2)}.`;
    const observacoes = conta.observacoes.includes(`transação ${alvo.idTransacao}`)
      ? conta.observacoes
      : [conta.observacoes, nota].filter(Boolean).join(' | ');

    if (a.acao === 'CANCELAR') {
      await exec.query(
        `UPDATE contas_receber
            SET status = 'CANCELADO',
                data = data || jsonb_build_object(
                  'status', 'CANCELADO',
                  'substituida_por_plataforma', $3::jsonb,
                  'observacoes', $4::text),
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [a.id, tenantId, JSON.stringify(k), observacoes],
      );
    } else {
      await exec.query(
        `UPDATE contas_receber
            SET data = data || jsonb_build_object(
                  'valor_final', $3::numeric,
                  'valor_original', $3::numeric,
                  'substituida_por_plataforma', $4::jsonb,
                  'observacoes', $5::text),
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [a.id, tenantId, a.valor_novo, JSON.stringify(k), observacoes],
      );
    }
  }

  return { ...plano, total_plataforma: total, ja_consumido: consumidoAntes };
}

/**
 * Devolve as contas da venda ao que eram antes desta transação consumi-las.
 * Chamado quando o operador registra o recebimento como venda direta.
 */
export async function desfazerUnificacao(
  exec: ExecutorSQL,
  tenantId: string,
  plataforma: string,
  idTransacao: string,
): Promise<{ restauradas: number }> {
  const { rows } = await exec.query(
    `SELECT id, data FROM contas_receber
      WHERE tenant_id = $1
        AND data->'substituida_por_plataforma'->>'plataforma' = $2
        AND data->'substituida_por_plataforma'->>'id_transacao' = $3`,
    [tenantId, plataforma, idTransacao],
  );
  let restauradas = 0;
  for (const r of rows) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const k = d.substituida_por_plataforma as CarimboDeSubstituicao;
    // Conta que recebeu baixa DEPOIS da unificação não volta: caixa moveu.
    if (['RECEBIDO', 'PARCIAL'].includes(String(d.status ?? ''))) continue;
    await exec.query(
      `UPDATE contas_receber
          SET status = $3,
              data = (data - 'substituida_por_plataforma') || jsonb_build_object(
                'status', $3::text,
                'valor_final', $4::numeric,
                'valor_original', $4::numeric),
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [r.id, tenantId, k.status_original || 'PENDENTE', num(k.valor_original)],
    );
    restauradas++;
  }
  return { restauradas };
}
