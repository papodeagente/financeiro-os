/**
 * Agendador do Financeiro (05/11/2026).
 *
 * Uma função, rodarAgendador(), chamada a cada 5 minutos — pelo temporizador
 * interno (src/instrumentation.ts) e, se configurado, pela tarefa agendada do
 * Coolify via POST /api/agendador. As duas formas são seguras juntas:
 * - cada tarefa roda sob uma trava do banco (pg_try_advisory_lock): se outra
 *   chamada já está rodando aquela tarefa, esta pula;
 * - cada tarefa tem janelas (ex.: "o dia de hoje"); a mesma janela da mesma
 *   agência roda uma vez só (agendador_execucoes);
 * - erro numa agência abre o disjuntor DAQUELA agência por 30 minutos depois
 *   de 5 falhas seguidas, sem parar as outras;
 * - cada chamada tem orçamento de tempo; o que não coube continua na próxima.
 */
import type { ExecutorSQL } from '../caixa-atomico';

export interface ContextoTarefa {
  exec: ExecutorSQL;
  /** Transação própria (para trabalho que precisa de BEGIN/COMMIT). */
  emTransacao: <T>(fn: (tx: ExecutorSQL) => Promise<T>) => Promise<T>;
  agora: Date;
  /** Tempo restante desta chamada, em ms. */
  restanteMs: () => number;
}

export interface DefinicaoTarefa {
  nome: string;
  /** Janela vigente (null = não é hora). Ex.: '2026-11-05' para diária. */
  janela: (agora: Date) => string | null;
  /** Agências a atender nesta janela (vazio = tarefa global, uma vez por janela). */
  agencias?: (ctx: ContextoTarefa) => Promise<string[]>;
  /** Trabalho de uma agência (ou global, com tenantId = ''). */
  executar: (ctx: ContextoTarefa, tenantId: string) => Promise<Record<string, unknown> | void>;
}

export const FALHAS_PARA_ABRIR = 5;
export const MINUTOS_DISJUNTOR = 30;

/** Hora e data de Brasília de um instante (banco e servidores ficam em UTC). */
export function horaDeBrasilia(agora: Date): { data: string; hora: number; minuto: number } {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora);
  const v = (t: string) => p.find(x => x.type === t)?.value ?? '00';
  return { data: `${v('year')}-${v('month')}-${v('day')}`, hora: Number(v('hour')), minuto: Number(v('minute')) };
}

/** Janela diária a partir de uma hora de Brasília (antes dela, null). */
export function janelaDiaria(aPartirDaHora: number) {
  return (agora: Date) => {
    const b = horaDeBrasilia(agora);
    return b.hora >= aPartirDaHora ? b.data : null;
  };
}

/** Janela de N minutos (ex.: a cada 5 min, a cada 15 min). */
export function janelaDeMinutos(n: number) {
  return (agora: Date) => {
    const b = horaDeBrasilia(agora);
    const bloco = Math.floor((b.hora * 60 + b.minuto) / n);
    return `${b.data}#${n}m${bloco}`;
  };
}

async function disjuntorAberto(exec: ExecutorSQL, tarefa: string, tenantId: string): Promise<boolean> {
  const { rows } = await exec.query(
    `SELECT 1 FROM agendador_estado WHERE tarefa = $1 AND tenant_id = $2 AND aberto_ate IS NOT NULL AND aberto_ate > NOW()`,
    [tarefa, tenantId],
  );
  return rows.length > 0;
}

async function registrarSucesso(exec: ExecutorSQL, tarefa: string, tenantId: string): Promise<void> {
  await exec.query(
    `INSERT INTO agendador_estado (tarefa, tenant_id, falhas_seguidas, aberto_ate, ultimo_erro, ultima_execucao)
     VALUES ($1, $2, 0, NULL, NULL, NOW())
     ON CONFLICT (tarefa, tenant_id) DO UPDATE SET falhas_seguidas = 0, aberto_ate = NULL, ultima_execucao = NOW()`,
    [tarefa, tenantId],
  );
}

async function registrarFalha(exec: ExecutorSQL, tarefa: string, tenantId: string, erro: string): Promise<void> {
  await exec.query(
    `INSERT INTO agendador_estado (tarefa, tenant_id, falhas_seguidas, ultimo_erro, ultima_execucao)
     VALUES ($1, $2, 1, $3, NOW())
     ON CONFLICT (tarefa, tenant_id) DO UPDATE SET
       falhas_seguidas = agendador_estado.falhas_seguidas + 1,
       ultimo_erro = EXCLUDED.ultimo_erro,
       ultima_execucao = NOW(),
       aberto_ate = CASE WHEN agendador_estado.falhas_seguidas + 1 >= ${FALHAS_PARA_ABRIR}
                         THEN NOW() + INTERVAL '${MINUTOS_DISJUNTOR} minutes' ELSE agendador_estado.aberto_ate END`,
    [tarefa, tenantId, erro.slice(0, 2000)],
  );
}

/** Marca o começo da janela; devolve false se já rodou (ou está rodando). */
async function reservarJanela(exec: ExecutorSQL, tarefa: string, janela: string, tenantId: string): Promise<boolean> {
  const { rows } = await exec.query(
    `INSERT INTO agendador_execucoes (tarefa, janela, tenant_id) VALUES ($1, $2, $3)
     ON CONFLICT (tarefa, janela, tenant_id) DO NOTHING RETURNING tarefa`,
    [tarefa, janela, tenantId],
  );
  return rows.length > 0;
}

async function fecharJanela(exec: ExecutorSQL, tarefa: string, janela: string, tenantId: string, resultado: unknown, ok: boolean): Promise<void> {
  if (ok) {
    await exec.query(
      `UPDATE agendador_execucoes SET terminado_em = NOW(), resultado = $4::jsonb WHERE tarefa = $1 AND janela = $2 AND tenant_id = $3`,
      [tarefa, janela, tenantId, JSON.stringify(resultado ?? {})],
    );
  } else {
    // Falhou: libera a janela para a próxima chamada tentar de novo.
    await exec.query(`DELETE FROM agendador_execucoes WHERE tarefa = $1 AND janela = $2 AND tenant_id = $3`, [tarefa, janela, tenantId]);
  }
}

export interface ResumoAgendador {
  [tarefa: string]: { janela: string | null; ocupada?: boolean; feitas: number; falhas: number; puladas: number; resultado?: unknown };
}

/**
 * Roda todas as tarefas devidas. `trava` recebe uma conexão dedicada (as
 * travas de sessão precisam ficar presas a uma conexão).
 */
export async function rodarAgendador(params: {
  tarefas: DefinicaoTarefa[];
  conexao: () => Promise<{ exec: ExecutorSQL; liberar: () => void }>;
  emTransacao: ContextoTarefa['emTransacao'];
  agora?: Date;
  orcamentoMs?: number;
  relogio?: () => number;
}): Promise<ResumoAgendador> {
  const relogio = params.relogio ?? (() => Date.now());
  const inicio = relogio();
  const orcamento = params.orcamentoMs ?? 45_000;
  const agora = params.agora ?? new Date();
  const resumo: ResumoAgendador = {};
  const { exec, liberar } = await params.conexao();
  try {
    for (const t of params.tarefas) {
      const janela = t.janela(agora);
      const r = (resumo[t.nome] = { janela, feitas: 0, falhas: 0, puladas: 0 } as ResumoAgendador[string]);
      if (!janela) continue;
      if (relogio() - inicio >= orcamento) { r.puladas++; continue; }
      const { rows } = await exec.query(`SELECT pg_try_advisory_lock(hashtext('agendador'), hashtext($1)) AS ok`, [t.nome]);
      if (!rows[0]?.ok) { r.ocupada = true; continue; }
      try {
        const ctx: ContextoTarefa = {
          exec, emTransacao: params.emTransacao, agora,
          restanteMs: () => Math.max(0, orcamento - (relogio() - inicio)),
        };
        const alvos = t.agencias ? await t.agencias(ctx) : [''];
        for (const tenantId of alvos) {
          if (ctx.restanteMs() <= 0) { r.puladas++; continue; }
          if (await disjuntorAberto(exec, t.nome, tenantId)) { r.puladas++; continue; }
          if (!(await reservarJanela(exec, t.nome, janela, tenantId))) continue;
          try {
            const resultado = await t.executar(ctx, tenantId);
            await fecharJanela(exec, t.nome, janela, tenantId, resultado, true);
            await registrarSucesso(exec, t.nome, tenantId);
            r.feitas++;
            if (!t.agencias) r.resultado = resultado;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[agendador] ${t.nome} ${tenantId || '(global)'}: ${msg}`);
            await fecharJanela(exec, t.nome, janela, tenantId, null, false);
            await registrarFalha(exec, t.nome, tenantId, msg);
            r.falhas++;
          }
        }
      } finally {
        await exec.query(`SELECT pg_advisory_unlock(hashtext('agendador'), hashtext($1))`, [t.nome]);
      }
    }
  } finally {
    liberar();
  }
  return resumo;
}
