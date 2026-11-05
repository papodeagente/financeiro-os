/**
 * Tarefas do agendador (05/11/2026). Cada entrega acrescenta as suas aqui.
 */
import pool, { initDB } from '../db';
import { emTransacao, type ExecutorSQL } from '../caixa-atomico';
import { abrirRazaoNoExecutor, conferirRazaoNoExecutor } from '../razao-servidor';
import { processarFila } from './fila';
import { tarefaRecorrenciaGerar } from '../recorrencia-servidor';
import { tarefaAvisosVencimento } from '../avisos-vencimento-servidor';
import { janelaDeMinutos, janelaDiaria, rodarAgendador, type DefinicaoTarefa, type ResumoAgendador } from './nucleo';

/** Abre o razão das agências que ainda não têm (até 20 por chamada). */
export const tarefaRazaoAbertura: DefinicaoTarefa = {
  nome: 'razao-abertura',
  janela: janelaDeMinutos(5),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(
      `SELECT DISTINCT c.tenant_id FROM contas_bancarias c
        WHERE c.tenant_id <> '' AND NOT EXISTS (SELECT 1 FROM razao_estado e WHERE e.tenant_id = c.tenant_id)
        ORDER BY c.tenant_id LIMIT 20`,
    );
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ emTransacao: tx }, tenantId) => {
    const r = await tx(exec => abrirRazaoNoExecutor(exec, tenantId));
    return { contas: r.contas, diferencas_para_revisar: r.diferencas.length };
  },
};

/** Conferência diária razão × saldo, a partir das 3h de Brasília. */
export const tarefaRazaoConferencia: DefinicaoTarefa = {
  nome: 'razao-conferencia',
  janela: janelaDiaria(3),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(`SELECT tenant_id FROM razao_estado ORDER BY tenant_id`);
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ exec }, tenantId) => {
    const r = await conferirRazaoNoExecutor(exec, tenantId);
    const comDiferenca = r.linhas.filter(l => l.diferenca !== 0).length;
    return { contas: r.linhas.length, com_diferenca: comDiferenca, falhas_recentes: r.falhas_recentes };
  },
};

/** Fila de tarefas por agência (cobrança, régua, importações). */
export const tarefaFila: DefinicaoTarefa = {
  nome: 'fila',
  janela: janelaDeMinutos(1),
  executar: async ({ exec, restanteMs }) => processarFila(exec, { orcamentoMs: Math.min(30_000, restanteMs()) }),
};

export const TAREFAS: DefinicaoTarefa[] = [tarefaRazaoAbertura, tarefaRazaoConferencia, tarefaRecorrenciaGerar, tarefaAvisosVencimento, tarefaFila];

/** Roda o agendador contra o banco de verdade. */
export async function executarAgendadorAgora(): Promise<ResumoAgendador> {
  await initDB();
  if (!pool) throw new Error('Banco indisponível');
  const p = pool;
  return rodarAgendador({
    tarefas: TAREFAS,
    conexao: async () => {
      const client = await p.connect();
      return { exec: client as unknown as ExecutorSQL, liberar: () => client.release() };
    },
    emTransacao,
  });
}
