-- =====================================================================
-- Limpeza de lancamentos CRM com shape antigo (pre-fix de contas)
-- Tenant: '1' (Financeiro production)
--
-- Identificacao: registros velhos NAO tem `valor_final` (contas) nem
-- `cliente_nome` (vendas) no JSONB. O fix novo grava esses campos sempre.
-- =====================================================================
--
-- Execute em 3 etapas:
--   1) INSPECAO     — confira o que sera apagado
--   2) LIMPEZA      — apaga em transacao (BEGIN/COMMIT)
--   3) IDEMPOTENCIA — libera reenvio dos VENDA_FECHADA pelo CRM
--
-- Conecte no Postgres do Financeiro via Coolify Terminal:
--   docker exec -it <pg-container> psql -U <user> -d <dbname>
--
-- Ou exporte DATABASE_URL e use psql.

-- =====================================================================
-- 1) INSPECAO — rode antes da limpeza para ver o que vai sumir
-- =====================================================================

-- 1a) contas_receber zumbis
SELECT id,
       status,
       created_at,
       data->>'origem'      AS origem,
       data->>'valor'       AS valor_velho,
       data->>'valor_final' AS valor_novo,
       data->>'descricao'   AS descricao
  FROM contas_receber
 WHERE tenant_id = '1'
   AND data->>'valor_final' IS NULL
 ORDER BY created_at DESC;

-- 1b) contas_pagar zumbis
SELECT id,
       status,
       created_at,
       data->>'origem'        AS origem,
       data->>'valor_custo'   AS valor_velho,
       data->>'valor_final'   AS valor_novo,
       data->>'fornecedor_id' AS fornecedor
  FROM contas_pagar
 WHERE tenant_id = '1'
   AND data->>'valor_final' IS NULL
 ORDER BY created_at DESC;

-- 1c) vendas_crm zumbis (sem cliente_nome no JSONB = velho)
SELECT id,
       status,
       created_at,
       data->>'cliente_id'   AS cliente_id,
       data->>'cliente_nome' AS cliente_nome,
       data->>'crm_venda_id' AS crm_venda_id,
       data->>'valor_total'  AS valor_total
  FROM vendas_crm
 WHERE tenant_id = '1'
   AND data->>'cliente_nome' IS NULL
 ORDER BY created_at DESC;

-- 1d) crm_eventos_entrada (VENDA_FECHADA antigos)
SELECT id, tipo, status, processado, created_at, idempotency_key
  FROM crm_eventos_entrada
 WHERE tenant_id = '1'
   AND tipo = 'VENDA_FECHADA'
   AND created_at < NOW() - INTERVAL '5 minutes'
 ORDER BY created_at DESC;

-- 1e) crm_eventos_saida zumbis (101 PENDENTES emitidos sem config)
SELECT id, tipo, status, tentativas, created_at
  FROM crm_eventos_saida
 WHERE tenant_id = '1'
   AND status = 'PENDENTE'
 ORDER BY created_at DESC
 LIMIT 20;


-- =====================================================================
-- 2) LIMPEZA — rode em bloco depois de validar a inspecao acima
-- =====================================================================
-- Se algo parecer errado entre BEGIN e COMMIT, troque COMMIT por ROLLBACK.

BEGIN;

-- contas a receber zumbis
DELETE FROM contas_receber
 WHERE tenant_id = '1'
   AND data->>'valor_final' IS NULL;

-- contas a pagar zumbis
DELETE FROM contas_pagar
 WHERE tenant_id = '1'
   AND data->>'valor_final' IS NULL;

-- vendas zumbis (sem cliente_nome)
DELETE FROM vendas_crm
 WHERE tenant_id = '1'
   AND data->>'cliente_nome' IS NULL;

-- eventos VENDA_FECHADA antigos: apaga p/ permitir reenvio do CRM
-- (margem de 5 min p/ proteger eventos recem-recebidos do novo handler)
DELETE FROM crm_eventos_entrada
 WHERE tenant_id = '1'
   AND tipo = 'VENDA_FECHADA'
   AND created_at < NOW() - INTERVAL '5 minutes';

-- eventos PENDENTES de saida que nunca chegaram a ser enviados
-- (foram emitidos antes da config CRM existir — nao tem destino).
-- Marca como FALHA para tirar do contador "pendentes" sem perder o log.
UPDATE crm_eventos_saida
   SET status = 'FALHA',
       tentativas = COALESCE(tentativas, 0),
       updated_at = NOW()
 WHERE tenant_id = '1'
   AND status = 'PENDENTE'
   AND created_at < NOW() - INTERVAL '5 minutes';

COMMIT;


-- =====================================================================
-- 3) VALIDACAO POS-LIMPEZA
-- =====================================================================

-- Esperado: 0 linhas em cada uma das proximas 4 queries
SELECT COUNT(*) AS receber_zumbis_restantes
  FROM contas_receber
 WHERE tenant_id = '1' AND data->>'valor_final' IS NULL;

SELECT COUNT(*) AS pagar_zumbis_restantes
  FROM contas_pagar
 WHERE tenant_id = '1' AND data->>'valor_final' IS NULL;

SELECT COUNT(*) AS vendas_zumbis_restantes
  FROM vendas_crm
 WHERE tenant_id = '1' AND data->>'cliente_nome' IS NULL;

SELECT COUNT(*) AS pendentes_saida_antigos
  FROM crm_eventos_saida
 WHERE tenant_id = '1'
   AND status = 'PENDENTE'
   AND created_at < NOW() - INTERVAL '5 minutes';
