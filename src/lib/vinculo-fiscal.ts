/**
 * Qual agência é dona de qual empresa no emissor de notas (FIN-02 e FIN2-08,
 * auditoria de 04/11/2026).
 *
 * A empresa no emissor (AceleraAPI) é identificada por um número. Antes, o
 * número vinha do corpo da requisição ou de uma busca pelo CNPJ que a própria
 * agência digitou no cadastro: bastava pôr o CNPJ (ou o empresa_id) de outra
 * agência para o sistema regenerar o token DELA e passar a emitir em nome
 * dela, derrubando a conexão da dona.
 *
 * Agora cada empresa tem um dono só, gravado aqui com UNIQUE no empresa_id.
 * A primeira agência que se liga a uma empresa fica com ela; outra que tente
 * recebe recusa, antes de qualquer token ser regenerado.
 */
export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export class ErroVinculoFiscal extends Error {}

export const VINCULO_FISCAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS vinculo_fiscal (
    empresa_id BIGINT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    cnpj TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_vinculo_fiscal_tenant ON vinculo_fiscal(tenant_id);

  -- Quem já estava conectado vira dono da própria empresa. Se duas agências
  -- apontavam para a mesma empresa, fica a que gravou primeiro; a outra vai
  -- ser recusada na próxima conexão e precisa de revisão manual.
  INSERT INTO vinculo_fiscal (empresa_id, tenant_id, cnpj)
  SELECT DISTINCT ON ((data->>'empresa_id')::bigint)
         (data->>'empresa_id')::bigint, tenant_id, ''
    FROM config_fiscal
   WHERE data->>'empresa_id' ~ '^[0-9]{1,15}$'
     AND tenant_id <> ''
   ORDER BY (data->>'empresa_id')::bigint, created_at, tenant_id
  ON CONFLICT (empresa_id) DO NOTHING;
`;

/**
 * Garante que a empresa é desta agência, registrando o vínculo se ela ainda
 * não tem dono. Chamar ANTES de regenerar token ou gravar o empresa_id.
 */
export async function garantirVinculoFiscal(
  db: Consulta, tenantId: string, empresaId: number, cnpj = '',
): Promise<void> {
  if (!tenantId) throw new ErroVinculoFiscal('Agência não identificada.');
  if (!Number.isSafeInteger(empresaId) || empresaId <= 0) {
    throw new ErroVinculoFiscal('Empresa fiscal inválida.');
  }
  await db.query(
    `INSERT INTO vinculo_fiscal (empresa_id, tenant_id, cnpj) VALUES ($1, $2, $3)
     ON CONFLICT (empresa_id) DO NOTHING`,
    [empresaId, tenantId, String(cnpj ?? '').replace(/\D+/g, '')],
  );
  const { rows } = await db.query(`SELECT tenant_id FROM vinculo_fiscal WHERE empresa_id = $1`, [empresaId]);
  if (String(rows[0]?.tenant_id ?? '') !== tenantId) {
    throw new ErroVinculoFiscal(
      'Esta empresa já está ligada a outra conta no emissor de notas. Fale com o suporte para revisar o cadastro.',
    );
  }
}
