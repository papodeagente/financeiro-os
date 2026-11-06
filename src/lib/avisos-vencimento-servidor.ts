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
import { mudancaSegurandoSaidas } from './migracao/estado';
import { criarNotificacao } from './notificacoes';
import { horaDeBrasilia, janelaDiaria, type DefinicaoTarefa } from './agendador/nucleo';
import {
  algumAvisoLigado, montarAvisos, normalizarAvisos, saldoEmAberto,
  type Aviso, type ContaEmAberto, type PreferenciaAvisos,
} from './avisos-vencimento';
import {
  normalizarAvisoWhatsApp, resumoDoDia, resumoVazio, textoDoResumo, type AvisoWhatsApp,
} from './avisos-vencimento-whatsapp';

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

// ─── WhatsApp para a equipe (E7) ────────────────────────────────────────────

export const EVENTO_AVISO_WHATSAPP = 'FINANCEIRO_AVISO_VENCIMENTOS';

async function avisoWhatsAppDa(exec: ExecutorSQL, tenantId: string): Promise<{ aviso: AvisoWhatsApp; agencia: string }> {
  const { rows } = await exec.query(
    `SELECT data->'avisos_vencimento_whatsapp' AS w, COALESCE(data->>'nome_fantasia', data->>'nome', data->>'razao_social', '') AS nome
       FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return { aviso: normalizarAvisoWhatsApp(rows[0]?.w), agencia: String(rows[0]?.nome ?? '').trim() };
}

/** Contas com saldo que vencem hoje ou já venceram, a pagar e a receber. */
async function contasDoResumo(exec: ExecutorSQL, tenantId: string, hoje: string): Promise<ContaEmAberto[]> {
  const contas: ContaEmAberto[] = [];
  for (const [tabela, quitados] of [['contas_pagar', ['PAGO', 'CANCELADO']], ['contas_receber', ['RECEBIDO', 'CANCELADO']]] as const) {
    const { rows } = await exec.query(
      `SELECT id, data FROM ${tabela}
        WHERE tenant_id = $1 AND COALESCE(data->>'status', '') <> ALL($3::text[])
          AND COALESCE(data->>'data_vencimento', '') <> '' AND LEFT(data->>'data_vencimento', 10) <= $2`,
      [tenantId, hoje, quitados],
    );
    for (const r of rows) contas.push(paraConta(tabela, r.id, (r.data ?? {}) as Record<string, unknown>));
  }
  return contas;
}

export type ResultadoDoWhatsApp = { enviado: boolean; destinos?: number; motivo?: string };

/**
 * O resumo do dia pelo WhatsApp do CRM, uma vez por dia (a chave do evento é
 * a agência + o dia: rodar de novo não repete). Chamar depois de conferir
 * "nada sai". Desligado ou sem número: não faz nada.
 */
export async function avisarPorWhatsApp(exec: ExecutorSQL, tenantId: string, hoje: string): Promise<ResultadoDoWhatsApp | null> {
  const { aviso, agencia } = await avisoWhatsAppDa(exec, tenantId);
  if (!aviso.ligado || !aviso.telefones.length) return null;
  const chave = `aviso-vencimento-whatsapp:${tenantId}:${hoje}`;
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.crm_eventos_saida') IS NOT NULL AS ok`);
  if (tem[0]?.ok) {
    const { rows: ja } = await exec.query(`SELECT 1 FROM crm_eventos_saida WHERE id = $1 LIMIT 1`, [chave]);
    if (ja.length) return { enviado: false, motivo: 'já enviado hoje' };
  }
  const { crmLigado } = await import('./cobranca/crm');
  if (!(await crmLigado(exec, tenantId))) return { enviado: false, motivo: 'o WhatsApp sai pelo CRM, e a integração com o CRM está desligada' };
  const resumo = resumoDoDia(await contasDoResumo(exec, tenantId, hoje), hoje);
  if (resumoVazio(resumo)) return { enviado: false, motivo: 'nada vence hoje nem está em atraso' };
  const { getDefaultPublicBase } = await import('./proposta-link');
  const url = `${getDefaultPublicBase()}/financeiro-ag`;
  const { emitirEventoCRM } = await import('./crm-integration');
  await emitirEventoCRM(EVENTO_AVISO_WHATSAPP, {
    data: hoje,
    agencia,
    destinatarios: aviso.telefones,
    texto: textoDoResumo(resumo, hoje, agencia, url),
    resumo,
    url,
  }, { tenantId, idempotency_key: chave });
  return { enviado: true, destinos: aviso.telefones.length };
}

/** Cria os avisos do dia de uma agência. Devolve o que foi avisado. */
export async function avisarVencimentos(
  exec: ExecutorSQL, tenantId: string, agora: Date,
): Promise<{ avisos: number; motivo?: string; whatsapp?: ResultadoDoWhatsApp }> {
  // Mudança do sistema anterior em andamento: nenhum aviso até concluir.
  const motivo = nadaSai() ?? (await mudancaSegurandoSaidas(exec, tenantId));
  if (motivo) return { avisos: 0, motivo: `nada sai: ${motivo}` };
  const hoje = horaDeBrasilia(agora).data;
  // WhatsApp para a equipe (E7): independente dos avisos do sino; desligado = null (nada muda).
  const whatsapp = await avisarPorWhatsApp(exec, tenantId, hoje).catch(e => {
    console.error('[avisos-vencimento] WhatsApp:', e instanceof Error ? e.message : e);
    return { enviado: false, motivo: 'falha ao montar o aviso' } as ResultadoDoWhatsApp;
  });
  const comWhatsApp = whatsapp ? { whatsapp } : {};
  const pref = await preferenciaDa(exec, tenantId);
  if (!algumAvisoLigado(pref)) return { avisos: 0, motivo: 'avisos desligados', ...comWhatsApp };
  const avisos: Aviso[] = montarAvisos(await contasParaAvisar(exec, tenantId, hoje, pref), hoje, pref);
  for (const a of avisos) {
    await criarNotificacao({
      tenantId, tipo: a.tipo, titulo: a.titulo, descricao: a.descricao, link: a.link,
      data: a.dados, chaveDeduplicacao: a.chave,
    }, exec);
  }
  return { avisos: avisos.length, ...comWhatsApp };
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
