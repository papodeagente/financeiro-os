/**
 * Movimento de caixa ATÔMICO + baixa idempotente.
 *
 * Complementa ./caixa-helpers (que mantém a Caixa Geral e o recálculo em
 * lote). A diferença: aqui NADA é ler-modificar-gravar. O saldo é alterado
 * por um único UPDATE em SQL, e a transição de status da conta (baixa /
 * estorno) usa guarda otimista — duplo clique ou dois PUTs concorrentes
 * movem o caixa UMA vez só.
 *
 * Regras do módulo financeiro respeitadas aqui:
 *  - todo valor persistido passa por round2 (src/lib/money.ts);
 *  - o estorno sempre volta para a conta que RECEBEU/PAGOU o dinheiro
 *    (conta_bancaria_id do estado anterior), nunca a do payload novo.
 */

import pool from './db';
import { ensureCaixaGeral } from './caixa-helpers';
import { num, round2 } from './money';

/** Pool ou client de transação — ambos expõem `query`. */
export interface ExecutorSQL {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** Status em que o dinheiro JÁ se moveu — nunca podem ser regenerados/apagados
 *  sem estorno explícito. PARCIAL entra na lista por precaução: existe baixa
 *  parcial registrada na conta. */
export const STATUS_BAIXADOS = ['RECEBIDO', 'PARCIAL', 'PAGO'] as const;

/** Roda `fn` dentro de uma transação (BEGIN/COMMIT/ROLLBACK). A baixa e o
 *  movimento de caixa precisam viver juntos: ou os dois acontecem, ou nenhum. */
export async function emTransacao<T>(fn: (exec: ExecutorSQL) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('Banco indisponível');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client as unknown as ExecutorSQL);
    await client.query('COMMIT');
    return resultado;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* conexão já perdida — nada a desfazer do lado do app */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Soma `delta` ao saldo_atual da conta em UM único UPDATE (sem ler-modificar-
 * gravar, imune a corrida entre requisições). Delta positivo = entrada.
 * Conta vazia/nula cai na Caixa Geral, igual ao comportamento antigo.
 * Devolve true se alguma linha foi afetada.
 */
export async function aplicarMovimentoCaixaAtomico(
  tenantId: string,
  contaId: string | null | undefined,
  delta: number,
  exec?: ExecutorSQL,
): Promise<boolean> {
  const db = exec ?? (pool as ExecutorSQL | null);
  const valor = round2(num(delta));
  if (!db || !tenantId || !valor) return false;
  // exec é repassado: dentro de uma transação, resolver a Caixa Geral pelo
  // pool pediria um segundo client e poderia esgotá-lo (deadlock).
  const id = contaId || (await ensureCaixaGeral(tenantId, exec));
  if (!id) return false;

  // saldo_atual pode estar ausente ou gravado como texto por dados legados —
  // o CASE evita que um cast inválido derrube a baixa inteira.
  const { rowCount } = await db.query(
    `UPDATE contas_bancarias
        SET data = jsonb_set(
              data,
              '{saldo_atual}',
              to_jsonb(ROUND(
                (CASE WHEN data->>'saldo_atual' ~ '^-?[0-9]+([.][0-9]+)?$'
                      THEN (data->>'saldo_atual')::numeric
                      ELSE 0 END) + $3::numeric, 2)),
              true),
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, valor],
  );
  return (rowCount ?? 0) > 0;
}

/** Valor efetivamente baixado de uma conta (mesma precedência usada nas rotas). */
export function valorBaixado(
  data: Record<string, unknown>,
  campo: 'valor_recebido' | 'valor_pago',
): number {
  return round2(num(data[campo]) || num(data.valor_final));
}

/** A conta já teve dinheiro movimentado neste status? */
export function statusMovimentaCaixa(status: string): boolean {
  return (STATUS_BAIXADOS as readonly string[]).includes(status);
}

/**
 * Quanto dinheiro esta conta representa HOJE no extrato — 0 se ainda não foi
 * baixada. Numa conta PARCIAL o campo de baixa guarda o ACUMULADO recebido/pago
 * até agora, então ele é a fonte da verdade; só a quitação total cai no
 * valor_final.
 */
export function valorNoCaixa(
  data: Record<string, unknown>,
  campo: 'valor_recebido' | 'valor_pago',
): number {
  const status = String(data.status ?? '');
  if (!statusMovimentaCaixa(status)) return 0;
  if (status === 'PARCIAL') return round2(num(data[campo]));
  return valorBaixado(data, campo);
}

export interface MovimentoCaixa { conta: string | null; delta: number }

/**
 * Movimentos de caixa de uma transição de conta, derivados do VALOR BAIXADO —
 * nunca do status sozinho. É isso que faz a baixa parcial (e a evolução de
 * PARCIAL para PARCIAL, ou para quitada) mover o caixa na medida certa.
 *
 * sinal = +1 para contas a receber (entrada), -1 para contas a pagar (saída).
 * O estorno volta SEMPRE para a conta bancária que recebeu/pagou (prev), não
 * para a que veio no payload novo.
 */
export function calcularMovimentos(
  prev: Record<string, unknown>,
  novo: Record<string, unknown>,
  campo: 'valor_recebido' | 'valor_pago',
  sinal: 1 | -1,
): MovimentoCaixa[] {
  const contaPrev = (prev.conta_bancaria_id as string | null | undefined) || null;
  const contaNova = (novo.conta_bancaria_id as string | null | undefined) || null;
  const valorPrev = valorNoCaixa(prev, campo);
  const valorNovo = valorNoCaixa(novo, campo);

  if (valorPrev === 0 && valorNovo === 0) return [];

  // Trocou a conta bancária da baixa: retira tudo da antiga e põe na nova.
  if (contaPrev !== contaNova && valorPrev > 0 && valorNovo > 0) {
    return [
      { conta: contaPrev, delta: round2(-valorPrev * sinal) },
      { conta: contaNova, delta: round2(+valorNovo * sinal) },
    ];
  }

  const alvo = valorNovo > 0 ? contaNova : contaPrev;
  const delta = round2((valorNovo - valorPrev) * sinal);
  return delta === 0 ? [] : [{ conta: alvo, delta }];
}

/**
 * Estorna no caixa a baixa de uma conta que está sendo removida.
 * Usa SEMPRE a conta_bancaria_id gravada na própria conta (a que recebeu/pagou).
 * Contas a receber devolvem débito; contas a pagar devolvem crédito.
 */
export async function estornarBaixaDaConta(
  tenantId: string,
  tabela: 'contas_receber' | 'contas_pagar',
  data: Record<string, unknown>,
  exec?: ExecutorSQL,
): Promise<void> {
  // Vale para RECEBIDO/PAGO e também para PARCIAL — o que importa é o valor
  // que efetivamente entrou/saiu do caixa, não o status.
  const conta = (data.conta_bancaria_id as string | null) || null;
  const campo = tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago';
  const valor = valorNoCaixa(data, campo);
  if (valor === 0) return;
  const sinal = tabela === 'contas_receber' ? -1 : +1;
  await aplicarMovimentoCaixaAtomico(tenantId, conta, round2(valor * sinal), exec);
}

export interface AtualizacaoGuardadaParams {
  exec: ExecutorSQL;
  /** Nome de tabela vem de constante do código — nunca de input do usuário. */
  tabela: string;
  colunasIndice: string[];
  id: string;
  tenantId: string;
  item: Record<string, unknown>;
  /** xmin lido junto do estado anterior. Null = update sem guarda. */
  versaoAnterior: string | null;
  /** Status alvo da transição: a linha só é atualizada se AINDA não estiver
   *  nele (é isso que torna a baixa idempotente no duplo clique). */
  statusAlvo: string | null;
}

/**
 * UPDATE da conta com guarda otimista. Só afeta linha se:
 *  - a linha ainda for a versão que lemos (xmin), e
 *  - o status ainda for diferente do alvo da transição.
 * Devolve false quando outra requisição chegou primeiro — nesse caso o
 * chamador NÃO pode aplicar o movimento de caixa.
 */
export async function atualizarContaComGuarda(p: AtualizacaoGuardadaParams): Promise<boolean> {
  const valores: unknown[] = [p.id, p.tenantId, JSON.stringify(p.item)];
  const sets = ['data = $3::jsonb', 'updated_at = NOW()'];
  p.colunasIndice.forEach(col => {
    valores.push(p.item[col] ?? '');
    sets.push(`${col} = $${valores.length}`);
  });

  const where = ['id = $1', 'tenant_id = $2'];
  if (p.versaoAnterior) {
    valores.push(p.versaoAnterior);
    where.push(`xmin::text = $${valores.length}`);
  }
  if (p.statusAlvo) {
    valores.push(p.statusAlvo);
    where.push(`COALESCE(data->>'status', '') IS DISTINCT FROM $${valores.length}`);
  }

  const { rows } = await p.exec.query(
    `UPDATE ${p.tabela} SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING id`,
    valores,
  );
  return rows.length > 0;
}
