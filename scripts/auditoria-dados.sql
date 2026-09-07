-- =====================================================================
-- AUDITORIA DE DADOS EXISTENTES — Entur OS Fin
-- =====================================================================
-- SOMENTE LEITURA. Nenhum comando aqui altera dados.
-- Roda no Postgres do financeiro (grupos_os). Cada bloco devolve uma
-- linha por problema encontrado; zero linhas = nada a corrigir.
--
-- Como rodar, pelo terminal do Coolify no container do Postgres:
--   psql -U grupos -d grupos_os -f auditoria-dados.sql
-- ou colando bloco a bloco no psql.
--
-- Ordem de leitura: os blocos 1 a 4 sao os que valem dinheiro. Os
-- demais sao higiene de cadastro.
-- =====================================================================


-- =====================================================================
-- 1) REGISTROS SEM TENANT  (gravidade: CRITICO)
-- ---------------------------------------------------------------------
-- Linha com tenant_id vazio nao aparece para ninguem e, pior, pode ser
-- lida por qualquer consulta que caia no tenant vazio.
-- =====================================================================
SELECT 'contas_receber'   AS tabela, COUNT(*) AS linhas_sem_tenant FROM contas_receber   WHERE COALESCE(tenant_id,'') = ''
UNION ALL SELECT 'contas_pagar',     COUNT(*) FROM contas_pagar     WHERE COALESCE(tenant_id,'') = ''
UNION ALL SELECT 'contas_bancarias', COUNT(*) FROM contas_bancarias WHERE COALESCE(tenant_id,'') = ''
UNION ALL SELECT 'vendas_crm',       COUNT(*) FROM vendas_crm       WHERE COALESCE(tenant_id,'') = ''
UNION ALL SELECT 'itens_venda',      COUNT(*) FROM itens_venda      WHERE COALESCE(tenant_id,'') = ''
UNION ALL SELECT 'comissoes',        COUNT(*) FROM comissoes        WHERE COALESCE(tenant_id,'') = ''
UNION ALL SELECT 'transferencias',   COUNT(*) FROM transferencias   WHERE COALESCE(tenant_id,'') = ''
UNION ALL SELECT 'clientes',         COUNT(*) FROM clientes         WHERE COALESCE(tenant_id,'') = ''
UNION ALL SELECT 'fornecedores_crm', COUNT(*) FROM fornecedores_crm WHERE COALESCE(tenant_id,'') = ''
ORDER BY 2 DESC;


-- =====================================================================
-- 2) DUPLICIDADE DE PARCELAS GERADAS PELA MESMA VENDA  (CRITICO)
-- ---------------------------------------------------------------------
-- A mesma venda gerou a mesma parcela duas vezes. Cada duplicata cobra
-- o cliente de novo e infla o previsto do fluxo de caixa.
-- =====================================================================
SELECT tenant_id,
       data->>'origem_venda_id'  AS venda,
       data->>'parcela_numero'   AS parcela,
       data->>'total_parcelas'   AS de,
       COUNT(*)                  AS vezes,
       SUM((data->>'valor_final')::numeric) AS valor_somado,
       STRING_AGG(id, ', ')      AS ids
  FROM contas_receber
 WHERE COALESCE(data->>'origem_venda_id','') <> ''
   AND COALESCE(data->>'auto_gerado','') = 'true'
   AND COALESCE(data->>'status','') <> 'CANCELADO'
 GROUP BY 1,2,3,4
HAVING COUNT(*) > 1
 ORDER BY valor_somado DESC;

-- Mesmo teste para contas a pagar, por item de venda.
SELECT tenant_id,
       data->>'origem_venda_id' AS venda,
       data->>'origem_item_id'  AS item,
       COUNT(*)                 AS vezes,
       SUM((data->>'valor_final')::numeric) AS valor_somado,
       STRING_AGG(id, ', ')     AS ids
  FROM contas_pagar
 WHERE COALESCE(data->>'origem_item_id','') <> ''
   AND COALESCE(data->>'auto_gerado','') = 'true'
   AND COALESCE(data->>'status','') <> 'CANCELADO'
 GROUP BY 1,2,3
HAVING COUNT(*) > 1
 ORDER BY valor_somado DESC;


-- =====================================================================
-- 3) BAIXA INCOERENTE COM O STATUS  (CRITICO)
-- ---------------------------------------------------------------------
-- O caixa deriva do valor baixado. Estas linhas mentem sobre o caixa.
-- =====================================================================
-- 3a) Quitada mas sem valor recebido/pago e sem valor_final: move zero.
SELECT 'CR quitada sem valor' AS problema, id, tenant_id,
       data->>'status' AS status, data->>'valor_final' AS valor_final,
       data->>'valor_recebido' AS baixado
  FROM contas_receber
 WHERE data->>'status' = 'RECEBIDO'
   AND COALESCE(NULLIF(data->>'valor_recebido','')::numeric, 0) = 0
   AND COALESCE(NULLIF(data->>'valor_final','')::numeric, 0) = 0
UNION ALL
SELECT 'CP quitada sem valor', id, tenant_id,
       data->>'status', data->>'valor_final', data->>'valor_pago'
  FROM contas_pagar
 WHERE data->>'status' = 'PAGO'
   AND COALESCE(NULLIF(data->>'valor_pago','')::numeric, 0) = 0
   AND COALESCE(NULLIF(data->>'valor_final','')::numeric, 0) = 0;

-- 3b) PARCIAL com valor baixado zerado (nao e parcial de nada) ou maior
--     que o valor da conta (recebeu mais do que devia).
SELECT 'CR parcial invalida' AS problema, id, tenant_id,
       data->>'valor_final' AS valor_final, data->>'valor_recebido' AS baixado
  FROM contas_receber
 WHERE data->>'status' = 'PARCIAL'
   AND (COALESCE(NULLIF(data->>'valor_recebido','')::numeric, 0) <= 0
     OR COALESCE(NULLIF(data->>'valor_recebido','')::numeric, 0)
        > COALESCE(NULLIF(data->>'valor_final','')::numeric, 0))
UNION ALL
SELECT 'CP parcial invalida', id, tenant_id,
       data->>'valor_final', data->>'valor_pago'
  FROM contas_pagar
 WHERE data->>'status' = 'PARCIAL'
   AND (COALESCE(NULLIF(data->>'valor_pago','')::numeric, 0) <= 0
     OR COALESCE(NULLIF(data->>'valor_pago','')::numeric, 0)
        > COALESCE(NULLIF(data->>'valor_final','')::numeric, 0));

-- 3c) Pendente mas com data de baixa preenchida (baixa perdida).
SELECT 'CR pendente com data de recebimento' AS problema, id, tenant_id,
       data->>'status' AS status, data->>'data_recebimento' AS baixada_em
  FROM contas_receber
 WHERE COALESCE(data->>'status','') IN ('PENDENTE','ATRASADO')
   AND COALESCE(data->>'data_recebimento','') <> ''
UNION ALL
SELECT 'CP pendente com data de pagamento', id, tenant_id,
       data->>'status', data->>'data_pagamento'
  FROM contas_pagar
 WHERE COALESCE(data->>'status','') IN ('PENDENTE','VENCIDO')
   AND COALESCE(data->>'data_pagamento','') <> '';


-- =====================================================================
-- 4) SALDO BANCARIO PERSISTIDO x SALDO RECALCULADO  (CRITICO)
-- ---------------------------------------------------------------------
-- saldo_atual e um cache. Aqui ele e reconstruido a partir das baixas
-- (incluindo as PARCIAIS) e das transferencias efetivadas. Divergencia
-- significa que alguma tela mostra um saldo que o extrato nao confirma.
-- =====================================================================
WITH entradas AS (
  SELECT tenant_id,
         COALESCE(NULLIF(data->>'conta_bancaria_id',''), '(caixa geral)') AS conta,
         SUM(CASE WHEN data->>'status' = 'PARCIAL'
                  THEN COALESCE(NULLIF(data->>'valor_recebido','')::numeric, 0)
                  ELSE COALESCE(NULLIF(data->>'valor_recebido','')::numeric,
                                NULLIF(data->>'valor_final','')::numeric, 0) END) AS total
    FROM contas_receber
   WHERE data->>'status' IN ('RECEBIDO','PARCIAL')
   GROUP BY 1,2
), saidas AS (
  SELECT tenant_id,
         COALESCE(NULLIF(data->>'conta_bancaria_id',''), '(caixa geral)') AS conta,
         SUM(CASE WHEN data->>'status' = 'PARCIAL'
                  THEN COALESCE(NULLIF(data->>'valor_pago','')::numeric, 0)
                  ELSE COALESCE(NULLIF(data->>'valor_pago','')::numeric,
                                NULLIF(data->>'valor_final','')::numeric, 0) END) AS total
    FROM contas_pagar
   WHERE data->>'status' IN ('PAGO','PARCIAL')
   GROUP BY 1,2
), transf AS (
  SELECT tenant_id, conta_destino_id AS conta,
         SUM(COALESCE(NULLIF(data->>'valor','')::numeric,0)) AS total
    FROM transferencias WHERE data->>'status' = 'EFETIVADA' GROUP BY 1,2
  UNION ALL
  SELECT tenant_id, conta_origem_id,
         -SUM(COALESCE(NULLIF(data->>'valor','')::numeric,0))
    FROM transferencias WHERE data->>'status' = 'EFETIVADA' GROUP BY 1,2
)
SELECT cb.tenant_id,
       cb.id                                                        AS conta_id,
       cb.data->>'nome'                                             AS conta,
       COALESCE(NULLIF(cb.data->>'saldo_atual','')::numeric, 0)     AS saldo_gravado,
       ROUND(COALESCE(NULLIF(cb.data->>'saldo_inicial','')::numeric, 0)
             + COALESCE(e.total,0) - COALESCE(s.total,0)
             + COALESCE(t.total,0), 2)                              AS saldo_recalculado,
       ROUND(COALESCE(NULLIF(cb.data->>'saldo_atual','')::numeric, 0)
             - (COALESCE(NULLIF(cb.data->>'saldo_inicial','')::numeric, 0)
                + COALESCE(e.total,0) - COALESCE(s.total,0)
                + COALESCE(t.total,0)), 2)                          AS diferenca
  FROM contas_bancarias cb
  LEFT JOIN entradas e ON e.tenant_id = cb.tenant_id AND e.conta = cb.id
  LEFT JOIN saidas   s ON s.tenant_id = cb.tenant_id AND s.conta = cb.id
  LEFT JOIN (SELECT tenant_id, conta, SUM(total) AS total FROM transf GROUP BY 1,2) t
         ON t.tenant_id = cb.tenant_id AND t.conta = cb.id
 WHERE ABS(COALESCE(NULLIF(cb.data->>'saldo_atual','')::numeric, 0)
           - (COALESCE(NULLIF(cb.data->>'saldo_inicial','')::numeric, 0)
              + COALESCE(e.total,0) - COALESCE(s.total,0)
              + COALESCE(t.total,0))) > 0.01
 ORDER BY ABS(COALESCE(NULLIF(cb.data->>'saldo_atual','')::numeric,0)) DESC;


-- =====================================================================
-- 5) LANCAMENTOS ORFAOS  (ALTO)
-- ---------------------------------------------------------------------
-- Rastreabilidade quebrada: nao da para chegar da conta ate a venda,
-- o cliente ou o fornecedor.
-- =====================================================================
-- 5a) Conta a receber apontando para venda que nao existe mais.
SELECT 'CR aponta para venda inexistente' AS problema, cr.id, cr.tenant_id,
       cr.data->>'origem_venda_id' AS venda_id, cr.data->>'valor_final' AS valor
  FROM contas_receber cr
 WHERE COALESCE(cr.data->>'origem_venda_id','') <> ''
   AND NOT EXISTS (SELECT 1 FROM vendas_crm v
                    WHERE v.id = cr.data->>'origem_venda_id'
                      AND v.tenant_id = cr.tenant_id);

-- 5b) Conta a pagar sem fornecedor identificado.
SELECT 'CP sem fornecedor' AS problema, id, tenant_id,
       data->>'descricao' AS descricao, data->>'valor_final' AS valor
  FROM contas_pagar
 WHERE COALESCE(fornecedor_id,'') = ''
   AND COALESCE(data->>'fornecedor_nome','') = '';

-- 5c) Conta a receber sem cliente identificado.
SELECT 'CR sem cliente' AS problema, id, tenant_id,
       data->>'descricao' AS descricao, data->>'valor_final' AS valor
  FROM contas_receber
 WHERE COALESCE(cliente_id,'') = ''
   AND COALESCE(data->>'cliente_nome','') = '';

-- 5d) Baixa apontando para conta bancaria que nao existe.
SELECT 'baixa em conta bancaria inexistente' AS problema, t.id, t.tenant_id, t.conta
  FROM (
    SELECT id, tenant_id, data->>'conta_bancaria_id' AS conta FROM contas_receber
     WHERE COALESCE(data->>'conta_bancaria_id','') <> ''
    UNION ALL
    SELECT id, tenant_id, data->>'conta_bancaria_id' FROM contas_pagar
     WHERE COALESCE(data->>'conta_bancaria_id','') <> ''
  ) t
 WHERE NOT EXISTS (SELECT 1 FROM contas_bancarias cb
                    WHERE cb.id = t.conta AND cb.tenant_id = t.tenant_id);


-- =====================================================================
-- 6) VALORES IMPOSSIVEIS  (ALTO)
-- =====================================================================
SELECT 'CR valor negativo ou nulo' AS problema, id, tenant_id,
       data->>'valor_final' AS valor, data->>'status' AS status
  FROM contas_receber
 WHERE COALESCE(NULLIF(data->>'valor_final','')::numeric, 0) <= 0
   AND COALESCE(data->>'status','') <> 'CANCELADO'
UNION ALL
SELECT 'CP valor negativo ou nulo', id, tenant_id,
       data->>'valor_final', data->>'status'
  FROM contas_pagar
 WHERE COALESCE(NULLIF(data->>'valor_final','')::numeric, 0) <= 0
   AND COALESCE(data->>'status','') <> 'CANCELADO';

-- Conta em moeda estrangeira cujo valor_final ficou igual ao original:
-- ou o cambio nao foi aplicado, ou e uma conta legitimamente em BRL.
-- Confira uma a uma antes de mexer.
SELECT 'CP possivel cambio nao aplicado' AS problema, id, tenant_id,
       data->>'moeda' AS moeda, data->>'cambio' AS cambio,
       data->>'valor_original' AS original, data->>'valor_final' AS final_brl
  FROM contas_pagar
 WHERE COALESCE(data->>'moeda','BRL') <> 'BRL'
   AND COALESCE(NULLIF(data->>'cambio','')::numeric, 0) > 1
   AND COALESCE(NULLIF(data->>'valor_final','')::numeric, 0)
       = COALESCE(NULLIF(data->>'valor_original','')::numeric, -1);


-- =====================================================================
-- 7) MARGENS IMPOSSIVEIS POR VENDA  (ALTO)
-- ---------------------------------------------------------------------
-- Venda cujo custo lancado supera o que sera cobrado do cliente.
-- Pode ser real (prejuizo) ou erro de lancamento. Vale conferencia.
-- =====================================================================
WITH receita AS (
  SELECT tenant_id, data->>'origem_venda_id' AS venda,
         SUM(COALESCE(NULLIF(data->>'valor_final','')::numeric,0)) AS total
    FROM contas_receber
   WHERE COALESCE(data->>'status','') <> 'CANCELADO'
     AND COALESCE(data->>'origem_venda_id','') <> ''
   GROUP BY 1,2
), custo AS (
  SELECT tenant_id, data->>'origem_venda_id' AS venda,
         SUM(COALESCE(NULLIF(data->>'valor_final','')::numeric,0)) AS total
    FROM contas_pagar
   WHERE COALESCE(data->>'status','') <> 'CANCELADO'
     AND COALESCE(data->>'origem_venda_id','') <> ''
   GROUP BY 1,2
)
SELECT COALESCE(r.tenant_id, c.tenant_id) AS tenant_id,
       COALESCE(r.venda, c.venda)         AS venda_id,
       COALESCE(r.total, 0)               AS receita,
       COALESCE(c.total, 0)               AS custo,
       ROUND(COALESCE(r.total,0) - COALESCE(c.total,0), 2) AS margem
  FROM receita r
  FULL OUTER JOIN custo c
    ON c.tenant_id = r.tenant_id AND c.venda = r.venda
 WHERE COALESCE(r.total,0) - COALESCE(c.total,0) < 0
 ORDER BY margem ASC;


-- =====================================================================
-- 8) CADASTRO DUPLICADO  (MEDIO)
-- =====================================================================
SELECT 'fornecedor duplicado por nome' AS problema, tenant_id,
       LOWER(TRIM(nome_fantasia)) AS nome, COUNT(*) AS vezes,
       STRING_AGG(id, ', ') AS ids
  FROM fornecedores_crm
 WHERE COALESCE(nome_fantasia,'') <> ''
 GROUP BY 1,2,3 HAVING COUNT(*) > 1
 ORDER BY vezes DESC;

SELECT 'cliente duplicado por documento' AS problema, tenant_id,
       REGEXP_REPLACE(COALESCE(cpf_cnpj,''), '\D', '', 'g') AS documento,
       COUNT(*) AS vezes, STRING_AGG(id, ', ') AS ids
  FROM clientes
 WHERE REGEXP_REPLACE(COALESCE(cpf_cnpj,''), '\D', '', 'g') <> ''
 GROUP BY 1,2,3 HAVING COUNT(*) > 1
 ORDER BY vezes DESC;


-- =====================================================================
-- 9) EVENTOS DO CRM PRESOS  (MEDIO)
-- ---------------------------------------------------------------------
-- Evento com erro nunca reprocessado. Cada um pode ser uma venda que
-- nunca virou financeiro.
-- =====================================================================
SELECT tipo, status, processado, COUNT(*) AS qtd,
       MIN(created_at) AS mais_antigo, MAX(created_at) AS mais_recente
  FROM crm_eventos_entrada
 WHERE processado = false OR status = 'ERRO'
 GROUP BY 1,2,3
 ORDER BY qtd DESC;


-- =====================================================================
-- 10) VOLUMETRIA — dimensiona o risco de performance  (informativo)
-- =====================================================================
SELECT 'contas_receber' AS tabela, tenant_id, COUNT(*) AS linhas FROM contas_receber GROUP BY 1,2
UNION ALL SELECT 'contas_pagar', tenant_id, COUNT(*) FROM contas_pagar GROUP BY 1,2
UNION ALL SELECT 'vendas_crm',   tenant_id, COUNT(*) FROM vendas_crm   GROUP BY 1,2
UNION ALL SELECT 'itens_venda',  tenant_id, COUNT(*) FROM itens_venda  GROUP BY 1,2
 ORDER BY linhas DESC
 LIMIT 40;
