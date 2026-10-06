/**
 * Revisão única dos recebimentos da Hotmart (06/10/2026).
 *
 * Aplica as regras de hotmart-regras.ts ao que a versão anterior gravou:
 * cobrança não paga deixa de ser conta aberta, venda parcelada vira um
 * recebimento, conta antiga duplicada é cancelada. Roda uma vez por agência
 * depois do boot e pode ser repetida pela tela (é idempotente). O resultado
 * fica em plataformas_revisoes para a tela mostrar o que foi corrigido e o
 * que foi pulado porque alguém já tinha mexido.
 */
import pool from '../db';
import { emTransacao } from '../caixa-atomico';
import { round2 } from '../money';
import { sanearTransacaoHotmart } from './servico';

export const CHAVE_REVISAO_HOTMART = 'hotmart-2026-10-06';

export interface ResumoRevisaoHotmart {
  executado_em: string;
  transacoes: number;
  corrigidas: number;
  nao_pagas: number;
  unificadas: number;
  duplicatas: number;
  contas_canceladas: number;
  caixa_movido: number;
  puladas: Array<{ id_transacao: string; comprador: string; valor: number; motivo: string }>;
  erros: string[];
}

export async function revisarHotmartDoTenant(tenantId: string): Promise<ResumoRevisaoHotmart> {
  const resumo: ResumoRevisaoHotmart = {
    executado_em: new Date().toISOString(), transacoes: 0, corrigidas: 0, nao_pagas: 0, unificadas: 0,
    duplicatas: 0, contas_canceladas: 0, caixa_movido: 0, puladas: [], erros: [],
  };
  if (!pool) return resumo;
  const { rows: conf } = await pool.query(
    `SELECT data->>'conta_bancaria_id' AS conta FROM plataformas_config WHERE tenant_id = $1 AND plataforma = 'hotmart' LIMIT 1`,
    [tenantId],
  );
  const conta = String(conf[0]?.conta ?? '') || null;
  const { rows: txs } = await pool.query(
    `SELECT id_transacao FROM plataformas_transacoes WHERE tenant_id = $1 AND plataforma = 'hotmart' ORDER BY created_at`,
    [tenantId],
  );
  resumo.transacoes = txs.length;
  for (const t of txs) {
    const id = String(t.id_transacao);
    try {
      // Uma transação de banco por venda: uma que falhe não desfaz as outras.
      const r = await emTransacao(exec => sanearTransacaoHotmart(exec, tenantId, id, conta));
      if (r.estado === 'corrigida') {
        resumo.corrigidas++;
        if (r.motivos.includes('NAO_PAGA')) resumo.nao_pagas++;
        if (r.motivos.includes('PARCELAS_UNIFICADAS')) resumo.unificadas++;
        if (r.motivos.includes('DUPLICATA_DA_CONTA_ANTIGA')) resumo.duplicatas++;
        resumo.contas_canceladas += r.canceladas;
        resumo.caixa_movido = round2(resumo.caixa_movido + r.caixa_movido);
      } else if (r.estado === 'pulada') {
        resumo.puladas.push({ id_transacao: id, comprador: r.comprador ?? '', valor: r.valor ?? 0, motivo: r.pulada ?? '' });
      }
    } catch (e) {
      resumo.erros.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await pool.query(
    `INSERT INTO plataformas_revisoes (tenant_id, chave, status, resultado, executado_em)
     VALUES ($1, $2, 'CONCLUIDA', $3::jsonb, NOW())
     ON CONFLICT (tenant_id, chave) DO UPDATE SET status = 'CONCLUIDA', resultado = EXCLUDED.resultado, executado_em = NOW()`,
    [tenantId, CHAVE_REVISAO_HOTMART, JSON.stringify(resumo)],
  );
  return resumo;
}

/** Depois do boot: cada agência com Hotmart, uma vez. Dois processos não rodam a mesma. */
export async function revisarHotmartUmaVez(): Promise<void> {
  if (!pool) return;
  const { rows } = await pool.query(`SELECT DISTINCT tenant_id FROM plataformas_transacoes WHERE plataforma = 'hotmart'`);
  for (const r of rows) {
    const tenantId = String(r.tenant_id);
    const { rows: pego } = await pool.query(
      `INSERT INTO plataformas_revisoes (tenant_id, chave, status) VALUES ($1, $2, 'RODANDO')
       ON CONFLICT (tenant_id, chave) DO NOTHING RETURNING tenant_id`,
      [tenantId, CHAVE_REVISAO_HOTMART],
    );
    if (pego.length === 0) continue;
    const resumo = await revisarHotmartDoTenant(tenantId);
    console.log(`[revisao-hotmart] ${tenantId}: ${resumo.corrigidas} corrigidas, ${resumo.puladas.length} puladas, ${resumo.erros.length} erros`);
  }
}

export async function ultimaRevisaoHotmart(tenantId: string): Promise<ResumoRevisaoHotmart | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT status, resultado FROM plataformas_revisoes WHERE tenant_id = $1 AND chave = $2 LIMIT 1`,
    [tenantId, CHAVE_REVISAO_HOTMART],
  );
  if (rows.length === 0 || rows[0].status !== 'CONCLUIDA') return null;
  return rows[0].resultado as ResumoRevisaoHotmart;
}
