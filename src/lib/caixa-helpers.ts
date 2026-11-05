import pool, { initDB } from './db';
import { generateId } from './utils';
import { num, round2 } from './money';
import type { ContaBancaria } from './crm-types';

// calcularSaldoBancario foi movido para ./saldo-bancario.ts (função pura)
// para evitar bundling de 'pool'/'pg' em componentes client. Reexporta aqui
// para compatibilidade com qualquer servidor que importava daqui.
export { calcularSaldoBancario } from './saldo-bancario';
// valorMovimentado é a regra única de "quanto esta conta já moveu no caixa"
// (trata PARCIAL pelo acumulado). O recálculo em lote precisa usar a mesma
// regra da leitura, senão os dois divergem.
import { valorMovimentado } from './saldo-bancario';
import { reconstruirSaldos } from './razao';
import { registrarMovimento } from './razao-servidor';
import type { ExecutorSQL } from './caixa-atomico';

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
    // Dentro de transação, duas baixas simultâneas não criam duas Caixas Gerais.
    if (exec) {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`caixa-geral:${tenantId}`]);
    }
    // Busca conta CAIXA existente do tenant
    const { rows } = await db.query(
      `SELECT id, data FROM contas_bancarias WHERE tenant_id = $1`,
      [tenantId],
    );
    // Se já existe pelo menos 1 conta com nome "Caixa Geral", retorna ela
    const caixaGeral = rows.find(r => ((r.data as { nome?: string } | null)?.nome ?? '') === CAIXA_GERAL_NOME);
    if (caixaGeral) return caixaGeral.id as string;
    // Baixa sem conta bancária escolhida SEMPRE cai na Caixa Geral, criada
    // aqui se faltar — mesmo quando a agência já cadastrou outros bancos.
    // Antes, com qualquer banco cadastrado, esta função devolvia null: a
    // baixa "dava certo" sem o dinheiro entrar em lugar nenhum, e depois da
    // auditoria de 04/11 (FIN2-02) passaria a ser recusada. As contas de
    // venda e de comissão nascem sem banco, então a Caixa Geral é o destino.

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
  ajustes: Array<{ conta_bancaria_id: string; diferenca: number }>;
  erros: string[];
}> {
  const result = {
    contas_atualizadas: 0,
    total_recebido: 0,
    total_pago: 0,
    total_transferido: 0,
    saldo_final_caixa_geral: 0,
    caixa_geral_criada: false,
    ajustes: [] as Array<{ conta_bancaria_id: string; diferenca: number }>,
    erros: [] as string[],
  };
  if (!pool || !tenantId) {
    result.erros.push('pool/tenantId ausente');
    return result;
  }
  // Tudo numa transação, com as contas bancárias TRAVADAS antes de ler as
  // baixas. Sem isso, uma baixa que comitasse entre a leitura das contas a
  // receber e a gravação do saldo era apagada: o recálculo gravava um saldo
  // que não a incluía, com a conta já RECEBIDA (auditoria 04/11, FIN2-03).
  // Com a trava, ou a baixa terminou antes (e é lida aqui), ou ela espera o
  // recálculo e soma o movimento por cima do saldo novo. O saldo é gravado
  // com jsonb_set, sem regravar o resto da conta (nome, banco) lido antes.
  await initDB();
  const client = await (pool as unknown as { connect(): Promise<{ query: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; release(): void }> }).connect();
  try {
    await client.query('BEGIN');
    const travarContas = () => client.query(
      `SELECT id, data FROM contas_bancarias WHERE tenant_id = $1 ORDER BY id FOR UPDATE`,
      [tenantId],
    );
    let { rows: contasRows } = await travarContas();

    // Carrega tudo que JÁ movimentou caixa — quitado ou parcial.
    //
    // Antes desta correção a query pegava só RECEBIDO/PAGO. Como a função
    // zera cada conta para o saldo_inicial antes de reconstruir, toda baixa
    // PARCIAL era apagada do saldo.
    const { rows: crRows } = await client.query(
      `SELECT data FROM contas_receber
        WHERE tenant_id = $1 AND (data->>'status') IN ('RECEBIDO', 'PARCIAL')`,
      [tenantId],
    );
    const { rows: cpRows } = await client.query(
      `SELECT data FROM contas_pagar
        WHERE tenant_id = $1 AND (data->>'status') IN ('PAGO', 'PARCIAL')`,
      [tenantId],
    );
    // Transferências efetivadas movem saldo entre contas — ignorá-las aqui
    // DESTRUÍA saldos corretos a cada recálculo.
    const { rows: trRows } = await client.query(
      `SELECT data FROM transferencias WHERE tenant_id = $1 AND (data->>'status') = 'EFETIVADA'`,
      [tenantId],
    );

    // Identifica se precisa Caixa Geral (alguma baixa sem conta_bancaria_id)
    const precisaCaixaGeral =
      crRows.some(r => !(r.data as Record<string, unknown> | null)?.conta_bancaria_id) ||
      cpRows.some(r => !(r.data as Record<string, unknown> | null)?.conta_bancaria_id);
    let caixaGeralId: string | null = null;
    if (precisaCaixaGeral) {
      const idsAntes = new Set(contasRows.map(r => String(r.id)));
      caixaGeralId = await ensureCaixaGeral(tenantId, client);
      result.caixa_geral_criada = !!caixaGeralId && !idsAntes.has(caixaGeralId);
      if (result.caixa_geral_criada) ({ rows: contasRows } = await travarContas());
    }

    // Mesma regra de sempre, agora numa função única (razao.ts) que também
    // serve à conferência da abertura do razão.
    const rec = reconstruirSaldos({
      contas: contasRows.map(r => ({ id: String(r.id), data: (r.data ?? {}) as Record<string, unknown> })),
      receber: crRows.map(r => (r.data ?? {}) as Record<string, unknown>),
      pagar: cpRows.map(r => (r.data ?? {}) as Record<string, unknown>),
      transferencias: trRows.map(r => (r.data ?? {}) as Record<string, unknown>),
      caixaGeralId,
      valorMovimentado: (d, campo) => valorMovimentado(d as Parameters<typeof valorMovimentado>[0], campo),
    });
    result.total_recebido = rec.total_recebido;
    result.total_pago = rec.total_pago;
    result.total_transferido = rec.total_transferido;

    // Persiste novos saldos (só o saldo). A diferença aplicada a cada conta
    // vira um lançamento de ajuste no razão (05/11/2026): o recálculo não
    // muda mais o saldo em silêncio — fica registrado e aparece para revisão.
    for (const r of contasRows) {
      const id = String(r.id);
      const anterior = round2(num(((r.data ?? {}) as Record<string, unknown>).saldo_atual));
      const saldoFinal = round2(rec.saldos[id] ?? 0);
      await client.query(
        `UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_atual}', to_jsonb($1::numeric), true), updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        [saldoFinal, id, tenantId],
      );
      result.contas_atualizadas++;
      if (id === caixaGeralId) result.saldo_final_caixa_geral = saldoFinal;
      const diferenca = round2(saldoFinal - anterior);
      if (diferenca !== 0) {
        result.ajustes.push({ conta_bancaria_id: id, diferenca });
        await registrarMovimento(client as unknown as ExecutorSQL, tenantId, id, diferenca, {
          tipo: 'ajuste', tabela: 'contas_bancarias', id,
          descricao: 'Recalcular saldos: diferença aplicada ao saldo',
        });
      }
    }

    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    result.contas_atualizadas = 0;
    result.erros.push(e instanceof Error ? e.message : 'erro geral');
    return result;
  } finally {
    client.release();
  }
}
