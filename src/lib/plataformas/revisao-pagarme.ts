/**
 * Revisão única dos recebimentos do Pagar.me (08/10/2026).
 *
 * O que a versão anterior gravou, e o que esta revisão corrige:
 *
 *   1. A mesma compra em duas transações: o aviso do pedido (or_) e o da
 *      cobrança (ch_) viravam duas vendas, cada uma com as suas contas. A do
 *      pedido absorve a da cobrança (contas canceladas, caixa devolvido).
 *   2. Venda antecipada em 12 contas: com a antecipação ligada, vira UM
 *      lançamento na data do repasse.
 *   3. Pagamento sem dono que tem venda no CRM: a conciliação é refeita pela
 *      mesma régua (prova ou CPF/CNPJ com a opção automática: vincula;
 *      parecido: sugestão). "Venda direta" marcada por uma pessoa não é
 *      reaberta.
 *
 * Conta que uma pessoa tocou (conciliada, com nota, baixada à mão) faz a
 * venda ser pulada e listada. Roda uma vez por agência depois do boot e é
 * idempotente: repetir não muda nada.
 */
import pool from '../db';
import { emTransacao, type ExecutorSQL } from '../caixa-atomico';
import { round2, num } from '../money';
import { em } from './comum';
import { idDoPedido, idsDaVenda } from './pagarme';
import {
  antecipadoPorPadrao, candidatosDoCrm, resolverTransacao, sanearParcelasAntecipadas,
} from './servico';
import { decidir, type PagamentoParaConciliar } from './conciliacao';
import { vincularNaTransacao } from './fila';
import type { TransacaoNormalizada } from './tipos';

export const CHAVE_REVISAO_PAGARME = 'pagarme-2026-10-08';

export interface ResumoRevisaoPagarme {
  executado_em: string;
  transacoes: number;
  duplicatas_absorvidas: number;
  unificadas: number;
  vinculadas: number;
  sugeridas: number;
  caixa_movido: number;
  puladas: Array<{ id_transacao: string; comprador: string; valor: number; motivo: string }>;
  erros: string[];
}

/** Os ids da venda, tirados do aviso cru que ficou gravado. */
export function idsDoAvisoGravado(transacao: TransacaoNormalizada): { pedido: string; ids: string[] } {
  const bruto = (transacao.bruto ?? {}) as Record<string, unknown>;
  const tipo = String(bruto.type ?? '');
  const dados = em(bruto, 'data') ?? {};
  const cobrancas = (em(dados, 'charges') as unknown[]) ?? [];
  const pedido = idDoPedido(tipo, dados) || transacao.id_transacao;
  const ids = [...new Set([transacao.id_transacao, pedido, ...(transacao.ids_alternativos ?? []), ...idsDaVenda(dados, cobrancas)]
    .map(i => String(i ?? '').trim()).filter(Boolean))];
  return { pedido, ids };
}

async function reconciliar(
  exec: ExecutorSQL, tenantId: string, idTransacao: string, automatica: boolean,
): Promise<'vinculada' | 'sugerida' | 'nada'> {
  const { rows } = await exec.query(
    `SELECT status_conciliacao, venda_id, data FROM plataformas_transacoes
      WHERE tenant_id = $1 AND plataforma = 'pagarme' AND id_transacao = $2 LIMIT 1 FOR UPDATE`,
    [tenantId, idTransacao],
  );
  if (rows.length === 0) return 'nada';
  const status = String(rows[0].status_conciliacao ?? '');
  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  if (String(rows[0].venda_id ?? '') || !['PENDENTE', 'SUGERIDA', 'DIRETA'].includes(status) || d.direta_por_pessoa === true) return 'nada';
  const transacao = d.transacao as TransacaoNormalizada | undefined;
  if (!transacao) return 'nada';
  const dataPagamento = transacao.parcelas?.find(p => p.data_pagamento)?.data_pagamento || transacao.data_venda || '';
  const pagamento: PagamentoParaConciliar = {
    id_transacao: idTransacao,
    ids: transacao.ids_alternativos,
    documento: transacao.comprador?.documento ?? '',
    email: transacao.comprador?.email ?? '',
    telefone: transacao.comprador?.telefone ?? '',
    valor: round2(num(transacao.valor_bruto)),
    data: dataPagamento,
  };
  const candidatos = await candidatosDoCrm(exec, tenantId, transacao, dataPagamento);
  // "Venda direta" do robô só queria dizer "ninguém parecido na hora": segue
  // a mesma régua. A marcada por uma pessoa já foi filtrada acima.
  const decisao = decidir(pagamento, candidatos, { vincularAutomatico: automatica });
  if (decisao.acao === 'VINCULAR' && decisao.escolhida) {
    await vincularNaTransacao(exec, tenantId, 'pagarme', idTransacao, decisao.escolhida.venda_id, { manterCarimbo: true });
    return 'vinculada';
  }
  if (decisao.acao === 'SUGERIR') {
    await exec.query(
      `UPDATE plataformas_transacoes
          SET status_conciliacao = 'SUGERIDA', data = data || jsonb_build_object('conciliacao', $3::jsonb), updated_at = NOW()
        WHERE tenant_id = $1 AND plataforma = 'pagarme' AND id_transacao = $2`,
      [tenantId, idTransacao, JSON.stringify(decisao)],
    );
    return 'sugerida';
  }
  return 'nada';
}

export async function revisarPagarmeDoTenant(tenantId: string, executor?: ExecutorSQL): Promise<ResumoRevisaoPagarme> {
  const resumo: ResumoRevisaoPagarme = {
    executado_em: new Date().toISOString(), transacoes: 0, duplicatas_absorvidas: 0, unificadas: 0,
    vinculadas: 0, sugeridas: 0, caixa_movido: 0, puladas: [], erros: [],
  };
  const db = executor ?? (pool as unknown as ExecutorSQL | null);
  if (!db) return resumo;
  // Com executor injetado (teste) tudo roda nele; sem, uma transação de banco por venda.
  const emUma = <T,>(fn: (exec: ExecutorSQL) => Promise<T>) => (executor ? fn(executor) : emTransacao(fn));

  const { rows: conf } = await db.query(
    `SELECT data FROM plataformas_config WHERE tenant_id = $1 AND plataforma = 'pagarme' LIMIT 1`,
    [tenantId],
  );
  const c = (conf[0]?.data ?? {}) as Record<string, unknown>;
  const conta = String(c.conta_bancaria_id ?? '') || null;
  const antecipado = antecipadoPorPadrao('pagarme', c.recebimento_antecipado);
  const automatica = c.conciliacao_automatica === true;

  const { rows: txs } = await db.query(
    `SELECT id_transacao FROM plataformas_transacoes
      WHERE tenant_id = $1 AND plataforma = 'pagarme' AND status_conciliacao <> 'ABSORVIDA'
      ORDER BY created_at, id`,
    [tenantId],
  );
  resumo.transacoes = txs.length;

  // 1) Ids e duplicatas.
  for (const t of txs) {
    const id = String(t.id_transacao);
    try {
      await emUma(async exec => {
        const { rows } = await exec.query(
          `SELECT status_conciliacao, data FROM plataformas_transacoes
            WHERE tenant_id = $1 AND plataforma = 'pagarme' AND id_transacao = $2 LIMIT 1 FOR UPDATE`,
          [tenantId, id],
        );
        if (rows.length === 0 || String(rows[0].status_conciliacao) === 'ABSORVIDA') return;
        const transacao = ((rows[0].data ?? {}) as Record<string, unknown>).transacao as TransacaoNormalizada | undefined;
        if (!transacao) return;
        const { pedido, ids } = idsDoAvisoGravado(transacao);
        await exec.query(
          `UPDATE plataformas_transacoes
              SET data = jsonb_set(data, '{transacao,ids_alternativos}', $3::jsonb, true), updated_at = NOW()
            WHERE tenant_id = $1 AND plataforma = 'pagarme' AND id_transacao = $2`,
          [tenantId, id, JSON.stringify(ids)],
        );
        const r = await resolverTransacao(exec, tenantId, 'pagarme', { ...transacao, id_transacao: pedido, ids_alternativos: ids }, conta);
        resumo.duplicatas_absorvidas += r.absorvidas.length;
        // A principal passa a conhecer os ids da que ela absorveu (o link de
        // pagamento, por exemplo): é por eles que a venda do CRM a acha.
        await exec.query(
          `UPDATE plataformas_transacoes
              SET data = jsonb_set(data, '{transacao,ids_alternativos}', $3::jsonb, true), updated_at = NOW()
            WHERE tenant_id = $1 AND plataforma = 'pagarme' AND id_transacao = $2`,
          [tenantId, r.id, JSON.stringify(r.ids)],
        );
      });
    } catch (e) {
      resumo.erros.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2) Um lançamento por venda antecipada, e 3) a conciliação refeita.
  const { rows: vivas } = await db.query(
    `SELECT id_transacao FROM plataformas_transacoes
      WHERE tenant_id = $1 AND plataforma = 'pagarme' AND status_conciliacao <> 'ABSORVIDA'
      ORDER BY created_at, id`,
    [tenantId],
  );
  for (const t of vivas) {
    const id = String(t.id_transacao);
    try {
      if (antecipado) {
        const r = await emUma(exec => sanearParcelasAntecipadas(exec, tenantId, 'pagarme', id, conta));
        if (r.estado === 'corrigida') {
          resumo.unificadas++;
          resumo.caixa_movido = round2(resumo.caixa_movido + r.caixa_movido);
        } else if (r.estado === 'pulada') {
          resumo.puladas.push({ id_transacao: id, comprador: r.comprador ?? '', valor: r.valor ?? 0, motivo: r.pulada ?? '' });
        }
      }
      const rc = await emUma(exec => reconciliar(exec, tenantId, id, automatica));
      if (rc === 'vinculada') resumo.vinculadas++;
      if (rc === 'sugerida') resumo.sugeridas++;
    } catch (e) {
      resumo.erros.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await db.query(
    `INSERT INTO plataformas_revisoes (tenant_id, chave, status, resultado, executado_em)
     VALUES ($1, $2, 'CONCLUIDA', $3::jsonb, NOW())
     ON CONFLICT (tenant_id, chave) DO UPDATE SET status = 'CONCLUIDA', resultado = EXCLUDED.resultado, executado_em = NOW()`,
    [tenantId, CHAVE_REVISAO_PAGARME, JSON.stringify(resumo)],
  );
  return resumo;
}

/** Depois do boot: cada agência com Pagar.me, uma vez. Dois processos não rodam a mesma. */
export async function revisarPagarmeUmaVez(): Promise<void> {
  if (!pool) return;
  const { rows } = await pool.query(`SELECT DISTINCT tenant_id FROM plataformas_transacoes WHERE plataforma = 'pagarme'`);
  for (const r of rows) {
    const tenantId = String(r.tenant_id);
    const { rows: pego } = await pool.query(
      `INSERT INTO plataformas_revisoes (tenant_id, chave, status) VALUES ($1, $2, 'RODANDO')
       ON CONFLICT (tenant_id, chave) DO NOTHING RETURNING tenant_id`,
      [tenantId, CHAVE_REVISAO_PAGARME],
    );
    if (pego.length === 0) continue;
    const resumo = await revisarPagarmeDoTenant(tenantId);
    console.log(`[revisao-pagarme] ${tenantId}: ${resumo.duplicatas_absorvidas} duplicatas, ${resumo.unificadas} unificadas, ${resumo.vinculadas} vinculadas, ${resumo.sugeridas} sugeridas, ${resumo.puladas.length} puladas, ${resumo.erros.length} erros`);
  }
}
