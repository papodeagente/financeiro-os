/**
 * Esquema da parte D da E5 (05/11/2026): carteira de crédito do cliente,
 * reembolsos e o registro dos cancelamentos. Idempotente; o initDB roda
 * depois de VENDA_SCHEMA_SQL e antes do razão e da auditoria.
 */
import { CREDITO_CLIENTE_SCHEMA_SQL } from './credito-cliente-servidor';
import { REEMBOLSOS_SCHEMA_SQL } from './reembolsos-servidor';

export const VENDA_CANCELAMENTOS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS venda_cancelamentos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    data DATE NOT NULL,
    motivo TEXT NOT NULL DEFAULT '',
    pedido JSONB NOT NULL DEFAULT '{}'::jsonb,
    plano JSONB NOT NULL DEFAULT '{}'::jsonb,
    resultado JSONB NOT NULL DEFAULT '{}'::jsonb,
    usuario_id TEXT NOT NULL DEFAULT '',
    usuario_nome TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_venda_cancelamentos_venda ON venda_cancelamentos(tenant_id, venda_id, criado_em);
`;

/** Tudo da parte D, na ordem: carteira, reembolsos, cancelamentos. O initDB roda depois de VENDA_SCHEMA_SQL. */
export const PARTE_D_SCHEMA_SQL = `${CREDITO_CLIENTE_SCHEMA_SQL}\n${REEMBOLSOS_SCHEMA_SQL}\n${VENDA_CANCELAMENTOS_SCHEMA_SQL}`;

