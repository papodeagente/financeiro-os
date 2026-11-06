/**
 * Tarefa diária do crédito do cliente e dos reembolsos (E5, parte D).
 * A partir das 7h de Brasília, por agência:
 *  - vence os créditos com validade passada (movimento "Venceu" no extrato);
 *  - avisa no sino, UMA vez por crédito, o que vence nos próximos 30 dias;
 *  - avisa, uma vez por reembolso, o que chega ao prazo sem ser pago.
 * Registrar em src/lib/agendador/tarefas.ts (TAREFAS).
 */
import { criarNotificacao } from './notificacoes';
import { janelaDiaria, horaDeBrasilia, type DefinicaoTarefa } from './agendador/nucleo';
import { carteiraDisponivel, vencerEAvisarCreditos } from './credito-cliente-servidor';
import { avisarReembolsosNoPrazo } from './reembolsos-servidor';

export const tarefaCreditosEReembolsos: DefinicaoTarefa = {
  nome: 'creditos-e-reembolsos',
  janela: janelaDiaria(7),
  agencias: async ({ exec }) => {
    if (!(await carteiraDisponivel(exec))) return [];
    const { rows } = await exec.query(
      `SELECT tenant_id FROM (
         SELECT DISTINCT tenant_id FROM creditos_cliente WHERE situacao = 'ATIVO' AND saldo_centavos > 0 AND validade IS NOT NULL
         UNION
         SELECT DISTINCT tenant_id FROM reembolsos WHERE situacao IN ('SOLICITADO','APROVADO') AND avisado_em IS NULL
       ) t WHERE tenant_id <> '' ORDER BY tenant_id`,
    );
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ emTransacao, agora }, tenantId) => {
    const hoje = horaDeBrasilia(agora).data;
    return emTransacao(async exec => {
      const creditos = await vencerEAvisarCreditos(exec, tenantId, hoje, n => criarNotificacao({
        tenantId, tipo: 'CREDITO_CLIENTE_VENCENDO', titulo: n.titulo, descricao: n.descricao, link: n.link, data: n.data, chaveDeduplicacao: n.chave,
      }, exec));
      const reembolsos = await avisarReembolsosNoPrazo(exec, tenantId, hoje, n => criarNotificacao({
        tenantId, tipo: 'REEMBOLSO_NO_PRAZO', titulo: n.titulo, descricao: n.descricao, link: n.link, data: n.data, chaveDeduplicacao: n.chave,
      }, exec));
      return { ...creditos, reembolsos_avisados: reembolsos };
    });
  },
};
