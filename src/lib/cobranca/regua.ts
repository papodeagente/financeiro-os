/**
 * Régua de cobrança (05/11/2026): tarefa diária, a partir das 8h de
 * Brasília, uma vez por agência (a janela do agendador garante).
 *
 * 1. Cobrança aberta com vencimento já passado vira "vencida" (o Pagar.me
 *    não avisa vencimento; o Asaas avisa, e aqui só confirma).
 * 2. Se a agência LIGOU a régua: para cada cobrança aberta ou vencida cujo
 *    dia de hoje é um dos dias da régua (−5, 0, 1, 3, 7 por padrão), manda
 *    COBRANCA_LEMBRETE ao CRM. A chave (cobrança, dia) em
 *    `cobranca_lembretes` impede repetir, mesmo que a janela rode de novo.
 *
 * "Nada sai": durante importação ou ensaio, nenhum lembrete.
 *
 * Registrar `tarefaReguaCobranca` em src/lib/agendador/tarefas.ts (quem
 * integra a entrega). Importar este módulo também registra os
 * processadores da fila da cobrança.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { registrarProcessador } from '../agendador/fila';
import { horaDeBrasilia, janelaDiaria, type DefinicaoTarefa } from '../agendador/nucleo';
import { nadaSai } from '../nada-sai';
import { addDias } from '../money';
import { diaDaReguaHoje } from './calculo';
import { lerConfigCobranca } from './config';
import { avisarCrm } from './crm';
import {
  cobrancaParaCrm, COLUNAS_DA_COBRANCA, lerLinha, marcarNaConta, processarTarefaDeAtualizacao, processarTarefaDeEmissao,
  registrarEvento, TAREFA_ATUALIZAR, TAREFA_EMITIR,
} from './servidor';

/** Liga os processadores da fila da cobrança (idempotente). */
export function registrarProcessadoresDaCobranca(): void {
  registrarProcessador(TAREFA_EMITIR, processarTarefaDeEmissao);
  registrarProcessador(TAREFA_ATUALIZAR, processarTarefaDeAtualizacao);
}
registrarProcessadoresDaCobranca();

/** Marca como vencidas as abertas com vencimento antes de hoje. */
export async function marcarVencidas(exec: ExecutorSQL, tenantId: string, hoje: string): Promise<number> {
  const { rows } = await exec.query(
    `UPDATE cobrancas SET status = 'vencida', atualizado_em = NOW()
      WHERE tenant_id = $1 AND status = 'aberta' AND vencimento < $2::date
      RETURNING ${COLUNAS_DA_COBRANCA}`,
    [tenantId, hoje],
  );
  for (const r of rows) {
    const c = lerLinha(r);
    await registrarEvento(exec, tenantId, c.id, 'vencida', 'aberta', 'vencida', { pela: 'régua diária' });
    await marcarNaConta(exec, c);
  }
  return rows.length;
}

export async function rodarRegua(
  exec: ExecutorSQL, tenantId: string, agora: Date,
): Promise<{ vencidas: number; lembretes: number; motivo?: string }> {
  const hoje = horaDeBrasilia(agora).data;
  const vencidas = await marcarVencidas(exec, tenantId, hoje);
  const motivo = nadaSai();
  if (motivo) return { vencidas, lembretes: 0, motivo: `nada sai: ${motivo}` };
  const { config } = await lerConfigCobranca(exec, tenantId);
  if (!config.regua.ligada || !config.regua.dias.length) return { vencidas, lembretes: 0, motivo: 'régua desligada' };
  const dias = config.regua.dias;
  const de = addDias(hoje, -Math.max(...dias));
  const ate = addDias(hoje, -Math.min(...dias));
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_DA_COBRANCA} FROM cobrancas
      WHERE tenant_id = $1 AND status IN ('aberta','vencida') AND vencimento BETWEEN $2::date AND $3::date
      ORDER BY vencimento, id`,
    [tenantId, de, ate],
  );
  let lembretes = 0;
  for (const r of rows) {
    const c = lerLinha(r);
    const dia = diaDaReguaHoje(c.vencimento, hoje, dias);
    if (dia === null) continue;
    const reservado = await exec.query(
      `INSERT INTO cobranca_lembretes (tenant_id, cobranca_id, dia, data_aviso) VALUES ($1, $2, $3, $4::date)
       ON CONFLICT (tenant_id, cobranca_id, dia) DO NOTHING RETURNING dia`,
      [tenantId, c.id, dia, hoje],
    );
    if (!reservado.rows.length) continue;
    await avisarCrm(exec, tenantId, 'COBRANCA_LEMBRETE', cobrancaParaCrm(c), `cobranca-lembrete:${tenantId}:${c.id}:${dia}`,
      { dias: dia, canais: config.regua.canais });
    await registrarEvento(exec, tenantId, c.id, 'lembrete', c.status, c.status, { dias: dia, canais: config.regua.canais });
    lembretes++;
  }
  return { vencidas, lembretes };
}

/** Tarefa do agendador: todo dia a partir das 8h de Brasília. */
export const tarefaReguaCobranca: DefinicaoTarefa = {
  nome: 'cobranca-regua',
  janela: janelaDiaria(8),
  agencias: async ({ exec }) => {
    const { rows: tem } = await exec.query(`SELECT to_regclass('public.cobrancas') IS NOT NULL AS ok`);
    if (!tem[0]?.ok) return [];
    const { rows } = await exec.query(
      `SELECT DISTINCT tenant_id FROM cobrancas WHERE status IN ('aberta','vencida') ORDER BY tenant_id`,
    );
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ exec, agora }, tenantId) => rodarRegua(exec, tenantId, agora),
};
