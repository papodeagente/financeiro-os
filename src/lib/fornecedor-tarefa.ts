/**
 * Tarefa diária da fatura do fornecedor (E5, parte C, 05/11/2026).
 *
 * A partir das 6h de Brasília, uma vez por dia e por agência: para cada
 * fornecedor com itens até o último corte que já passou, avisa no sino que a
 * fatura está pronta (uma vez por corte). Se a regra do fornecedor diz
 * "gerar sozinha", monta a fatura com esses itens (o mesmo caminho da tela,
 * com o sinal compensado). Respeita "nada sai": durante a mudança de sistema,
 * nada é avisado nem gerado.
 *
 * Registrar em src/lib/agendador/tarefas.ts (quem integra a entrega).
 */
import { nadaSai } from './nada-sai';
import { mudancaSegurandoSaidas } from './migracao/estado';
import { criarNotificacao } from './notificacoes';
import { horaDeBrasilia, janelaDiaria, type DefinicaoTarefa } from './agendador/nucleo';
import { aFaturarDaParte, gerarFatura, resumoAFaturar } from './fornecedor-servidor';
import type { ExecutorSQL } from './caixa-atomico';

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export async function faturasDoDia(
  exec: ExecutorSQL, emTransacao: <T>(fn: (tx: ExecutorSQL) => Promise<T>) => Promise<T>, tenantId: string, agora: Date,
): Promise<{ avisos: number; geradas: number; motivo?: string }> {
  const motivo = nadaSai() ?? (await mudancaSegurandoSaidas(exec, tenantId));
  if (motivo) return { avisos: 0, geradas: 0, motivo: `nada sai: ${motivo}` };
  const hoje = horaDeBrasilia(agora).data;
  let avisos = 0, geradas = 0;
  for (const r of await resumoAFaturar(exec, tenantId, hoje)) {
    if (r.itens_ate_o_corte === 0 || r.corte >= hoje) continue;
    const parte = await aFaturarDaParte(exec, tenantId, r.parte_id, hoje);
    if (parte.regra.regra.gerar_sozinha) {
      const ids = parte.itens.filter(i => i.data_base <= r.corte).map(i => i.conta_id);
      const f = await emTransacao(tx => gerarFatura(tx, tenantId, { parte_id: r.parte_id, conta_ids: ids, corte: r.corte, automatica: true }, { id: 'agendador', nome: 'Agendador' }, hoje));
      geradas++;
      await criarNotificacao({
        tenantId, tipo: 'FATURA_FORNECEDOR_PRONTA',
        titulo: `Fatura ${f.numero} de ${f.parte_nome} montada sozinha`,
        descricao: `${f.itens} ${f.itens === 1 ? 'item' : 'itens'}, ${reais(f.valor)} a pagar em ${dataBR(f.vencimento)}${f.sinal > 0 ? ` (já descontado ${reais(f.sinal)} de sinal)` : ''}.`,
        link: `/financeiro-ag/fornecedores/faturas?fatura=${encodeURIComponent(f.id)}`,
        data: { fatura_id: f.id, parte_id: r.parte_id }, chaveDeduplicacao: `fatura-fornecedor:${r.parte_id}:${r.corte}`,
      }, exec);
      continue;
    }
    await criarNotificacao({
      tenantId, tipo: 'FATURA_FORNECEDOR_PRONTA',
      titulo: `Fatura de ${r.parte_nome} pronta para montar`,
      descricao: `${r.itens_ate_o_corte} ${r.itens_ate_o_corte === 1 ? 'item' : 'itens'} até o corte de ${dataBR(r.corte)}, ${reais(r.total_ate_o_corte)}. Pela regra, vence em ${dataBR(r.vencimento.data)}.`,
      link: `/financeiro-ag/fornecedores/faturas?parte=${encodeURIComponent(r.parte_id)}`,
      data: { parte_id: r.parte_id, corte: r.corte }, chaveDeduplicacao: `fatura-fornecedor:${r.parte_id}:${r.corte}`,
    }, exec);
    avisos++;
  }
  return { avisos, geradas };
}

export const tarefaFaturasFornecedor: DefinicaoTarefa = {
  nome: 'faturas-fornecedor',
  janela: janelaDiaria(6),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(
      `SELECT DISTINCT tenant_id FROM contas_pagar
        WHERE tenant_id <> '' AND COALESCE(data->>'status', '') = 'PENDENTE' AND COALESCE(data->>'venda_modelo', '') = '2'
          AND COALESCE(data->>'fatura_fornecedor_id', '') = '' ORDER BY tenant_id`,
    );
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ exec, emTransacao, agora }, tenantId) => faturasDoDia(exec, emTransacao, tenantId, agora),
};
