/**
 * Fila de tarefas por agência (05/11/2026).
 *
 * Usada pelo que fala com sistemas de fora (cobrança no Asaas/Pagar.me, régua
 * de avisos, importações). Regras:
 * - justiça entre agências: cada rodada pega no máximo N tarefas de cada
 *   agência, então uma agência com 2 mil cobranças não atrasa a que tem uma;
 * - a mesma tarefa (agência + tipo + chave) nunca entra duas vezes;
 * - erro devolve a tarefa para a fila com espera crescente; depois de 6
 *   tentativas ela fica 'falhou' e aparece para revisão.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { generateId } from '../utils';

export interface NovaTarefa {
  tenantId: string;
  tipo: string;
  chaveIdem: string;
  dados?: Record<string, unknown>;
  /** ISO; padrão = agora. */
  proximaEm?: string;
}

export interface TarefaReivindicada {
  id: string;
  tenant_id: string;
  tipo: string;
  chave_idem: string;
  tentativas: number;
  dados: Record<string, unknown>;
}

/** Espera antes da nova tentativa, em segundos (1 min, 5 min, 30 min, 2 h, 12 h). */
export const ESPERAS_SEGUNDOS = [60, 300, 1800, 7200, 43200];
export const TENTATIVAS_MAXIMAS = 6;

/** Enfileira; devolve false se a mesma tarefa já existe. */
export async function enfileirarTarefa(exec: ExecutorSQL, t: NovaTarefa): Promise<boolean> {
  const { rows } = await exec.query(
    `INSERT INTO tarefas (id, tenant_id, tipo, chave_idem, dados, proxima_em)
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()))
     ON CONFLICT (tenant_id, tipo, chave_idem) DO NOTHING
     RETURNING id`,
    [generateId(), t.tenantId, t.tipo, t.chaveIdem, JSON.stringify(t.dados ?? {}), t.proximaEm ?? null],
  );
  return rows.length > 0;
}

/**
 * Reivindica tarefas vencidas, no máximo `porAgencia` de cada agência e
 * `total` ao todo, marcando-as 'processando'.
 */
export async function reivindicarTarefas(
  exec: ExecutorSQL,
  opts: { porAgencia?: number; total?: number; tipos?: string[] } = {},
): Promise<TarefaReivindicada[]> {
  const porAgencia = opts.porAgencia ?? 5;
  const total = opts.total ?? 50;
  const tipos = opts.tipos && opts.tipos.length ? opts.tipos : null;
  const { rows } = await exec.query(
    `UPDATE tarefas SET status = 'processando', tentativas = tentativas + 1, atualizado_em = NOW()
      WHERE id IN (
        SELECT id FROM tarefas
         WHERE id IN (
           SELECT id FROM (
             SELECT id, proxima_em,
                    ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY proxima_em, id) AS rn
               FROM tarefas
              WHERE status = 'pendente' AND proxima_em <= NOW()
                AND ($3::text[] IS NULL OR tipo = ANY($3::text[]))
           ) x
            WHERE x.rn <= $1
            ORDER BY x.rn, x.proxima_em
            LIMIT $2
         )
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id, tipo, chave_idem, tentativas, dados`,
    [porAgencia, total, tipos],
  );
  return rows.map(r => ({
    id: String(r.id), tenant_id: String(r.tenant_id), tipo: String(r.tipo), chave_idem: String(r.chave_idem),
    tentativas: Number(r.tentativas), dados: (r.dados ?? {}) as Record<string, unknown>,
  }));
}

export async function concluirTarefa(exec: ExecutorSQL, id: string, resultado?: Record<string, unknown>): Promise<void> {
  await exec.query(
    `UPDATE tarefas SET status = 'concluida', erro = NULL, atualizado_em = NOW(),
            dados = dados || jsonb_build_object('resultado', $2::jsonb)
      WHERE id = $1`,
    [id, JSON.stringify(resultado ?? {})],
  );
}

/** Erro: volta para a fila com espera crescente, ou desiste depois do limite. */
export async function falharTarefa(exec: ExecutorSQL, t: Pick<TarefaReivindicada, 'id' | 'tentativas'>, erro: string): Promise<'repetir' | 'falhou'> {
  if (t.tentativas >= TENTATIVAS_MAXIMAS) {
    await exec.query(`UPDATE tarefas SET status = 'falhou', erro = $2, atualizado_em = NOW() WHERE id = $1`, [t.id, erro.slice(0, 2000)]);
    return 'falhou';
  }
  const espera = ESPERAS_SEGUNDOS[Math.min(t.tentativas - 1, ESPERAS_SEGUNDOS.length - 1)] ?? 60;
  await exec.query(
    `UPDATE tarefas SET status = 'pendente', erro = $2, proxima_em = NOW() + ($3 || ' seconds')::interval, atualizado_em = NOW()
      WHERE id = $1`,
    [t.id, erro.slice(0, 2000), String(espera)],
  );
  return 'repetir';
}

export type ProcessadorDeTarefa = (t: TarefaReivindicada) => Promise<Record<string, unknown> | void>;

/** Tipos de tarefa conhecidos. Cada entrega registra os seus (cobrança, régua...). */
export const PROCESSADORES: Record<string, ProcessadorDeTarefa> = {};

export function registrarProcessador(tipo: string, fn: ProcessadorDeTarefa): void {
  PROCESSADORES[tipo] = fn;
}

/**
 * Uma rodada da fila: reivindica e processa até acabar o orçamento de tempo.
 * Tarefa de tipo sem processador volta para a fila (não se perde).
 */
export async function processarFila(
  exec: ExecutorSQL,
  opts: { orcamentoMs?: number; porAgencia?: number; total?: number; agora?: () => number } = {},
): Promise<{ processadas: number; falhas: number }> {
  const agora = opts.agora ?? (() => Date.now());
  const fim = agora() + (opts.orcamentoMs ?? 30_000);
  const tipos = Object.keys(PROCESSADORES);
  if (tipos.length === 0) return { processadas: 0, falhas: 0 };
  let processadas = 0;
  let falhas = 0;
  while (agora() < fim) {
    const lote = await reivindicarTarefas(exec, { porAgencia: opts.porAgencia, total: opts.total, tipos });
    if (lote.length === 0) break;
    for (const t of lote) {
      try {
        const r = await PROCESSADORES[t.tipo](t);
        await concluirTarefa(exec, t.id, r ?? undefined);
        processadas++;
      } catch (e) {
        falhas++;
        await falharTarefa(exec, t, e instanceof Error ? e.message : String(e));
      }
    }
  }
  return { processadas, falhas };
}
