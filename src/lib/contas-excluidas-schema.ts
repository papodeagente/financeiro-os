/**
 * Exclusão lógica de títulos (06/11/2026, E7): o título excluído sai de
 * `contas_pagar`/`contas_receber` e fica guardado aqui, inteiro, até alguém
 * restaurar. Por sair da tabela, TODO relatório, painel, DRE e fluxo que lê
 * as contas ignora o excluído sem mudar uma linha deles.
 *
 *   linha             a linha inteira (to_jsonb), para voltar igual: id,
 *                     colunas (inclusive as que vierem depois), created_at;
 *   data              o registro como ficou ao excluir (sem a baixa, que foi
 *                     estornada na exclusão);
 *   baixa_estornada   quanto tinha sido pago/recebido e em que conta, quando
 *                     a exclusão devolveu dinheiro ao caixa.
 *
 * Controle: fica fora do gatilho de auditoria (a exclusão e a restauração já
 * aparecem no histórico do próprio título, como "Excluiu" e "Criou").
 */
export const CONTAS_EXCLUIDAS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS contas_excluidas (
    tenant_id TEXT NOT NULL,
    tabela TEXT NOT NULL CHECK (tabela IN ('contas_pagar', 'contas_receber')),
    id TEXT NOT NULL,
    linha JSONB NOT NULL,
    data JSONB NOT NULL,
    baixa_estornada JSONB,
    excluido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    excluido_por TEXT,
    excluido_por_nome TEXT,
    PRIMARY KEY (tenant_id, tabela, id)
  );
  CREATE INDEX IF NOT EXISTS idx_contas_excluidas_quando ON contas_excluidas(tenant_id, excluido_em DESC);
`;
