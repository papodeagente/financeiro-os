/**
 * Conta bancária com movimento não se exclui (06/11/2026, E7).
 *
 * Excluir apagava o cadastro mesmo com títulos pagos nela, transferências e
 * extrato: o dinheiro desses lançamentos ficava apontando para uma conta que
 * não existe mais (relatórios sem nome, saldo total sem ela, conciliação
 * órfã). Agora a exclusão só vale para a conta que nunca foi usada; a que tem
 * movimento se DESATIVA (some dos seletores, continua nos relatórios).
 *
 * "Movimento" = qualquer coisa que aponte para a conta: título a pagar ou a
 * receber (pago nela ou previsto nela), baixa, transferência, linha de
 * extrato, lançamento no razão além da abertura, ou saldo diferente do
 * inicial. Tabela que ainda não existe no banco não conta.
 */
import type { ExecutorSQL } from './caixa-atomico';

export interface UsoDaConta {
  /** Rótulo legível de onde a conta aparece ("3 contas a pagar"...). */
  onde: string[];
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

async function existe(exec: ExecutorSQL, tabela: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${tabela}`]);
  return rows[0]?.ok === true;
}

async function contar(exec: ExecutorSQL, sql: string, valores: unknown[]): Promise<number> {
  const { rows } = await exec.query(sql, valores);
  return Number(rows[0]?.n ?? 0);
}

/** Onde a conta já foi usada. `onde` vazio = pode excluir. */
export async function usoDaContaBancaria(exec: ExecutorSQL, tenantId: string, contaId: string): Promise<UsoDaConta> {
  const onde: string[] = [];
  const v = [tenantId, contaId];
  for (const [tabela, um, varios] of [['contas_pagar', 'conta a pagar', 'contas a pagar'], ['contas_receber', 'conta a receber', 'contas a receber']] as const) {
    if (!(await existe(exec, tabela))) continue;
    const n = await contar(exec,
      `SELECT COUNT(*)::int AS n FROM ${tabela} WHERE tenant_id = $1 AND (data->>'conta_bancaria_id' = $2 OR data->>'conta_previsao_id' = $2)`, v);
    if (n > 0) onde.push(plural(n, um, varios));
  }
  if (await existe(exec, 'contas_excluidas')) {
    const n = await contar(exec,
      `SELECT COUNT(*)::int AS n FROM contas_excluidas WHERE tenant_id = $1 AND (baixa_estornada->>'conta_bancaria_id' = $2 OR data->>'conta_bancaria_id' = $2)`, v);
    if (n > 0) onde.push(plural(n, 'conta excluída que passou por ela', 'contas excluídas que passaram por ela'));
  }
  if (await existe(exec, 'baixas')) {
    const n = await contar(exec, `SELECT COUNT(*)::int AS n FROM baixas WHERE tenant_id = $1 AND conta_bancaria_id = $2`, v);
    if (n > 0) onde.push(plural(n, 'pagamento ou recebimento registrado', 'pagamentos ou recebimentos registrados'));
  }
  if (await existe(exec, 'transferencias')) {
    const n = await contar(exec,
      `SELECT COUNT(*)::int AS n FROM transferencias WHERE tenant_id = $1
          AND (data->>'conta_origem_id' = $2 OR data->>'conta_destino_id' = $2 OR conta_origem_id = $2 OR conta_destino_id = $2)`, v);
    if (n > 0) onde.push(plural(n, 'transferência', 'transferências'));
  }
  if (await existe(exec, 'extrato_bancario')) {
    const n = await contar(exec,
      `SELECT COUNT(*)::int AS n FROM extrato_bancario WHERE tenant_id = $1 AND (conta_bancaria_id = $2 OR data->>'conta_bancaria_id' = $2)`, v);
    if (n > 0) onde.push(plural(n, 'linha de extrato', 'linhas de extrato'));
  }
  if (await existe(exec, 'razao_partidas') && await existe(exec, 'razao_lancamentos')) {
    const n = await contar(exec,
      `SELECT COUNT(*)::int AS n FROM razao_partidas p JOIN razao_lancamentos l ON l.tenant_id = p.tenant_id AND l.id = p.lancamento_id
        WHERE p.tenant_id = $1 AND p.conta_bancaria_id = $2 AND l.tipo_evento <> 'abertura'`, v);
    if (n > 0) onde.push(plural(n, 'lançamento no razão', 'lançamentos no razão'));
  }
  const { rows } = await exec.query(
    `SELECT data->>'saldo_atual' AS a, data->>'saldo_inicial' AS i FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`, v);
  const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
  if (rows[0] && num(rows[0].a) !== num(rows[0].i) && onde.length === 0) onde.push('saldo diferente do saldo inicial');
  return { onde };
}

/** A frase da recusa da exclusão. */
export function mensagemContaComMovimento(onde: readonly string[]): string {
  const lista = onde.length <= 1 ? (onde[0] ?? 'movimentos') : `${onde.slice(0, -1).join(', ')} e ${onde[onde.length - 1]}`;
  return `Esta conta já foi usada (${lista}) e não pode ser excluída: o histórico perderia a conta. Desative a conta: ela some das telas de lançar, pagar e receber e continua nos relatórios.`;
}
