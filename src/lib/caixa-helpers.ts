import pool, { initDB } from './db';
import { generateId } from './utils';
import type { ContaBancaria } from './crm-types';

// ──────────────────────────────────────────────────────────────────────────
// Modo iniciante: 1 conta "Caixa Geral" criada automaticamente. Toda baixa
// de CR/CP entra/sai dela. Usuário avançado pode criar mais contas e
// escolher manualmente — neste caso o conta_bancaria_id da CR/CP é
// respeitado em vez de cair na Caixa Geral.
// ──────────────────────────────────────────────────────────────────────────

const CAIXA_GERAL_NOME = 'Caixa Geral';

// Retorna o id da Caixa Geral do tenant, criando se não existir.
// Usado lazily: só dispara quando o primeiro RECEBIDO/PAGO acontece.
export async function ensureCaixaGeral(tenantId: string): Promise<string | null> {
  if (!pool || !tenantId) return null;
  try {
    await initDB();
    // Busca conta CAIXA existente do tenant
    const { rows } = await pool.query(
      `SELECT id, data FROM contas_bancarias WHERE tenant_id = $1`,
      [tenantId],
    );
    // Se já existe pelo menos 1 conta com nome "Caixa Geral", retorna ela
    const caixaGeral = rows.find(r => (r.data?.nome ?? '') === CAIXA_GERAL_NOME);
    if (caixaGeral) return caixaGeral.id as string;
    // Se já existe qualquer conta, NÃO cria Caixa Geral (usuário avançado
    // já configurou suas contas — não vamos poluir o cadastro).
    if (rows.length > 0) return null;

    // Cria a Caixa Geral default
    const novo: ContaBancaria = {
      id: generateId(),
      nome: CAIXA_GERAL_NOME,
      tipo: 'CAIXA',
      banco: '',
      agencia: '',
      conta: '',
      saldo_inicial: 0,
      saldo_atual: 0,
      limite: 0,
      dia_fechamento: 0,
      dia_vencimento: 0,
    };
    await pool.query(
      `INSERT INTO contas_bancarias (id, tenant_id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
      [novo.id, tenantId, JSON.stringify(novo)],
    );
    return novo.id;
  } catch {
    return null;
  }
}

// Aplica delta no saldo_atual da conta. Delta positivo = entrada, negativo = saída.
// Se contaId for vazio/null, usa a Caixa Geral (criando se preciso).
export async function aplicarMovimentoCaixa(
  tenantId: string,
  contaId: string | null | undefined,
  delta: number,
): Promise<void> {
  if (!pool || !tenantId || !delta) return;
  try {
    await initDB();
    const id = contaId || (await ensureCaixaGeral(tenantId));
    if (!id) return;
    const { rows } = await pool.query(
      `SELECT data FROM contas_bancarias WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) return;
    const data = (rows[0].data ?? {}) as Record<string, unknown>;
    const saldoAtual = Number(data.saldo_atual) || 0;
    const novoSaldo = Number((saldoAtual + delta).toFixed(2));
    const atualizado = { ...data, saldo_atual: novoSaldo };
    await pool.query(
      `UPDATE contas_bancarias SET data = $1::jsonb, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(atualizado), id, tenantId],
    );
  } catch {
    /* silent */
  }
}
