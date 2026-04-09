/**
 * Consulta dados reais da agência para alimentar o simulador de funis.
 *
 * Leitura-only sobre tabelas existentes (vendas_crm, propostas, cac_mensal,
 * planejamento_custos). Compartilhado entre a rota pública
 * `/api/funis/dados-reais` e o `POST /api/funis/[id]/simular` (quando o
 * toggle `usar_dados_reais` está ativo).
 *
 * Filtro por tenant_id em todas as queries. Sem cache por enquanto — o
 * tempo esperado é <100ms.
 */

import pool from './db';
import type { DadosReaisAgencia } from './funil-types';

const EMPTY: DadosReaisAgencia = {
  ticket_medio: 0,
  taxa_proposta_aceita: 0,
  cac_medio: 0,
  margem_minima: 0,
  investimento_marketing: 0,
  ultima_atualizacao: new Date().toISOString(),
};

export async function getDadosReaisAgencia(tenantId: string): Promise<DadosReaisAgencia> {
  if (!pool) return EMPTY;

  // 1. Ticket médio — média dos valores das vendas fechadas.
  // A tabela `vendas_crm` tem `status` coluna + valor dentro de `data` JSONB.
  let ticket_medio = 0;
  try {
    const { rows } = await pool.query(
      `SELECT AVG((data->>'valor_total')::numeric) AS media
       FROM vendas_crm
       WHERE tenant_id = $1
         AND status IN ('fechada', 'paga', 'concluida')
         AND (data->>'valor_total') IS NOT NULL`,
      [tenantId],
    );
    ticket_medio = parseFloat(rows[0]?.media ?? 0) || 0;
  } catch {
    ticket_medio = 0;
  }

  // 2. Taxa de propostas aceitas — APROVADA / total.
  let taxa_proposta_aceita = 0;
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('APROVADA', 'aprovada', 'ACEITA')) AS aceitas,
         COUNT(*) FILTER (WHERE status NOT IN ('RASCUNHO', 'rascunho')) AS enviadas
       FROM propostas WHERE tenant_id = $1`,
      [tenantId],
    );
    const aceitas = parseInt(rows[0]?.aceitas ?? '0', 10);
    const enviadas = parseInt(rows[0]?.enviadas ?? '0', 10);
    taxa_proposta_aceita = enviadas > 0 ? (aceitas / enviadas) * 100 : 0;
  } catch {
    taxa_proposta_aceita = 0;
  }

  // 3. CAC médio — do cac_mensal mais recente.
  let cac_medio = 0;
  try {
    const { rows } = await pool.query(
      `SELECT data FROM cac_mensal WHERE tenant_id = $1 ORDER BY mes DESC LIMIT 1`,
      [tenantId],
    );
    const d = rows[0]?.data;
    if (d) {
      cac_medio = Number(d.cac) || Number(d.cac_medio) || Number(d.cac_calculado) || 0;
    }
  } catch {
    cac_medio = 0;
  }

  // 4. Margem mínima + investimento marketing — do planejamento_custos mais recente.
  let margem_minima = 0;
  let investimento_marketing = 0;
  try {
    const { rows } = await pool.query(
      `SELECT data FROM planejamento_custos WHERE tenant_id = $1 ORDER BY mes DESC LIMIT 1`,
      [tenantId],
    );
    const d = rows[0]?.data;
    if (d) {
      margem_minima = Number(d.margem_minima) || Number(d.margem_comissao) || 0;
      investimento_marketing = Number(d.investimento_marketing)
        || Number(d.marketing_total)
        || Number(d.marketing)
        || 0;
    }
  } catch {
    margem_minima = 0;
    investimento_marketing = 0;
  }

  return {
    ticket_medio,
    taxa_proposta_aceita,
    cac_medio,
    margem_minima,
    investimento_marketing,
    ultima_atualizacao: new Date().toISOString(),
  };
}
