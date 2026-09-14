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
import { num, round2, somaPor } from './money';

const EMPTY: DadosReaisAgencia = {
  ticket_medio: 0,
  taxa_proposta_aceita: 0,
  cac_medio: 0,
  margem_minima: 0,
  investimento_marketing: 0,
  ultima_atualizacao: new Date().toISOString(),
};

type JsonObject = Record<string, unknown>;

function objeto(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function numeroNaoNegativo(value: unknown): number {
  return round2(Math.max(0, num(value)));
}

/** Drivers PostgreSQL devolvem NUMERIC como string decimal SQL (às vezes com
 * várias casas). Não usar o parser monetário pt-BR aqui: `"8000.0000"` seria
 * interpretado como separador de milhar. */
function numeroDecimalDoBanco(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return round2(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
}

/**
 * O planejamento persiste marketing como uma lista de canais. A integração
 * antiga aplicava `Number()` na lista inteira, o que devolvia NaN e fazia o
 * investimento real desaparecer do simulador de funis.
 *
 * Os campos escalares ficam como fallback para payloads anteriores ao modelo
 * por canal. Quando a lista existe, inclusive vazia/zerada, ela é a fonte da
 * verdade e não deve ser substituída por um total legado possivelmente velho.
 */
export function investimentoMarketingDoPlano(value: unknown): number {
  const data = objeto(value);
  if (!data) return 0;

  if (Array.isArray(data.marketing)) {
    return somaPor(data.marketing, item => {
      const row = objeto(item);
      return row ? numeroNaoNegativo(row.valor) : 0;
    });
  }

  for (const campo of ['investimento_marketing', 'marketing_total', 'marketing']) {
    if (data[campo] !== null && data[campo] !== undefined && data[campo] !== '') {
      return numeroNaoNegativo(data[campo]);
    }
  }
  return 0;
}

export async function getDadosReaisAgencia(tenantId: string): Promise<DadosReaisAgencia> {
  if (!pool) return { ...EMPTY, ultima_atualizacao: new Date().toISOString() };

  // 1. Ticket médio — média dos valores das vendas fechadas.
  // A tabela `vendas_crm` tem `status` coluna + valor dentro de `data` JSONB.
  let ticket_medio = 0;
  try {
    const { rows } = await pool.query(
      `SELECT AVG(
         CASE WHEN valor_txt ~ '^[0-9]+([.][0-9]+)?$'
           THEN valor_txt::numeric
           ELSE NULL
         END
       ) AS media
       FROM (
         SELECT COALESCE(
           NULLIF(data->>'valor_final', ''),
           NULLIF(data->>'valor_total_venda', ''),
           NULLIF(data->>'valor_total', '')
         ) AS valor_txt
         FROM vendas_crm
         WHERE tenant_id = $1
           AND UPPER(COALESCE(status, '')) IN (
             'CONFIRMADO', 'CONCLUIDO', 'FECHADA', 'PAGA', 'CONCLUIDA'
           )
       ) vendas_validas`,
      [tenantId],
    );
    ticket_medio = numeroDecimalDoBanco(rows[0]?.media);
  } catch {
    ticket_medio = 0;
  }

  // 2. Taxa de propostas aceitas — APROVADA / total.
  let taxa_proposta_aceita = 0;
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) IN
           ('ACEITO', 'CONVERTIDO', 'APROVADA', 'ACEITA')) AS aceitas,
         COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) <> 'RASCUNHO') AS enviadas
       FROM propostas WHERE tenant_id = $1`,
      [tenantId],
    );
    const aceitas = parseInt(rows[0]?.aceitas ?? '0', 10);
    const enviadas = parseInt(rows[0]?.enviadas ?? '0', 10);
    taxa_proposta_aceita = enviadas > 0 ? round2((aceitas / enviadas) * 100) : 0;
  } catch {
    taxa_proposta_aceita = 0;
  }

  // 3. CAC médio — do cac_mensal mais recente.
  let cac_medio = 0;
  try {
    const { rows } = await pool.query(
      `SELECT data FROM cac_mensal
       WHERE tenant_id = $1 AND mes <= TO_CHAR(CURRENT_DATE, 'YYYY-MM')
       ORDER BY mes DESC LIMIT 1`,
      [tenantId],
    );
    const d = rows[0]?.data;
    if (d) {
      cac_medio = numeroNaoNegativo(d.cac ?? d.cac_medio ?? d.cac_calculado);
    }
  } catch {
    cac_medio = 0;
  }

  // 4. Margem mínima + investimento marketing — do planejamento_custos mais recente.
  let margem_minima = 0;
  let investimento_marketing = 0;
  try {
    const { rows } = await pool.query(
      `SELECT data FROM planejamento_custos
       WHERE tenant_id = $1 AND mes <= TO_CHAR(CURRENT_DATE, 'YYYY-MM')
       ORDER BY mes DESC LIMIT 1`,
      [tenantId],
    );
    const d = rows[0]?.data;
    if (d) {
      margem_minima = Math.min(100, numeroNaoNegativo(d.margem_minima ?? d.margem_comissao));
      investimento_marketing = investimentoMarketingDoPlano(d);
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
