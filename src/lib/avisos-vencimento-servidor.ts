/**
 * Tarefa diária do aviso de vencimento (05/11/2026). A regra mora em
 * ./avisos-vencimento.ts.
 *
 * A partir das 7h de Brasília, uma vez por dia e por agência (a janela do
 * agendador garante), cria no sino os avisos ligados em Configurações ›
 * Financeiro. A chave de deduplicação do dia impede repetir mesmo que a
 * janela seja refeita. Respeita "nada sai": durante importação ou ensaio,
 * nenhum aviso.
 *
 * Registrar em src/lib/agendador/tarefas.ts (quem integra a entrega).
 */
import type { ExecutorSQL } from './caixa-atomico';
import { addDias } from './money';
import { nadaSai } from './nada-sai';
import { criarNotificacao } from './notificacoes';
import { horaDeBrasilia, janelaDiaria, type DefinicaoTarefa } from './agendador/nucleo';
import {
  algumAvisoLigado, montarAvisos, normalizarAvisos, saldoEmAberto,
  type Aviso, type ContaEmAberto, type PreferenciaAvisos,
} from './avisos-vencimento';

async function preferenciaDa(exec: ExecutorSQL, tenantId: string): Promise<PreferenciaAvisos> {
  const { rows } = await exec.query(
    `SELECT data->'avisos_vencimento' AS a FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return normalizarAvisos(rows[0]?.a);
}

function paraConta(tabela: ContaEmAberto['tabela'], id: unknown, d: Record<string, unknown>): ContaEmAberto {
  return {
    tabela,
    id: String(id),
    descricao: String(d.descricao ?? ''),
    pessoa: String((tabela === 'contas_pagar' ? d.fornecedor_nome : d.cliente_nome) ?? ''),
    vencimento: String(d.data_vencimento ?? '').slice(0, 10),
    saldo: saldoEmAberto(d, tabela),
  };
}

/** As contas que podem gerar aviso hoje, já com o saldo em aberto. */
export async function contasParaAvisar(
  exec: ExecutorSQL, tenantId: string, hoje: string, pref: PreferenciaAvisos,
): Promise<ContaEmAberto[]> {
  const contas: ContaEmAberto[] = [];
  const dias = [pref.pagar_hoje ? hoje : null, pref.pagar_amanha ? addDias(hoje, 1) : null].filter(Boolean) as string[];
  if (dias.length) {
    const { rows } = await exec.query(
      `SELECT id, data FROM contas_pagar
        WHERE tenant_id = $1 AND COALESCE(data->>'status', '') NOT IN ('PAGO', 'CANCELADO')
          AND LEFT(COALESCE(data->>'data_vencimento', ''), 10) = ANY($2::text[])`,
      [tenantId, dias],
    );
    for (const r of rows) contas.push(paraConta('contas_pagar', r.id, (r.data ?? {}) as Record<string, unknown>));
  }
  if (pref.receber_atrasadas) {
    const { rows } = await exec.query(
      `SELECT id, data FROM contas_receber
        WHERE tenant_id = $1 AND COALESCE(data->>'status', '') NOT IN ('RECEBIDO', 'CANCELADO')
          AND COALESCE(data->>'data_vencimento', '') <> '' AND LEFT(data->>'data_vencimento', 10) < $2`,
      [tenantId, hoje],
    );
    for (const r of rows) contas.push(paraConta('contas_receber', r.id, (r.data ?? {}) as Record<string, unknown>));
  }
  return contas;
}

/** Cria os avisos do dia de uma agência. Devolve o que foi avisado. */
export async function avisarVencimentos(
  exec: ExecutorSQL, tenantId: string, agora: Date,
): Promise<{ avisos: number; motivo?: string }> {
  const motivo = nadaSai();
  if (motivo) return { avisos: 0, motivo: `nada sai: ${motivo}` };
  const pref = await preferenciaDa(exec, tenantId);
  if (!algumAvisoLigado(pref)) return { avisos: 0, motivo: 'avisos desligados' };
  const hoje = horaDeBrasilia(agora).data;
  const avisos: Aviso[] = montarAvisos(await contasParaAvisar(exec, tenantId, hoje, pref), hoje, pref);
  for (const a of avisos) {
    await criarNotificacao({
      tenantId, tipo: a.tipo, titulo: a.titulo, descricao: a.descricao, link: a.link,
      data: a.dados, chaveDeduplicacao: a.chave,
    }, exec);
  }
  return { avisos: avisos.length };
}

/** Tarefa do agendador: todo dia a partir das 7h de Brasília. */
export const tarefaAvisosVencimento: DefinicaoTarefa = {
  nome: 'avisos-vencimento',
  janela: janelaDiaria(7),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(
      `SELECT tenant_id FROM (
         SELECT DISTINCT tenant_id FROM contas_pagar
          WHERE tenant_id <> '' AND COALESCE(data->>'status', '') NOT IN ('PAGO', 'CANCELADO')
         UNION
         SELECT DISTINCT tenant_id FROM contas_receber
          WHERE tenant_id <> '' AND COALESCE(data->>'status', '') NOT IN ('RECEBIDO', 'CANCELADO')
       ) t ORDER BY tenant_id`,
    );
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ exec, agora }, tenantId) => avisarVencimentos(exec, tenantId, agora),
};
