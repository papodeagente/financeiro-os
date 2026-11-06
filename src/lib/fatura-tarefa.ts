/**
 * Tarefa do agendador (E5, parte B): de hora em hora, junta nas faturas os
 * itens a faturar que ficaram soltos — o pagante ganhou uma regra depois da
 * venda, a cobrança avulsa do item foi cancelada, a venda chegou antes de a
 * tabela existir. A venda salva já junta na hora; isto é a rede de segurança.
 * Idempotente (rodar de novo não muda nada) e uma agência por vez.
 *
 * Registrar `tarefaMontarFaturas` em src/lib/agendador/tarefas.ts (quem
 * integra a entrega).
 */
import { horaDeBrasilia, janelaDeMinutos, type DefinicaoTarefa } from './agendador/nucleo';
import { alocarItens, faturasDisponiveis } from './fatura-servidor';

export const tarefaMontarFaturas: DefinicaoTarefa = {
  nome: 'faturas-montar',
  janela: janelaDeMinutos(60),
  agencias: async ({ exec }) => {
    if (!(await faturasDisponiveis(exec))) return [];
    const { rows } = await exec.query(
      `SELECT DISTINCT c.tenant_id FROM contas_receber c
         JOIN regras_faturamento r ON r.tenant_id = c.tenant_id AND r.ativa AND r.pessoa_tipo = 'CLIENTE' AND r.pessoa_id = c.data->>'cliente_id'
        WHERE c.data->>'faturar' = 'true' AND COALESCE(NULLIF(c.data->>'status',''), c.status) IN ('PENDENTE','ATRASADO','VENCIDO')
          AND COALESCE(c.data->>'fatura_manual','false') <> 'true'
          AND NOT EXISTS (SELECT 1 FROM fatura_itens fi WHERE fi.tenant_id = c.tenant_id AND fi.conta_id = c.id)
        ORDER BY c.tenant_id`,
    );
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ emTransacao, agora }, tenantId) => {
    const r = await emTransacao(tx => alocarItens(tx, tenantId, {}, { hoje: horaDeBrasilia(agora).data }));
    return { alocados: r.alocados.length, sem_regra: r.sem_regra.length, faturas: r.faturas.length };
  },
};
