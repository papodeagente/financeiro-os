/**
 * Leitura e decisão sobre os recebimentos das plataformas.
 *
 * Tudo aqui sai de `plataformas_transacoes`, que é o retrato atual da
 * venda na plataforma. Nenhum número é recalculado a partir de outra
 * fonte: duas fontes para o mesmo valor é a classe de defeito mais cara
 * deste sistema, e já apareceu no relatório de receita do billing.
 *
 * O período de cada pergunta é diferente de propósito:
 * "quanto vendemos" olha a data da venda; "quanto recebemos" olha a data
 * em que o dinheiro caiu. Usar uma data só faz o mês fechar errado.
 */
import pool from '../db';
import { round2, num } from '../money';
import { emTransacao, type ExecutorSQL } from '../caixa-atomico';
import { ErroPlataforma } from './servico';
import type { TransacaoNormalizada } from './tipos';
import type { Decisao } from './conciliacao';

/** Cast defensivo: JSONB legado pode guardar número como texto. */
const N = (campo: string) =>
  `CASE WHEN jsonb_typeof(par->'${campo}') = 'number' THEN (par->>'${campo}')::numeric ELSE 0 END`;

const PARCELAS = `
  FROM plataformas_transacoes t,
       LATERAL jsonb_array_elements(COALESCE(t.data->'transacao'->'parcelas', '[]'::jsonb)) par
 WHERE t.tenant_id = $1`;

export interface ResumoRecebimentos {
  vendido: number;
  recebido: number;
  a_receber: number;
  taxas: number;
  estornado: number;
  /** O que entrou no caixa: o líquido do que foi recebido. */
  caixa: number;
  de_venda_crm: number;
  de_venda_direta: number;
  aguardando_conciliacao: number;
  por_plataforma: Array<{ plataforma: string; vendido: number; recebido: number; a_receber: number; taxas: number }>;
}

/**
 * As perguntas do painel, todas no mesmo lugar e na mesma fonte.
 *
 * `vendido` exclui o que morreu (cancelado, estornado, chargeback): venda
 * desfeita não é venda. O estornado aparece na sua própria linha, para a
 * conta continuar visível em vez de sumir.
 */
export async function resumoRecebimentos(
  tenantId: string,
  periodo: { de: string; ate: string },
): Promise<ResumoRecebimentos> {
  const vazio: ResumoRecebimentos = {
    vendido: 0, recebido: 0, a_receber: 0, taxas: 0, estornado: 0, caixa: 0,
    de_venda_crm: 0, de_venda_direta: 0, aguardando_conciliacao: 0, por_plataforma: [],
  };
  if (!pool) return vazio;

  const dataVenda = `COALESCE(NULLIF(t.data->'transacao'->>'data_venda', ''), to_char(t.created_at, 'YYYY-MM-DD'))`;
  const recebimento = `NULLIF(par->>'data_recebimento', '')`;
  const morta = `par->>'status' IN ('CANCELADO', 'ESTORNADO', 'CHARGEBACK')`;
  const noPeriodoVenda = `${dataVenda} BETWEEN $2 AND $3`;
  const noPeriodoCaixa = `${recebimento} BETWEEN $2 AND $3`;

  const { rows } = await pool.query(
    `SELECT t.plataforma,
            t.status_conciliacao,
            COALESCE(SUM(${N('valor_bruto')})   FILTER (WHERE NOT ${morta} AND ${noPeriodoVenda}), 0) AS vendido,
            COALESCE(SUM(${N('valor_liquido')}) FILTER (WHERE par->>'status' = 'RECEBIDO' AND ${noPeriodoCaixa}), 0) AS recebido,
            COALESCE(SUM(${N('valor_liquido')}) FILTER (WHERE par->>'status' IN ('PENDENTE','CONFIRMADO','ATRASADO')), 0) AS a_receber,
            COALESCE(SUM(${N('valor_taxa')})    FILTER (WHERE NOT ${morta} AND ${noPeriodoVenda}), 0) AS taxas,
            COALESCE(SUM(${N('valor_bruto')})   FILTER (WHERE par->>'status' IN ('ESTORNADO','CHARGEBACK') AND ${noPeriodoVenda}), 0) AS estornado
       ${PARCELAS}
      GROUP BY t.plataforma, t.status_conciliacao`,
    [tenantId, periodo.de, periodo.ate],
  );

  const saida = { ...vazio, por_plataforma: [] as ResumoRecebimentos['por_plataforma'] };
  const porPlataforma = new Map<string, ResumoRecebimentos['por_plataforma'][number]>();

  for (const r of rows) {
    const vendido = round2(num(r.vendido));
    const recebido = round2(num(r.recebido));
    const aReceber = round2(num(r.a_receber));
    const taxas = round2(num(r.taxas));

    saida.vendido = round2(saida.vendido + vendido);
    saida.recebido = round2(saida.recebido + recebido);
    saida.a_receber = round2(saida.a_receber + aReceber);
    saida.taxas = round2(saida.taxas + taxas);
    saida.estornado = round2(saida.estornado + num(r.estornado));

    const conciliacao = String(r.status_conciliacao ?? '');
    if (conciliacao === 'VINCULADA') saida.de_venda_crm = round2(saida.de_venda_crm + vendido);
    else if (conciliacao === 'DIRETA') saida.de_venda_direta = round2(saida.de_venda_direta + vendido);
    else saida.aguardando_conciliacao = round2(saida.aguardando_conciliacao + vendido);

    const chave = String(r.plataforma ?? '');
    const atual = porPlataforma.get(chave) ?? { plataforma: chave, vendido: 0, recebido: 0, a_receber: 0, taxas: 0 };
    porPlataforma.set(chave, {
      plataforma: chave,
      vendido: round2(atual.vendido + vendido),
      recebido: round2(atual.recebido + recebido),
      a_receber: round2(atual.a_receber + aReceber),
      taxas: round2(atual.taxas + taxas),
    });
  }

  // O caixa é o líquido do que foi recebido. É o mesmo número de
  // `recebido` por construção, e está aqui com nome próprio porque a
  // pergunta "quanto entrou no caixa" é feita separada no painel.
  saida.caixa = saida.recebido;
  saida.por_plataforma = [...porPlataforma.values()].sort((a, b) => b.vendido - a.vendido);
  return saida;
}

export interface ItemRecebimento {
  plataforma: string;
  id_transacao: string;
  status_conciliacao: string;
  venda_id: string;
  venda_numero: string;
  cliente_id: string;
  comprador: string;
  documento: string;
  email: string;
  descricao: string;
  data_venda: string;
  bruto: number;
  taxa: number;
  liquido: number;
  recebido: number;
  a_receber: number;
  parcelas: number;
  parcelas_recebidas: number;
  proxima_previsao: string;
  conciliacao: Decisao | null;
  atualizado_em: string;
}

export async function listarRecebimentos(
  tenantId: string,
  filtro: { status?: string; plataforma?: string; busca?: string; limite?: number } = {},
): Promise<ItemRecebimento[]> {
  if (!pool) return [];

  const cond: string[] = ['t.tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (filtro.status) { args.push(filtro.status); cond.push(`t.status_conciliacao = $${args.length}`); }
  if (filtro.plataforma) { args.push(filtro.plataforma); cond.push(`t.plataforma = $${args.length}`); }
  if (filtro.busca) {
    args.push(`%${filtro.busca.toLowerCase()}%`);
    cond.push(`(LOWER(t.data->'transacao'->'comprador'->>'nome') LIKE $${args.length}
             OR LOWER(t.data->'transacao'->'comprador'->>'email') LIKE $${args.length}
             OR LOWER(t.id_transacao) LIKE $${args.length})`);
  }
  args.push(Math.min(500, Math.max(1, filtro.limite ?? 200)));

  const { rows } = await pool.query(
    `SELECT t.plataforma, t.id_transacao, t.status_conciliacao, t.venda_id, t.cliente_id,
            t.data, t.updated_at,
            v.data->>'numero' AS venda_numero
       FROM plataformas_transacoes t
       LEFT JOIN vendas_crm v ON v.id = t.venda_id AND v.tenant_id = t.tenant_id
      WHERE ${cond.join(' AND ')}
      ORDER BY t.updated_at DESC
      LIMIT $${args.length}`,
    args,
  );

  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const transacao = (d.transacao ?? {}) as TransacaoNormalizada;
    const parcelas = transacao.parcelas ?? [];
    const recebidas = parcelas.filter(p => p.status === 'RECEBIDO');
    const aReceber = parcelas.filter(p => ['PENDENTE', 'CONFIRMADO', 'ATRASADO'].includes(p.status));
    const proxima = aReceber
      .map(p => p.data_prevista_recebimento || p.data_vencimento)
      .filter(Boolean)
      .sort()[0] ?? '';

    return {
      plataforma: String(r.plataforma ?? ''),
      id_transacao: String(r.id_transacao ?? ''),
      status_conciliacao: String(r.status_conciliacao ?? ''),
      venda_id: String(r.venda_id ?? ''),
      venda_numero: String(r.venda_numero ?? ''),
      cliente_id: String(r.cliente_id ?? ''),
      comprador: transacao.comprador?.nome ?? '',
      documento: transacao.comprador?.documento ?? '',
      email: transacao.comprador?.email ?? '',
      descricao: transacao.descricao ?? '',
      data_venda: transacao.data_venda ?? '',
      bruto: round2(num(transacao.valor_bruto)),
      taxa: round2(num(transacao.valor_taxa)),
      liquido: round2(num(transacao.valor_liquido)),
      recebido: round2(recebidas.reduce((a, p) => a + num(p.valor_liquido), 0)),
      a_receber: round2(aReceber.reduce((a, p) => a + num(p.valor_liquido), 0)),
      parcelas: parcelas.length,
      parcelas_recebidas: recebidas.length,
      proxima_previsao: proxima,
      conciliacao: (d.conciliacao ?? null) as Decisao | null,
      atualizado_em: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    };
  });
}

/**
 * Vincula o recebimento a uma venda do CRM.
 *
 * Carimba a venda com a transação: da próxima vez que a mesma transação
 * for reprocessada, o vínculo vira PROVA na pontuação, e não indício.
 * Sem isso, reimportar o período reabriria a mesma dúvida.
 */
export async function vincularVenda(
  tenantId: string, plataforma: string, idTransacao: string, vendaId: string,
): Promise<void> {
  if (!pool) throw new ErroPlataforma('Banco indisponível.');
  if (!vendaId) throw new ErroPlataforma('Informe a venda.');

  await emTransacao(async (exec: ExecutorSQL) => {
    const venda = await exec.query(
      `SELECT id FROM vendas_crm WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [vendaId, tenantId],
    );
    if (venda.rows.length === 0) throw new ErroPlataforma('Venda não encontrada nesta agência.');

    const r = await exec.query(
      `UPDATE plataformas_transacoes
          SET venda_id = $4, status_conciliacao = 'VINCULADA', updated_at = NOW()
        WHERE tenant_id = $1 AND plataforma = $2 AND id_transacao = $3`,
      [tenantId, plataforma, idTransacao, vendaId],
    );
    if ((r.rowCount ?? 0) === 0) throw new ErroPlataforma('Recebimento não encontrado.');

    // As contas a receber já criadas passam a apontar para a venda.
    await exec.query(
      `UPDATE contas_receber
          SET venda_id = $4,
              data = jsonb_set(jsonb_set(data, '{venda_id}', to_jsonb($4::text), true),
                               '{origem}', '"VENDA"'::jsonb, true),
              updated_at = NOW()
        WHERE tenant_id = $1
          AND data->>'plataforma_origem' = $2
          AND data->>'plataforma_transacao' = $3`,
      [tenantId, plataforma, idTransacao, vendaId],
    );

    await exec.query(
      `UPDATE vendas_crm
          SET data = jsonb_set(jsonb_set(data, '{plataforma_origem}', to_jsonb($3::text), true),
                               '{plataforma_transacao}', to_jsonb($4::text), true),
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [vendaId, tenantId, plataforma, idTransacao],
    );
  });
}

/** Marca como venda direta: não veio de negociação do CRM, e está certo assim. */
export async function marcarVendaDireta(
  tenantId: string, plataforma: string, idTransacao: string,
): Promise<void> {
  if (!pool) throw new ErroPlataforma('Banco indisponível.');
  await emTransacao(async (exec: ExecutorSQL) => {
    const r = await exec.query(
      `UPDATE plataformas_transacoes
          SET venda_id = '', status_conciliacao = 'DIRETA', updated_at = NOW()
        WHERE tenant_id = $1 AND plataforma = $2 AND id_transacao = $3`,
      [tenantId, plataforma, idTransacao],
    );
    if ((r.rowCount ?? 0) === 0) throw new ErroPlataforma('Recebimento não encontrado.');

    await exec.query(
      `UPDATE contas_receber
          SET venda_id = '',
              data = jsonb_set(jsonb_set(data, '{venda_id}', 'null'::jsonb, true),
                               '{origem}', '"VENDA_DIRETA"'::jsonb, true),
              updated_at = NOW()
        WHERE tenant_id = $1
          AND data->>'plataforma_origem' = $2
          AND data->>'plataforma_transacao' = $3`,
      [tenantId, plataforma, idTransacao],
    );
  });
}
