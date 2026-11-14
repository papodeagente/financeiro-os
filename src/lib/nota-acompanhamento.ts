/**
 * ACOMPANHAR SOZINHO AS NOTAS NA PREFEITURA (E7, 06/11/2026).
 *
 * A nota transmitida fica PROCESSANDO até a prefeitura responder. Antes,
 * alguém precisava abrir a nota e clicar em "Atualizar status". Agora uma
 * tarefa do agendador consulta sozinha, com intervalo crescente por nota
 * (5 min, 15 min, 1 h, 4 h, 12 h e depois uma vez por dia), pela MESMA
 * consulta do botão (`atualizarStatus`, nfse-servico.ts), e avisa no sino,
 * uma vez, quando a prefeitura recusa, com o motivo.
 *
 * Cada nota guarda o próprio passo em `data.acompanhamento` (tentativas,
 * próxima consulta, aviso dado). Uma nota que não responde não trava as
 * outras, e a falha de rede só empurra a próxima consulta.
 *
 * Registrar `tarefaAcompanharNotas` em src/lib/agendador/tarefas.ts (TAREFAS).
 */
import { criarNotificacao } from './notificacoes';
import { janelaDeMinutos, type DefinicaoTarefa } from './agendador/nucleo';
import type { ExecutorSQL } from './caixa-atomico';
import type { NotaFiscal } from './nfse-tipos';

/** Minutos de espera depois de cada consulta sem resposta final. */
export const INTERVALOS_DO_ACOMPANHAMENTO = [5, 15, 60, 240, 720] as const;
export const MINUTOS_DEPOIS_DO_ULTIMO_INTERVALO = 24 * 60;
/** Notas por agência em cada passada (o resto fica para a próxima). */
export const NOTAS_POR_PASSADA = 20;

/** Quando consultar de novo depois de `tentativas` consultas sem resposta final. */
export function proximaConsulta(tentativas: number, agora: Date): string {
  const i = Math.max(0, tentativas);
  const minutos = i < INTERVALOS_DO_ACOMPANHAMENTO.length ? INTERVALOS_DO_ACOMPANHAMENTO[i] : MINUTOS_DEPOIS_DO_ULTIMO_INTERVALO;
  return new Date(agora.getTime() + minutos * 60_000).toISOString();
}

/** A primeira consulta: 5 minutos depois da emissão. */
export function primeiraConsulta(emitidaEm: string, agora: Date): string {
  const base = Date.parse(emitidaEm);
  return new Date((Number.isFinite(base) ? base : agora.getTime()) + INTERVALOS_DO_ACOMPANHAMENTO[0] * 60_000).toISOString();
}

/** Já é hora de consultar esta nota? */
export function horaDeConsultar(n: Pick<NotaFiscal, 'acompanhamento' | 'emitida_em'>, agora: Date): boolean {
  const proxima = n.acompanhamento?.proxima_em || primeiraConsulta(n.emitida_em, agora);
  return Date.parse(proxima) <= agora.getTime();
}

/** O texto do aviso de recusa no sino. */
export function avisoDeRecusa(n: Pick<NotaFiscal, 'id' | 'numero' | 'tomador' | 'valor_servicos' | 'erro' | 'venda_id'>): { titulo: string; descricao: string; link: string } {
  const quem = n.tomador?.razao_social ? ` para ${n.tomador.razao_social}` : '';
  const valor = `R$ ${Number(n.valor_servicos || 0).toFixed(2).replace('.', ',')}`;
  const motivo = (n.erro || '').trim() || 'A prefeitura não disse o motivo.';
  return {
    titulo: `A prefeitura recusou a nota${quem}`,
    descricao: `Nota de ${valor}. Motivo: ${motivo} Corrija o que foi apontado e emita de novo em Gerar notas.`,
    link: '/financeiro-ag/notas',
  };
}

export type ConsultaDaNota = (tenantId: string, notaId: string) => Promise<NotaFiscal | null>;

export interface ResultadoDoAcompanhamento {
  consultadas: number;
  autorizadas: number;
  recusadas: number;
  canceladas: number;
  sem_resposta: number;
  falhas: number;
}

async function gravarPasso(exec: ExecutorSQL, tenantId: string, id: string, passo: NonNullable<NotaFiscal['acompanhamento']>): Promise<void> {
  await exec.query(
    `UPDATE notas_fiscais SET data = jsonb_set(data, '{acompanhamento}', $3::jsonb, true)
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, JSON.stringify(passo)],
  );
}

/**
 * Uma passada numa agência: consulta as notas na prefeitura cuja hora
 * chegou, guarda o próximo passo e avisa as recusas. `consultar` é a mesma
 * consulta do botão "Atualizar status" (trocável no teste).
 */
export async function acompanharNotasDaAgencia(
  exec: ExecutorSQL, tenantId: string, agora: Date, consultar: ConsultaDaNota,
): Promise<ResultadoDoAcompanhamento> {
  const r: ResultadoDoAcompanhamento = { consultadas: 0, autorizadas: 0, recusadas: 0, canceladas: 0, sem_resposta: 0, falhas: 0 };
  const { rows } = await exec.query(
    `SELECT id, data FROM notas_fiscais
      WHERE tenant_id = $1 AND status = 'PROCESSANDO' AND COALESCE(data->>'emitida_fora', 'false') <> 'true'
        AND COALESCE(data->'acompanhamento'->>'proxima_em', '') <= $2
      ORDER BY COALESCE(data->'acompanhamento'->>'proxima_em', ''), created_at
      LIMIT ${NOTAS_POR_PASSADA * 3}`,
    [tenantId, agora.toISOString()],
  );
  let feitas = 0;
  for (const row of rows) {
    if (feitas >= NOTAS_POR_PASSADA) break;
    const antes = row.data as NotaFiscal;
    if (!horaDeConsultar(antes, agora)) continue;
    feitas++;
    const tentativas = (antes.acompanhamento?.tentativas ?? 0) + 1;
    let depois: NotaFiscal | null = null;
    try {
      depois = await consultar(tenantId, String(row.id));
      r.consultadas++;
    } catch {
      r.falhas++;
    }
    const status = depois?.status ?? 'PROCESSANDO';
    if (status === 'PROCESSANDO') {
      if (depois) r.sem_resposta++;
      await gravarPasso(exec, tenantId, String(row.id), {
        tentativas, proxima_em: proximaConsulta(tentativas, agora), ultima_em: agora.toISOString(),
      });
      continue;
    }
    // Resposta final: o passo fica registrado, sem próxima consulta.
    const final = { tentativas, proxima_em: '', ultima_em: agora.toISOString(), avisada_recusa: antes.acompanhamento?.avisada_recusa === true };
    if (status === 'AUTORIZADA') r.autorizadas++;
    if (status === 'CANCELADA') r.canceladas++;
    if (status === 'REJEITADA') {
      r.recusadas++;
      if (!final.avisada_recusa && depois) {
        const aviso = avisoDeRecusa(depois);
        await criarNotificacao({
          tenantId, tipo: 'NOTA_RECUSADA', titulo: aviso.titulo, descricao: aviso.descricao, link: aviso.link,
          data: { nota_id: depois.id, ...(depois.venda_id ? { venda_id: depois.venda_id } : {}) },
          chaveDeduplicacao: `nota-recusada:${depois.id}`,
        }, exec);
        final.avisada_recusa = true;
      }
    }
    await gravarPasso(exec, tenantId, String(row.id), final);
  }
  return r;
}

/**
 * Tarefa do agendador (a cada 5 minutos): as agências com nota na
 * prefeitura. A consulta é a de sempre (`atualizarStatus`), carregada na hora
 * para este arquivo não puxar o emissor para quem só importa a definição.
 */
export const tarefaAcompanharNotas: DefinicaoTarefa = {
  nome: 'acompanhar-notas-na-prefeitura',
  janela: janelaDeMinutos(5),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(
      `SELECT DISTINCT tenant_id FROM notas_fiscais WHERE status = 'PROCESSANDO' AND tenant_id <> '' ORDER BY 1`,
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ exec, agora }, tenantId) => {
    const { atualizarStatus } = await import('./nfse-servico');
    return { ...(await acompanharNotasDaAgencia(exec, tenantId, agora, atualizarStatus)) };
  },
};
