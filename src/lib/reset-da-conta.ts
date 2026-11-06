/**
 * Reset categorizado dos dados de uma conta (tela /config/reset).
 *
 * Cada categoria mapeia para um conjunto de tabelas que são zeradas com
 * filtro WHERE tenant_id = $1 (multi-tenant safe). A rota roda tudo numa
 * transação: se qualquer DELETE falhar, faz ROLLBACK e nada muda.
 *
 * Nas agências, cadastros de pessoas (clientes, fornecedores, equipe),
 * usuários, configurações e integrações NUNCA são tocados: o reset é de dados
 * operacionais. A conta do ecossistema (perfil-da-conta.ts) tem duas
 * categorias a mais, para recomeçar do zero no modelo novo (Bruno,
 * 05/11/2026: "quero limpar a conta toda e zerar tudo para recomeçar no
 * modelo novo"): os cadastros e a integração que vieram do CRM antigo, e as
 * plataformas de pagamento. Mesmo nela, usuários, dados da empresa, dados
 * fiscais, assinatura e auditoria ficam.
 */
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { RAZAO_LIMPEZA_DA_AGENCIA_SQL } from './razao-schema';
import { TABELAS_DO_FORNECEDOR } from './fornecedor-schema';
import type { PerfilDaConta } from '@/lib/perfil-da-conta';

export const CATEGORIES = {
  financeiro: [
    'contas_receber',
    'contas_pagar',
    'plano_contas',
    'contas_bancarias',
    'cartoes_corp',
    'transferencias',
    'extrato_bancario',
    'cac_mensal',
    'cenarios_cac',
    'planos_comissao',
    'comissoes',
    'metas',
    'centros_custo',
    'planejamento_custos',
    'planejamento_progresso',
    'metas_mrr',
    'planejamento_projetos',
  ],
  produtos: [
    'grupos',
    'templates_proposta',
    'orcamentos',
    'propostas',
    'itens_venda',
    'vendas_crm',
    'destinos',
  ],
  grupos: [
    'gestao_grupos',
    'grupo_periodos_vagas',
    'grupo_reservas',
    'grupo_materiais',
    'grupo_passageiros',
    'grupo_quartos',
    'grupo_documentos',
    'grupo_tarefas',
    'grupo_eventos',
  ],
  mapas_mentais: ['mapas_mentais'],
  funis: ['funis', 'funis_simulacoes', 'funis_templates'],
  fluxogramas: ['fluxogramas', 'fluxograma_categorias'],
  // Só na conta do ecossistema. Apagar crm_config desliga a integração: o
  // que estava na fila de saída some junto, para nada do modelo antigo ser
  // enviado quando a conta 150002 for ligada.
  cadastros_e_crm: [
    'clientes',
    'fornecedores_crm',
    'membros',
    'negociacao_anotacoes',
    'negociacao_tarefas',
    'proposta_eventos_publicos',
    'notificacoes',
    'notas_fiscais',
    'voos_monitorados',
    'crm_eventos_entrada',
    'crm_eventos_saida',
    'crm_config',
  ],
  // Só na conta do ecossistema. Leva as credenciais: sem elas, a próxima
  // sincronização não traz de volta os recebimentos que acabaram de sair.
  plataformas: [
    'plataformas_transacoes',
    'plataformas_eventos',
    'plataformas_revisoes',
    'plataformas_desconto_padrao',
    'plataformas_config',
  ],
} as const;

export type ResetCategory = keyof typeof CATEGORIES;

/** Modelo da venda completa (venda-schema.ts): sai junto com as vendas. */
const TABELAS_DA_VENDA_COMPLETA = [
  'venda_componentes', 'venda_passageiros', 'venda_produtos', 'venda_pagamentos',
  'venda_pendencias', 'venda_eventos', 'vendas_modelo',
] as const;

/** Comissões por função calculadas, fechadas e pagas (comissao-funcoes-schema.ts): saem com as vendas. O cadastro (funções, planos, metas) fica. */
const TABELAS_DAS_COMISSOES_POR_FUNCAO = [
  'comissao_lancamentos', 'comissao_fechamento_itens', 'comissao_fechamentos', 'comissao_pagamentos',
] as const;
/** Parte D (cancelamento-servidor.ts): sai junto com as vendas. */
const TABELAS_DA_PARTE_D = ['venda_cancelamentos', 'reembolsos', 'creditos_cliente_movimentos', 'creditos_cliente'] as const;

const SO_NO_ECOSSISTEMA: ReadonlySet<ResetCategory> = new Set(['cadastros_e_crm', 'plataformas']);

/** As categorias que esta conta pode zerar. */
export function categoriasDaConta(perfil: PerfilDaConta): ResetCategory[] {
  return (Object.keys(CATEGORIES) as ResetCategory[]).filter(
    c => perfil === 'ecossistema' || !SO_NO_ECOSSISTEMA.has(c),
  );
}

/**
 * Apaga as categorias pedidas e devolve quantas linhas saíram por tabela.
 * Quem chama abre e fecha a transação. Categoria que a conta não pode zerar
 * lança antes de qualquer DELETE.
 */
export async function apagarCategorias(
  exec: ExecutorSQL,
  tenantId: string,
  perfil: PerfilDaConta,
  categorias: ResetCategory[],
): Promise<{ total: number; summary: Record<string, number> }> {
  // CRÍTICO: sem conta, `WHERE tenant_id = $1` casaria com as linhas órfãs
  // (tenant_id = '') de todas as contas.
  if (!tenantId) throw new Error('Conta não identificada');
  const permitidas = categoriasDaConta(perfil);
  const proibida = categorias.find(c => !permitidas.includes(c));
  if (proibida) throw new Error(`A categoria ${proibida} não existe nesta conta`);

  const summary: Record<string, number> = {};
  let total = 0;
  // Zerar o financeiro também zera o fechamento de período e o histórico de
  // baixas (05/11/2026). O fechamento sai primeiro: a trava do período
  // recusaria apagar contas baixadas em data fechada.
  const zeraContas = categorias.some(c => (CATEGORIES[c] as readonly string[]).includes('contas_bancarias'));
  if (zeraContas) {
    const { rows: tem } = await exec.query(`SELECT to_regclass('public.periodos_fechados') IS NOT NULL AS p, to_regclass('public.baixas') IS NOT NULL AS b`);
    if (tem[0]?.p) {
      await exec.query(`DELETE FROM periodos_fechados WHERE tenant_id = $1`, [tenantId]);
      await exec.query(`DELETE FROM periodos_eventos WHERE tenant_id = $1`, [tenantId]);
    }
    if (tem[0]?.b) {
      const r = await exec.query(`DELETE FROM baixas WHERE tenant_id = $1`, [tenantId]);
      summary.baixas = r.rowCount || 0;
      total += summary.baixas;
    }
  }
  for (const cat of categorias) {
    for (const table of CATEGORIES[cat]) {
      const res = await exec.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      const n = res.rowCount || 0;
      summary[table] = (summary[table] || 0) + n;
      total += n;
    }
  }
  // Venda completa (E5, 05/11/2026): sem as vendas, o modelo delas também sai.
  const apagaVendas = categorias.some(c => (CATEGORIES[c] as readonly string[]).includes('vendas_crm'));
  const { rows: temModelo } = apagaVendas
    ? await exec.query(`SELECT to_regclass('public.vendas_modelo') IS NOT NULL AS ok`)
    : { rows: [] as Array<Record<string, unknown>> };
  if (apagaVendas && temModelo[0]?.ok) {
    for (const table of TABELAS_DA_VENDA_COMPLETA) {
      const res = await exec.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      const n = res.rowCount || 0;
      summary[table] = n;
      total += n;
    }
    // Cancelamentos, reembolsos e a carteira de crédito (E5, parte D) nascem
    // das vendas e saem com elas.
    const { rows: temParteD } = await exec.query(`SELECT to_regclass('public.venda_cancelamentos') IS NOT NULL AS ok`);
    if (temParteD[0]?.ok) {
      for (const table of TABELAS_DA_PARTE_D) {
        const res = await exec.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
        const n = res.rowCount || 0;
        summary[table] = n;
        total += n;
      }
    }
  }
  // Lado do fornecedor (E5 parte C, 05/11/2026): sem as contas a pagar, as
  // faturas e os sinais do fornecedor também saem (os acordos são cadastro).
  const apagaPagar = categorias.some(c => (CATEGORIES[c] as readonly string[]).includes('contas_pagar'));
  const { rows: temFornecedor } = apagaPagar
    ? await exec.query(`SELECT to_regclass('public.faturas_fornecedor') IS NOT NULL AS ok`)
    : { rows: [] as Array<Record<string, unknown>> };
  if (apagaPagar && temFornecedor[0]?.ok) {
    for (const table of TABELAS_DO_FORNECEDOR) {
      const res = await exec.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      const n = res.rowCount || 0;
      summary[table] = n;
      total += n;
    }
  }
  const { rows: temComissoes } = apagaVendas
    ? await exec.query(`SELECT to_regclass('public.comissao_lancamentos') IS NOT NULL AS ok`)
    : { rows: [] as Array<Record<string, unknown>> };
  if (apagaVendas && temComissoes[0]?.ok) {
    for (const table of TABELAS_DAS_COMISSOES_POR_FUNCAO) {
      const res = await exec.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      const n = res.rowCount || 0;
      summary[table] = n;
      total += n;
    }
  }
  // Recorrência (05/11/2026): sem as contas, as séries também saem. Senão a
  // tarefa diária recriaria as próximas contas de uma série zerada.
  const apagaTitulos = categorias.some(c => (CATEGORIES[c] as readonly string[]).includes('contas_pagar'));
  const { rows: temSeries } = apagaTitulos
    ? await exec.query(`SELECT to_regclass('public.recorrencias') IS NOT NULL AS ok`)
    : { rows: [] as Array<Record<string, unknown>> };
  if (apagaTitulos && temSeries[0]?.ok) {
    const res = await exec.query(`DELETE FROM recorrencias WHERE tenant_id = $1`, [tenantId]);
    const n = res.rowCount || 0;
    summary.recorrencias = n;
    total += n;
  }
  // Sem contas bancárias, o razão da agência também começa do zero
  // (05/11/2026). É o único caminho que apaga o razão; a abertura volta a
  // rodar sozinha pelo agendador.
  const apagaContas = categorias.some(c => (CATEGORIES[c] as readonly string[]).includes('contas_bancarias'));
  const { rows: temRazao } = apagaContas
    ? await exec.query(`SELECT to_regclass('public.razao_estado') IS NOT NULL AS ok`)
    : { rows: [] as Array<Record<string, unknown>> };
  if (apagaContas && temRazao[0]?.ok) {
    for (const sql of RAZAO_LIMPEZA_DA_AGENCIA_SQL) {
      await exec.query(sql, sql.includes('$1') ? [tenantId] : []);
    }
  }
  return { total, summary };
}

/** Quantos registros cada categoria que a conta pode zerar tem hoje. */
export async function contarCategorias(
  exec: ExecutorSQL,
  tenantId: string,
  perfil: PerfilDaConta,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const cat of categoriasDaConta(perfil)) {
    let sum = 0;
    for (const table of CATEGORIES[cat]) {
      try {
        const res = await exec.query(
          `SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
          [tenantId],
        );
        sum += Number(res.rows[0]?.n) || 0;
      } catch {
        // tabela pode não existir em ambientes muito antigos — ignora
      }
    }
    counts[cat] = sum;
  }
  return counts;
}
