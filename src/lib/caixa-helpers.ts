import pool, { initDB } from './db';
import { generateId } from './utils';
import { num, round2 } from './money';
import type { ContaBancaria } from './crm-types';

// calcularSaldoBancario foi movido para ./saldo-bancario.ts (função pura)
// para evitar bundling de 'pool'/'pg' em componentes client. Reexporta aqui
// para compatibilidade com qualquer servidor que importava daqui.
export { calcularSaldoBancario } from './saldo-bancario';

// ──────────────────────────────────────────────────────────────────────────
// Modo iniciante: 1 conta "Caixa Geral" criada automaticamente. Toda baixa
// de CR/CP entra/sai dela. Usuário avançado pode criar mais contas e
// escolher manualmente — neste caso o conta_bancaria_id da CR/CP é
// respeitado em vez de cair na Caixa Geral.
// ──────────────────────────────────────────────────────────────────────────

const CAIXA_GERAL_NOME = 'Caixa Geral';

// Retorna o id da Caixa Geral do tenant, criando se não existir.
// Usado lazily: só dispara quando o primeiro RECEBIDO/PAGO acontece.
//
// `exec` existe para quando isto é chamado DENTRO de uma transação: sem ele a
// função pediria um segundo client ao pool (max 5) enquanto a transação segura
// o primeiro — cinco baixas simultâneas esgotariam o pool e travariam a app.
export async function ensureCaixaGeral(
  tenantId: string,
  exec?: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> },
): Promise<string | null> {
  const db = exec ?? pool;
  if (!db || !tenantId) return null;
  try {
    if (!exec) await initDB();
    // Busca conta CAIXA existente do tenant
    const { rows } = await db.query(
      `SELECT id, data FROM contas_bancarias WHERE tenant_id = $1`,
      [tenantId],
    );
    // Se já existe pelo menos 1 conta com nome "Caixa Geral", retorna ela
    const caixaGeral = rows.find(r => ((r.data as { nome?: string } | null)?.nome ?? '') === CAIXA_GERAL_NOME);
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
    await db.query(
      `INSERT INTO contas_bancarias (id, tenant_id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
      [novo.id, tenantId, JSON.stringify(novo)],
    );
    return novo.id;
  } catch {
    return null;
  }
}

// Reconstrói saldo_atual de todas as contas a partir do estado das CR/CP e das
// transferências EFETIVADAS.
// Idempotente: para cada conta, saldo_atual = saldo_inicial + Σ recebidos
// − Σ pagos − Σ transferências saídas + Σ transferências entradas
// (ou Caixa Geral se conta_bancaria_id vazio).
// Útil para corrigir contas cujas baixas foram feitas antes do override
// PUT que sincroniza saldo (caso comum após upgrade).
export async function recalcularSaldosCaixa(tenantId: string): Promise<{
  contas_atualizadas: number;
  total_recebido: number;
  total_pago: number;
  total_transferido: number;
  saldo_final_caixa_geral: number;
  caixa_geral_criada: boolean;
  erros: string[];
}> {
  const result = {
    contas_atualizadas: 0,
    total_recebido: 0,
    total_pago: 0,
    total_transferido: 0,
    saldo_final_caixa_geral: 0,
    caixa_geral_criada: false,
    erros: [] as string[],
  };
  if (!pool || !tenantId) {
    result.erros.push('pool/tenantId ausente');
    return result;
  }
  try {
    await initDB();
    // Carrega CR RECEBIDO e CP PAGO
    const { rows: crRows } = await pool.query(
      `SELECT data FROM contas_receber WHERE tenant_id = $1 AND (data->>'status') = 'RECEBIDO'`,
      [tenantId],
    );
    const { rows: cpRows } = await pool.query(
      `SELECT data FROM contas_pagar WHERE tenant_id = $1 AND (data->>'status') = 'PAGO'`,
      [tenantId],
    );
    // Transferências efetivadas movem saldo entre contas — ignorá-las aqui
    // DESTRUÍA saldos corretos a cada recálculo.
    const { rows: trRows } = await pool.query(
      `SELECT data FROM transferencias WHERE tenant_id = $1 AND (data->>'status') = 'EFETIVADA'`,
      [tenantId],
    );

    // Identifica se precisa Caixa Geral (alguma baixa sem conta_bancaria_id)
    const precisaCaixaGeral =
      crRows.some(r => !r.data?.conta_bancaria_id) ||
      cpRows.some(r => !r.data?.conta_bancaria_id);
    let caixaGeralId: string | null = null;
    if (precisaCaixaGeral) {
      const antes = await pool.query(
        `SELECT id FROM contas_bancarias WHERE tenant_id = $1`,
        [tenantId],
      );
      const hadAny = antes.rows.length > 0;
      caixaGeralId = await ensureCaixaGeral(tenantId);
      result.caixa_geral_criada = !hadAny && !!caixaGeralId;
    }

    // Carrega todas as contas + reseta para saldo_inicial
    const { rows: contasRows } = await pool.query(
      `SELECT id, data FROM contas_bancarias WHERE tenant_id = $1`,
      [tenantId],
    );
    const contasMap: Record<string, { id: string; data: Record<string, unknown>; saldoNovo: number }> = {};
    for (const r of contasRows) {
      const data = r.data as Record<string, unknown>;
      contasMap[r.id] = {
        id: r.id,
        data,
        saldoNovo: num(data.saldo_inicial),
      };
    }

    // Soma recebidos
    for (const r of crRows) {
      const d = r.data as Record<string, unknown>;
      const valor = num(d.valor_recebido) || num(d.valor_final);
      const contaId = (d.conta_bancaria_id as string) || caixaGeralId || '';
      if (contaId && contasMap[contaId]) {
        contasMap[contaId].saldoNovo = round2(contasMap[contaId].saldoNovo + valor);
        result.total_recebido = round2(result.total_recebido + valor);
      }
    }
    // Subtrai pagos
    for (const r of cpRows) {
      const d = r.data as Record<string, unknown>;
      const valor = num(d.valor_pago) || num(d.valor_final);
      const contaId = (d.conta_bancaria_id as string) || caixaGeralId || '';
      if (contaId && contasMap[contaId]) {
        contasMap[contaId].saldoNovo = round2(contasMap[contaId].saldoNovo - valor);
        result.total_pago = round2(result.total_pago + valor);
      }
    }
    // Aplica transferências efetivadas: sai da origem, entra no destino
    for (const r of trRows) {
      const d = r.data as Record<string, unknown>;
      const valor = num(d.valor);
      if (valor <= 0) continue;
      const origemId = (d.conta_origem_id as string) || '';
      const destinoId = (d.conta_destino_id as string) || '';
      let movimentou = false;
      if (origemId && contasMap[origemId]) {
        contasMap[origemId].saldoNovo = round2(contasMap[origemId].saldoNovo - valor);
        movimentou = true;
      }
      if (destinoId && contasMap[destinoId]) {
        contasMap[destinoId].saldoNovo = round2(contasMap[destinoId].saldoNovo + valor);
        movimentou = true;
      }
      if (movimentou) result.total_transferido = round2(result.total_transferido + valor);
    }

    // Persiste novos saldos
    for (const conta of Object.values(contasMap)) {
      const saldoFinal = round2(conta.saldoNovo);
      const atualizado = { ...conta.data, saldo_atual: saldoFinal };
      try {
        await pool.query(
          `UPDATE contas_bancarias SET data = $1::jsonb, updated_at = NOW()
            WHERE id = $2 AND tenant_id = $3`,
          [JSON.stringify(atualizado), conta.id, tenantId],
        );
        result.contas_atualizadas++;
        if (conta.id === caixaGeralId) result.saldo_final_caixa_geral = saldoFinal;
      } catch (e) {
        result.erros.push(`${conta.data.nome}: ${e instanceof Error ? e.message : 'erro'}`);
      }
    }

    return result;
  } catch (e) {
    result.erros.push(e instanceof Error ? e.message : 'erro geral');
    return result;
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
    const saldoAtual = num(data.saldo_atual);
    const novoSaldo = round2(saldoAtual + num(delta));
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
