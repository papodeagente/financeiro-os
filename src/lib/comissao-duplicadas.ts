/**
 * AS CONTAS DE COMISSÃO EM DOBRO QUE JÁ EXISTEM.
 *
 * Até 08/10/2026 cada comissão aprovada ganhava duas contas a pagar: a do
 * gancho do servidor (`cp-comissao-<id>`) e a da tela (`pagar-<id>`). Pagar
 * baixava a da tela; a do gancho ficava pendente e o fluxo de caixa contava a
 * comissão duas vezes. O código novo não cria mais a segunda, mas as que já
 * existem continuam lá. Aqui elas são listadas (para alguém ver antes) e
 * canceladas (só quando alguém mandar).
 *
 * Duplicada = `cp-comissao-<id>` em aberto (nem baixada, nem cancelada) com
 * uma `pagar-<id>` viva, da mesma agência. A `pagar-<id>` é a que fica: é a
 * que o pagamento da tela baixou. Conta baixada nunca entra na lista nem é
 * tocada. Cancelar não exclui e não move caixa.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { PREFIXO_CONTA_COMISSAO, PREFIXO_CONTA_LEGADA } from './comissao-conta-unica';
import { round2 } from './money';

export interface ContaDuplicada {
  comissao_id: string;
  conta_duplicada_id: string;
  conta_mantida_id: string;
  valor: number;
  vendedor: string;
  status_da_mantida: string;
}

export interface ResumoDuplicadas {
  quantidade: number;
  valor_total: number;
  itens: ContaDuplicada[];
  /**
   * As duas contas da mesma comissão já baixadas: o dinheiro saiu duas vezes.
   * Não entram na contagem nem são canceladas (cancelar não devolve
   * dinheiro); aparecem para alguém acertar com o vendedor.
   */
  pagas_em_dobro: ContaDuplicada[];
}

const N = PREFIXO_CONTA_COMISSAO.length;

// O status vive no JSON e na coluna. Baixada em qualquer um dos dois conta
// como baixada; cancelada só vale pelo JSON, que é o que as telas leem.
const ESTADO = (t: string) => `UPPER(COALESCE(NULLIF(${t}.data->>'status', ''), ${t}.status, ''))`;
const BAIXADA = (t: string) =>
  `(${ESTADO(t)} IN ('PAGO', 'PARCIAL') OR UPPER(COALESCE(${t}.status, '')) IN ('PAGO', 'PARCIAL'))`;

// Liga cada cp-comissao-<id> à pagar-<id> da mesma agência.
const PAR = `
  FROM contas_pagar cp
  JOIN contas_pagar leg
    ON leg.tenant_id = cp.tenant_id
   AND leg.id = '${PREFIXO_CONTA_LEGADA}' || substr(cp.id, ${N + 1})
  LEFT JOIN comissoes c
    ON c.tenant_id = cp.tenant_id AND c.id = substr(cp.id, ${N + 1})
 WHERE cp.tenant_id = $1
   AND left(cp.id, ${N}) = '${PREFIXO_CONTA_COMISSAO}'
   AND ${ESTADO('leg')} <> 'CANCELADO'`;

const COLUNAS = `
  substr(cp.id, ${N + 1}) AS comissao_id, cp.id AS conta_duplicada_id, leg.id AS conta_mantida_id,
  cp.data->>'valor_final' AS valor,
  COALESCE(NULLIF(c.data->>'vendedor_nome', ''), NULLIF(cp.data->>'fornecedor_nome', ''), NULLIF(leg.data->>'fornecedor_nome', ''), '') AS vendedor,
  ${ESTADO('leg')} AS status_da_mantida`;

/** O valor como o JSON o guarda ("420.5"): Number, não o leitor de dinheiro
 *  digitado, que leria o ponto como milhar. */
const dinheiro = (v: unknown) => (Number.isFinite(Number(v)) ? round2(Number(v)) : 0);

function item(r: Record<string, unknown>): ContaDuplicada {
  return {
    comissao_id: String(r.comissao_id ?? ''),
    conta_duplicada_id: String(r.conta_duplicada_id ?? ''),
    conta_mantida_id: String(r.conta_mantida_id ?? ''),
    valor: dinheiro(r.valor),
    vendedor: String(r.vendedor ?? ''),
    status_da_mantida: String(r.status_da_mantida ?? ''),
  };
}

/** O que está em dobro hoje, sem mudar nada. */
export async function listarContasDuplicadas(exec: ExecutorSQL, tenantId: string): Promise<ResumoDuplicadas> {
  const [{ rows: abertas }, { rows: pagas }] = await Promise.all([
    exec.query(
      `SELECT ${COLUNAS} ${PAR}
         AND ${ESTADO('cp')} <> 'CANCELADO' AND NOT ${BAIXADA('cp')}
       ORDER BY cp.id`,
      [tenantId],
    ),
    exec.query(
      `SELECT ${COLUNAS} ${PAR}
         AND ${BAIXADA('cp')} AND ${BAIXADA('leg')}
       ORDER BY cp.id`,
      [tenantId],
    ),
  ]);
  const itens = abertas.map(item);
  return {
    quantidade: itens.length,
    valor_total: round2(itens.reduce((t, i) => t + i.valor, 0)),
    itens,
    pagas_em_dobro: pagas.map(item),
  };
}

/**
 * Cancela exatamente as duplicadas listadas acima, num UPDATE só. A condição
 * é refeita dentro do próprio UPDATE: a conta que alguém baixou entre a lista
 * e o clique não é cancelada, e rodar de novo não acha mais nada.
 */
export async function cancelarContasDuplicadas(
  exec: ExecutorSQL,
  tenantId: string,
  hoje: string,
): Promise<{ canceladas: number; valor_total: number; ids: string[] }> {
  const { rows } = await exec.query(
    `UPDATE contas_pagar AS alvo
        SET status = 'CANCELADO',
            updated_at = NOW(),
            data = alvo.data || jsonb_build_object(
              'status', 'CANCELADO',
              'observacoes', btrim(COALESCE(alvo.data->>'observacoes', '') || ' ' ||
                'Cancelada em ' || $2::text || ': duplicava a conta ' || par.conta_mantida_id ||
                ', que é a conta a pagar desta comissão.'),
              'cancelada_por_duplicidade', jsonb_build_object('em', $2::text, 'conta_mantida_id', par.conta_mantida_id)
            )
       FROM (
         SELECT cp.id, leg.id AS conta_mantida_id ${PAR}
            AND ${ESTADO('cp')} <> 'CANCELADO' AND NOT ${BAIXADA('cp')}
       ) AS par
      WHERE alvo.id = par.id AND alvo.tenant_id = $1
        AND ${ESTADO('alvo')} <> 'CANCELADO' AND NOT ${BAIXADA('alvo')}
      RETURNING alvo.id, alvo.data->>'valor_final' AS valor`,
    [tenantId, hoje],
  );
  return {
    canceladas: rows.length,
    valor_total: round2(rows.reduce((t, r) => t + dinheiro(r.valor), 0)),
    ids: rows.map(r => String(r.id)).sort(),
  };
}
