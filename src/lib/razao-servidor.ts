/**
 * Razão financeiro — parte que fala com o banco (05/11/2026).
 *
 * Regras:
 * - registrarMovimento() é chamado por aplicarMovimentoCaixaAtomico() DEPOIS
 *   do UPDATE do saldo, na mesma transação. Ele nunca lança: qualquer erro do
 *   razão vira uma linha em razao_falhas (feito dentro da função SQL).
 * - A agência só grava no razão depois da abertura (razao_estado). A abertura
 *   trava todas as contas bancárias da agência, grava o saldo de partida de
 *   cada uma igual ao saldo_atual e marca a agência como aberta. Um movimento
 *   que esperava a trava enxerga a marca quando segue, e entra no razão.
 * - A conferência diária compara saldo_atual com o razão, conta por conta.
 */
import { lancamentoDeMovimento, reconstruirSaldos, type OrigemDoMovimento } from './razao';
import { paraCentavos, num } from './money';
import type { ExecutorSQL } from './caixa-atomico';
import { valorMovimentado } from './saldo-bancario';

export type ResultadoRazao = 'ok' | 'duplicado' | 'sem_abertura' | 'falha' | 'zero';

const SALDO_SQL = `ROUND((CASE WHEN data->>'saldo_atual' ~ '^-?[0-9]+([.][0-9]+)?$'
                         THEN (data->>'saldo_atual')::numeric ELSE 0 END) * 100)::bigint`;

/**
 * Grava no razão o movimento que acabou de mexer no saldo da conta.
 * A chave natural usa o id da transação do banco + a conta: dentro de uma
 * transação cada conta recebe no máximo um movimento por origem, e a mesma
 * transação repetida não grava duas vezes.
 */
export async function registrarMovimento(
  exec: ExecutorSQL,
  tenantId: string,
  contaBancariaId: string,
  deltaReais: number,
  origem: OrigemDoMovimento,
): Promise<ResultadoRazao> {
  // Ponto de salvamento: dentro de uma transação, um erro aqui (ex.: banco
  // ainda sem o esquema novo) envenenaria a transação inteira e derrubaria a
  // baixa. Com ele, só o razão volta atrás. Fora de transação o SAVEPOINT
  // falha sozinho e seguimos sem ele.
  let comPonto = false;
  try {
    await exec.query('SAVEPOINT razao_mov');
    comPonto = true;
  } catch {
    comPonto = false;
  }
  try {
    const { rows: tx } = await exec.query(`SELECT txid_current()::text AS t`);
    const lanc = lancamentoDeMovimento(contaBancariaId, deltaReais, origem, `tx${tx[0]?.t ?? '0'}:${contaBancariaId}`);
    let resultado: ResultadoRazao = 'zero';
    if (lanc) {
      const { rows } = await exec.query(`SELECT razao_lancar($1, $2::jsonb, false) AS r`, [tenantId, JSON.stringify(lanc)]);
      resultado = (rows[0]?.r as ResultadoRazao) ?? 'falha';
    }
    if (comPonto) await exec.query('RELEASE SAVEPOINT razao_mov');
    return resultado;
  } catch (e) {
    if (comPonto) {
      try { await exec.query('ROLLBACK TO SAVEPOINT razao_mov'); } catch { /* conexão perdida */ }
    }
    const msg = e instanceof Error ? e.message : String(e);
    // Banco ainda sem o esquema (antes do initDB): avisa uma vez só por processo.
    const semEsquema = /razao_lancar|does not exist|não existe/i.test(msg);
    if (!semEsquema || !avisouSemEsquema) console.error('[razao] movimento não registrado:', msg);
    if (semEsquema) avisouSemEsquema = true;
    return 'falha';
  }
}

let avisouSemEsquema = false;

/** A agência já tem o razão aberto? */
export async function razaoAberto(exec: ExecutorSQL, tenantId: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT 1 FROM razao_estado WHERE tenant_id = $1`, [tenantId]);
  return rows.length > 0;
}

export interface ResultadoAbertura {
  aberto: boolean;
  jaEstava: boolean;
  contas: number;
  diferencas: Array<{ conta_bancaria_id: string; saldo_atual: number; reconstruido: number; diferenca: number }>;
}

/**
 * Abre o razão de uma agência. Roda numa transação (exec já em BEGIN):
 *  1. trava a abertura da agência e todas as contas bancárias dela;
 *  2. grava, para cada conta, o saldo de partida = saldo_atual de agora;
 *  3. marca a agência como aberta;
 *  4. guarda, só para revisão, a diferença entre o saldo de hoje e o que o
 *     "Recalcular saldos" reconstruiria a partir do histórico. Nada é ajustado.
 */
export async function abrirRazaoNoExecutor(exec: ExecutorSQL, tenantId: string): Promise<ResultadoAbertura> {
  await exec.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`razao-abertura:${tenantId}`]);
  if (await razaoAberto(exec, tenantId)) return { aberto: true, jaEstava: true, contas: 0, diferencas: [] };

  const { rows: contas } = await exec.query(
    `SELECT id, data, ${SALDO_SQL} AS saldo_centavos FROM contas_bancarias WHERE tenant_id = $1 ORDER BY id FOR UPDATE`,
    [tenantId],
  );

  const { rows: dia } = await exec.query(`SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d`);
  const hoje = String(dia[0]?.d ?? '');

  for (const c of contas) {
    const centavos = Number(c.saldo_centavos ?? 0);
    if (!centavos) continue;
    const lanc = lancamentoDeMovimento(String(c.id), centavos / 100, {
      tipo: 'abertura', tabela: 'contas_bancarias', id: String(c.id),
    });
    if (!lanc) continue;
    const { rows } = await exec.query(`SELECT razao_lancar($1, $2::jsonb, true) AS r`, [tenantId, JSON.stringify(lanc)]);
    const r = rows[0]?.r;
    if (r !== 'ok' && r !== 'duplicado') {
      // Abertura incompleta não pode ficar marcada como aberta.
      throw new Error(`Abertura do razão falhou na conta ${String(c.id)} (${String(r)}).`);
    }
  }

  // Diferenças para revisão: saldo de hoje × o que o histórico reconstruiria.
  const [{ rows: cr }, { rows: cp }, { rows: tr }] = await Promise.all([
    exec.query(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND (data->>'status') IN ('RECEBIDO','PARCIAL')`, [tenantId]),
    exec.query(`SELECT data FROM contas_pagar WHERE tenant_id = $1 AND (data->>'status') IN ('PAGO','PARCIAL')`, [tenantId]),
    exec.query(`SELECT data FROM transferencias WHERE tenant_id = $1 AND (data->>'status') = 'EFETIVADA'`, [tenantId]),
  ]);
  const caixaGeral = contas.find(c => ((c.data as { nome?: string } | null)?.nome ?? '') === 'Caixa Geral');
  const rec = reconstruirSaldos({
    contas: contas.map(c => ({ id: String(c.id), data: (c.data ?? {}) as Record<string, unknown> })),
    receber: cr.map(r => (r.data ?? {}) as Record<string, unknown>),
    pagar: cp.map(r => (r.data ?? {}) as Record<string, unknown>),
    transferencias: tr.map(r => (r.data ?? {}) as Record<string, unknown>),
    caixaGeralId: caixaGeral ? String(caixaGeral.id) : null,
    valorMovimentado: (d, campo) => valorMovimentado(d as Parameters<typeof valorMovimentado>[0], campo),
  });

  const diferencas: ResultadoAbertura['diferencas'] = [];
  for (const c of contas) {
    const id = String(c.id);
    const atual = Number(c.saldo_centavos ?? 0);
    const reconstruido = paraCentavos(num(rec.saldos[id]));
    const diferenca = atual - reconstruido;
    await exec.query(
      `INSERT INTO razao_conferencias (tenant_id, dia, tipo, conta_bancaria_id, saldo_atual_centavos, razao_centavos, diferenca_centavos, dados)
       VALUES ($1, $2::date, 'abertura', $3, $4, $4, 0, $5::jsonb)
       ON CONFLICT (tenant_id, dia, tipo, conta_bancaria_id) DO NOTHING`,
      [tenantId, hoje, id, atual, JSON.stringify({ reconstruido_pelo_historico_centavos: reconstruido, diferenca_para_revisar_centavos: diferenca })],
    );
    if (diferenca !== 0) diferencas.push({ conta_bancaria_id: id, saldo_atual: atual / 100, reconstruido: reconstruido / 100, diferenca: diferenca / 100 });
  }

  await exec.query(
    `INSERT INTO razao_estado (tenant_id, dados) VALUES ($1, $2::jsonb) ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, JSON.stringify({ contas: contas.length, diferencas_na_abertura: diferencas.length })],
  );
  return { aberto: true, jaEstava: false, contas: contas.length, diferencas };
}

/**
 * Conta bancária criada depois da abertura: o saldo de partida dela entra no
 * razão uma vez só (chave natural fixa por conta).
 */
export async function garantirAberturaDaConta(exec: ExecutorSQL, tenantId: string, contaId: string): Promise<ResultadoRazao> {
  try {
    if (!(await razaoAberto(exec, tenantId))) return 'sem_abertura';
    const { rows } = await exec.query(
      `SELECT ${SALDO_SQL} AS saldo_centavos,
              EXISTS (SELECT 1 FROM razao_partidas p WHERE p.tenant_id = $1 AND p.conta = 'BANCO' AND p.conta_bancaria_id = $2) AS tem
         FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`,
      [tenantId, contaId],
    );
    if (!rows[0] || rows[0].tem) return 'duplicado';
    const centavos = Number(rows[0].saldo_centavos ?? 0);
    const lanc = lancamentoDeMovimento(contaId, centavos / 100, { tipo: 'abertura', tabela: 'contas_bancarias', id: contaId });
    if (!lanc) return 'zero';
    const { rows: r } = await exec.query(`SELECT razao_lancar($1, $2::jsonb, false) AS r`, [tenantId, JSON.stringify(lanc)]);
    return (r[0]?.r as ResultadoRazao) ?? 'falha';
  } catch (e) {
    console.error('[razao] abertura da conta não registrada:', e instanceof Error ? e.message : e);
    return 'falha';
  }
}

export interface LinhaConferencia {
  conta_bancaria_id: string;
  nome: string;
  saldo_atual: number;
  razao: number;
  diferenca: number;
}

/**
 * Conferência: saldo_atual de cada conta × saldo segundo o razão. Grava o
 * resultado do dia (uma linha por conta) e devolve as linhas.
 */
export async function conferirRazaoNoExecutor(exec: ExecutorSQL, tenantId: string, gravar = true): Promise<{
  linhas: LinhaConferencia[];
  falhas_recentes: number;
}> {
  const { rows } = await exec.query(
    `SELECT c.id, COALESCE(c.data->>'nome', '') AS nome, ${SALDO_SQL.replace(/data->>/g, 'c.data->>')} AS saldo_centavos,
            COALESCE(r.saldo_centavos, 0)::bigint AS razao_centavos
       FROM contas_bancarias c
       LEFT JOIN razao_saldo_bancario r ON r.tenant_id = c.tenant_id AND r.conta_bancaria_id = c.id
      WHERE c.tenant_id = $1
      ORDER BY c.id`,
    [tenantId],
  );
  const { rows: dia } = await exec.query(`SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d`);
  const hoje = String(dia[0]?.d ?? '');
  const linhas: LinhaConferencia[] = [];
  for (const r of rows) {
    const atual = Number(r.saldo_centavos ?? 0);
    const razao = Number(r.razao_centavos ?? 0);
    linhas.push({
      conta_bancaria_id: String(r.id), nome: String(r.nome ?? ''),
      saldo_atual: atual / 100, razao: razao / 100, diferenca: (atual - razao) / 100,
    });
    if (gravar) {
      await exec.query(
        `INSERT INTO razao_conferencias (tenant_id, dia, tipo, conta_bancaria_id, saldo_atual_centavos, razao_centavos, diferenca_centavos)
         VALUES ($1, $2::date, 'diaria', $3, $4, $5, $6)
         ON CONFLICT (tenant_id, dia, tipo, conta_bancaria_id)
         DO UPDATE SET saldo_atual_centavos = EXCLUDED.saldo_atual_centavos, razao_centavos = EXCLUDED.razao_centavos,
                       diferenca_centavos = EXCLUDED.diferenca_centavos, criado_em = NOW()`,
        [tenantId, hoje, String(r.id), atual, razao, atual - razao],
      );
    }
  }
  const { rows: f } = await exec.query(
    `SELECT COUNT(*)::int AS n FROM razao_falhas WHERE tenant_id = $1 AND criado_em > NOW() - INTERVAL '1 day'`,
    [tenantId],
  );
  return { linhas, falhas_recentes: Number(f[0]?.n ?? 0) };
}
