-- Vendas importadas do CRM que não geraram as contas que deveriam.
--
-- SOMENTE LEITURA. Roda no terminal do banco de produção (Coolify).
--
-- Contexto: até 2026-09-08 o webhook VENDA_FECHADA marcava cada fornecedor
-- detalhado pelo CRM como meio_pagamento='fornecedor' (cliente pagaria direto
-- ao fornecedor, agência só receberia comissão). Como o CRM manda comissão
-- zero, essas vendas não geraram conta NENHUMA — nem a pagar, nem a receber.
-- E quando o CRM não detalhava fornecedor, a conta a pagar era omitida.
--
-- O código novo corrige a geração. Ele NÃO reescreve o que já está gravado:
-- para consertar uma venda antiga é preciso reemitir VENDA_FECHADA do CRM
-- (a regeneração preserva contas já baixadas).

-- ── 1. Vendas do CRM sem conta a pagar apesar de terem custo ──────────
SELECT
  v.tenant_id,
  v.id                                                        AS venda_id,
  v.data->>'crm_venda_id'                                     AS crm_venda,
  v.data->>'numero'                                           AS numero,
  v.data->>'data_venda'                                       AS data_venda,
  COALESCE(NULLIF(v.data->>'valor_total_venda','')::numeric, 0) AS valor_venda,
  COALESCE(NULLIF(v.data->>'valor_total_custo','')::numeric, 0) AS valor_custo,
  (SELECT COUNT(*) FROM contas_pagar p
    WHERE p.tenant_id = v.tenant_id
      AND p.data->>'origem_venda_id' = v.id)                  AS qtd_a_pagar,
  (SELECT COUNT(*) FROM contas_receber r
    WHERE r.tenant_id = v.tenant_id
      AND r.data->>'origem_venda_id' = v.id)                  AS qtd_a_receber
FROM vendas_crm v
WHERE v.data->>'origem' = 'crm'
  AND COALESCE(NULLIF(v.data->>'valor_total_custo','')::numeric, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM contas_pagar p
     WHERE p.tenant_id = v.tenant_id
       AND p.data->>'origem_venda_id' = v.id
  )
ORDER BY v.created_at DESC
LIMIT 200;

-- ── 2. Vendas do CRM que não geraram conta a receber nenhuma ──────────
--     Sintoma do modelo antigo de comissão: o cliente devia à agência,
--     mas nada foi lançado.
SELECT
  v.tenant_id,
  COUNT(*)                                                        AS vendas,
  SUM(COALESCE(NULLIF(v.data->>'valor_total_venda','')::numeric, 0)) AS valor_nao_lancado
FROM vendas_crm v
WHERE v.data->>'origem' = 'crm'
  AND COALESCE(NULLIF(v.data->>'valor_total_venda','')::numeric, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM contas_receber r
     WHERE r.tenant_id = v.tenant_id
       AND r.data->>'origem_venda_id' = v.id
  )
GROUP BY v.tenant_id
ORDER BY valor_nao_lancado DESC;

-- ── 3. Contas a pagar genéricas do modelo antigo ──────────────────────
--     "fornecedor(es) a detalhar" era o lançamento agregado anterior.
--     Hoje a conta nasce com fornecedor_pendente e descrição explícita.
SELECT
  tenant_id,
  COALESCE(data->>'status','')                                  AS situacao,
  COUNT(*)                                                      AS qtd,
  SUM(COALESCE(NULLIF(data->>'valor_final','')::numeric, 0))    AS total
FROM contas_pagar
WHERE COALESCE(data->>'auto_gerado','') = 'true'
  AND COALESCE(data->>'fornecedor_nome','') = ''
GROUP BY 1, 2
ORDER BY total DESC;

-- ── 4. Contas a pagar hoje sem fornecedor, em aberto ──────────────────
--     É o que a tela de contas a pagar mostra no aviso amarelo.
SELECT
  tenant_id,
  data->>'origem_venda_id'                                      AS venda_id,
  data->>'descricao'                                            AS descricao,
  data->>'data_vencimento'                                      AS vencimento,
  COALESCE(NULLIF(data->>'valor_final','')::numeric, 0)         AS valor
FROM contas_pagar
WHERE COALESCE(data->>'fornecedor_nome','') = ''
  AND COALESCE(data->>'status','') IN ('PENDENTE', 'PARCIAL')
ORDER BY data->>'data_vencimento'
LIMIT 200;
