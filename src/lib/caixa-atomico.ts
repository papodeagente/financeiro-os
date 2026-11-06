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
import type { OrigemDoMovimento } from './razao';
import { registrarMovimento } from './razao-servidor';

export type { OrigemDoMovimento } from './razao';

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
 *
 * `origem` (05/11/2026) é obrigatória: todo movimento também vira um
 * lançamento no razão financeiro, na mesma transação. O razão nunca derruba
 * o movimento (erro dele vira registro em razao_falhas). Sem `exec`, o
 * movimento e o lançamento rodam numa transação própria.
 */
export async function aplicarMovimentoCaixaAtomico(
  tenantId: string,
  contaId: string | null | undefined,
  delta: number,
  exec: ExecutorSQL | undefined,
  origem: OrigemDoMovimento,
): Promise<boolean> {
  const valor = round2(num(delta));
  if (!tenantId || !valor) return false;
  if (!exec) {
    if (!pool) return false;
    return emTransacao(tx => aplicarMovimentoCaixaAtomico(tenantId, contaId, delta, tx, origem));
  }
  const db = exec;
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
      WHERE id = $1 AND tenant_id = $2
        AND ($4::boolean OR COALESCE(NULLIF(data->>'moeda', ''), 'BRL') = 'BRL')`,
    [id, tenantId, valor, origem.naMoedaDaConta === true],
  );
  const moveu = (rowCount ?? 0) > 0;
  if (!moveu && origem.naMoedaDaConta !== true) {
    // Conta em moeda estrangeira não recebe reais por caminho que não
    // converte (tela antiga, conciliação, CRM, plataformas): o saldo dela
    // está na moeda e ficaria misturado.
    const { rows } = await db.query(
      `SELECT data->>'moeda' AS moeda, data->>'nome' AS nome FROM contas_bancarias WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    const moeda = String(rows[0]?.moeda ?? '').trim();
    if (rows[0] && moeda && moeda !== 'BRL') {
      throw new ErroMovimentoCaixa(
        `A conta ${String(rows[0].nome || 'escolhida')} é em ${moeda}. Pagamento em reais não entra nela: escolha uma conta em reais, ou liquide pela tela de liquidação informando o câmbio.`);
    }
  }
  // Depois do UPDATE (que esperou a trava da conta): se a abertura do razão
  // terminou enquanto este movimento esperava, ele já enxerga e entra.
  if (moveu) await registrarMovimento(db, tenantId, id, valor, origem);
  return moveu;
}

/**
 * O movimento de caixa não aconteceu: conta bancária inexistente, de outra
 * agência, apagada no meio do caminho, ou Caixa Geral impossível de criar.
 * Quem recebe isto desfaz a transação inteira: uma baixa nunca pode ficar
 * RECEBIDA/PAGA sem o dinheiro correspondente no saldo (auditoria 04/11, FIN2-02).
 */
export class ErroMovimentoCaixa extends Error {
  status = 409;
  constructor(message = 'A conta bancária desta baixa não existe nesta agência. Escolha outra conta e tente de novo.') {
    super(message);
    this.name = 'ErroMovimentoCaixa';
  }
}

/** Como aplicarMovimentoCaixaAtomico, mas falha (lança) quando nenhuma conta foi movida. */
export async function moverCaixaOuFalhar(
  tenantId: string,
  contaId: string | null | undefined,
  delta: number,
  exec: ExecutorSQL | undefined,
  origem: OrigemDoMovimento,
): Promise<void> {
  if (!round2(num(delta))) return;
  const ok = await aplicarMovimentoCaixaAtomico(tenantId, contaId, delta, exec, origem);
  if (!ok) throw new ErroMovimentoCaixa();
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
  // Ao APAGAR a conta, banco que não existe mais não tem saldo a corrigir
  // (o saldo dele sumiu junto). Recusar aqui travaria a exclusão para
  // sempre; por isso só registra. Na edição (estorno pelo PUT) a regra é
  // estrita: moverCaixaOuFalhar.
  const ok = await aplicarMovimentoCaixaAtomico(tenantId, conta, round2(valor * sinal), exec, {
    tipo: tabela === 'contas_receber' ? 'exclusao_receber' : 'exclusao_pagar',
    tabela,
    id: typeof data.id === 'string' ? data.id : undefined,
    pessoaId: pessoaDaConta(tabela, data),
  });
  if (!ok) console.warn(`[caixa] estorno sem conta bancária no tenant ${tenantId} (conta ${conta ?? 'Caixa Geral'})`);
}

/** Cliente (a receber) ou fornecedor (a pagar) da conta, para o razão. */
export function pessoaDaConta(tabela: string, data: Record<string, unknown>): string | undefined {
  const v = tabela === 'contas_pagar' ? data.fornecedor_id : data.cliente_id;
  return typeof v === 'string' && v ? v : undefined;
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
