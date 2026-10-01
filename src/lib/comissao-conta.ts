/**
 * A COMISSÃO DO VENDEDOR VIRA CONTA A PAGAR.
 *
 * Decisão do Bruno (01/10/2026): "a comissão do vendedor deve ser conta a
 * pagar, inclusive o sistema configura dia para pagar a comissão".
 *
 * A agenda (dias do mês em que a agência paga comissão, ex.: 1 e 18) já
 * existia em Configurações, e `proximaDataPagamento` já sabia escolher a
 * data. O que faltava era alguém chamar: nenhuma comissão virava conta, o
 * fluxo de caixa não a enxergava e o DRE só a via se alguém digitasse à mão.
 *
 * REGRAS, e o motivo de cada uma:
 *
 *  - UMA conta por comissão, com id determinístico (`cp-comissao-<id>`).
 *    Recalcular o mês (que a tela de comissões faz a cada abertura) regrava
 *    a mesma conta com o valor novo, em vez de criar outra.
 *  - O vencimento é a PRÓXIMA data da agenda a partir de hoje ou da venda,
 *    o que for mais tarde. Sem agenda configurada, o último dia do mês, com
 *    aviso na observação — a conta existe mesmo assim, porque dívida sem
 *    data ainda é dívida.
 *  - Conta já PAGA ou PARCIAL não é tocada. Baixa move caixa; sobrescrever
 *    uma conta baixada por cima de um recálculo apagaria o lançamento e
 *    deixaria o saldo bancário sem lastro.
 *  - Comissão marcada como PAGA na tela de comissões NÃO marca a conta como
 *    PAGO. O POST de conta é um upsert cego que não move caixa (só o PUT
 *    move); gravar PAGO por aqui criaria uma conta paga sem dinheiro saindo
 *    de conta bancária nenhuma. A conta fica pendente, com a observação
 *    dizendo que a comissão consta como paga, e quem dá a baixa escolhe de
 *    qual conta o dinheiro saiu.
 *  - Comissão CANCELADA cancela a conta (se ainda não baixada). Valor zero
 *    idem: não existe dívida de R$ 0.
 *
 * A conta nasce em Custos Comerciais (2.6), que é onde o DRE já esperava a
 * comissão de vendedor, e carrega `origem_comissao_id` para o Lucro real a
 * excluir do custo fixo (ela já entra na venda, na linha do vendedor).
 */
import pool from './db';
import type { ExecutorSQL } from './caixa-atomico';
import { DIA_ULTIMO, diaNoMes, proximaDataPagamento } from './comissao-agenda';
import type { ComissaoVenda, ContaPagar } from './crm-types';
import { hojeISO, num, round2 } from './money';

export const PREFIXO_CONTA_COMISSAO = 'cp-comissao-';

/** Id da conta a pagar de uma comissão. Determinístico: recalcular não duplica. */
export function idDaContaDaComissao(comissaoId: string): string {
  return `${PREFIXO_CONTA_COMISSAO}${comissaoId}`;
}

export interface ContextoDaConta {
  /** `datas_pagamento_comissao` da agência (dias do mês). */
  datasPagamento: unknown;
  /** Id da categoria 2.6 no plano de contas do tenant, ou '' se não achou. */
  categoriaId: string;
  hoje?: string;
}

/**
 * O vencimento: a próxima data da agenda a partir do dia mais tarde entre
 * hoje e a venda. Venda de ontem com agenda no dia 18 vence no 18; venda de
 * três meses atrás recalculada hoje também vence no próximo 18 — a agência
 * não paga comissão no passado.
 */
export function vencimentoDaComissao(
  datasPagamento: unknown,
  dataVenda: string,
  hoje: string,
): { data: string; semAgenda: boolean } {
  const ref = [String(dataVenda ?? '').slice(0, 10), hoje].filter(Boolean).sort().pop() ?? hoje;
  const pela = proximaDataPagamento(datasPagamento, ref);
  if (pela) return { data: pela, semAgenda: false };
  const [ano, mes] = ref.split('-').map(Number);
  return { data: diaNoMes(ano, mes, DIA_ULTIMO), semAgenda: true };
}

/**
 * Monta a conta a pagar de uma comissão. Só cálculo.
 *
 * Devolve `null` quando não deve existir conta: valor zero ou negativo.
 * Quem chama decide o que fazer com uma conta que já existe nesse caso.
 */
export function contaDaComissao(
  c: ComissaoVenda,
  ctx: ContextoDaConta,
): ContaPagar | null {
  const valor = round2(num(c.valor_comissao));
  if (valor <= 0) return null;
  const hoje = ctx.hoje ?? hojeISO();
  const venc = vencimentoDaComissao(ctx.datasPagamento, c.data_venda, hoje);

  const observacoes = [
    `Comissão da venda ${c.venda_numero || c.venda_id} (${c.plano_nome || 'plano de comissão'}, ${num(c.percentual_aplicado)}% sobre ${round2(num(c.valor_base)).toFixed(2)}).`,
    venc.semAgenda ? 'Agenda de pagamento de comissão não configurada: vencimento no fim do mês. Defina os dias em Configurações, Agência.' : '',
    c.status === 'PAGA' ? `Comissão consta como paga em ${String(c.data_pagamento ?? '').slice(0, 10) || 'data não informada'}: confirme a baixa com a conta bancária de onde o dinheiro saiu.` : '',
  ].filter(Boolean).join(' ');

  return {
    id: idDaContaDaComissao(c.id),
    origem: 'OUTROS',
    venda_id: c.venda_id || null,
    grupo_id: null,
    fornecedor_id: '',
    fornecedor_nome: c.vendedor_nome || 'Vendedor',
    descricao: `Comissão · ${c.vendedor_nome || 'vendedor'} · venda ${c.venda_numero || c.venda_id}`,
    categoria_id: ctx.categoriaId,
    centro_custo: '',
    valor_original: valor,
    juros: 0,
    multa: 0,
    desconto: 0,
    valor_final: valor,
    moeda: 'BRL',
    cambio: 1,
    valor_brl: valor,
    data_emissao: hoje,
    data_vencimento: venc.data,
    data_pagamento: null,
    valor_pago: null,
    conta_bancaria_id: null,
    forma_pagamento: '',
    cartao_id: null,
    comprovante: '',
    parcela_numero: 1,
    total_parcelas: 1,
    natureza_custo: 'VARIAVEL',
    is_custo_comercial: true,
    status: c.status === 'CANCELADA' ? 'CANCELADO' : 'PENDENTE',
    rateio: [],
    anexos: [],
    observacoes,
    origem_venda_id: c.venda_id || undefined,
    auto_gerado: true,
    origem_comissao_id: c.id,
  };
}

/** Estados em que a conta já moveu caixa e NÃO pode ser regravada. */
const BAIXADA = new Set(['PAGO', 'PARCIAL']);

/**
 * Sincroniza a conta a pagar com a comissão gravada. Chamada depois de todo
 * POST/PUT em `comissoes`, pelo gancho `aposGravar` do CRUD.
 */
export async function sincronizarContaDaComissao(
  tenantId: string,
  comissao: ComissaoVenda,
  /** Injetável para o teste rodar contra Postgres real (PGlite), como caixa-atomico. */
  exec: ExecutorSQL | null = pool,
  hoje?: string,
): Promise<{ acao: 'criada' | 'atualizada' | 'cancelada' | 'preservada' | 'nenhuma'; id: string }> {
  const id = idDaContaDaComissao(comissao.id);
  if (!exec) return { acao: 'nenhuma', id };

  const [{ rows: ag }, { rows: cat }, { rows: existente }] = await Promise.all([
    exec.query(
      `SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
      [tenantId],
    ),
    exec.query(
      `SELECT id FROM plano_contas WHERE tenant_id = $1 AND (codigo = '2.6' OR data->>'codigo' = '2.6') ORDER BY id ASC LIMIT 1`,
      [tenantId],
    ),
    exec.query(`SELECT data FROM contas_pagar WHERE id = $1 AND tenant_id = $2`, [id, tenantId]),
  ]);

  const atual = (existente[0]?.data ?? null) as ContaPagar | null;
  if (atual && BAIXADA.has(String(atual.status))) {
    return { acao: 'preservada', id };
  }

  const conta = contaDaComissao(comissao, {
    datasPagamento: (ag[0]?.data as Record<string, unknown> | undefined)?.datas_pagamento_comissao,
    categoriaId: String(cat[0]?.id ?? ''),
    hoje,
  });

  // Sem valor (ou comissão apagada do cálculo): a conta pendente é cancelada,
  // nunca excluída — o histórico de que ela existiu fica.
  if (!conta) {
    if (atual && atual.status !== 'CANCELADO') {
      await exec.query(
        `UPDATE contas_pagar SET data = $3::jsonb, status = 'CANCELADO', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId, JSON.stringify({ ...atual, status: 'CANCELADO' })],
      );
      return { acao: 'cancelada', id };
    }
    return { acao: 'nenhuma', id };
  }

  // Campos que o operador pode ter editado à mão na conta (conta bancária
  // prevista, centro de custo, anexos) sobrevivem ao recálculo.
  const gravar: ContaPagar = atual
    ? { ...conta, conta_bancaria_id: atual.conta_bancaria_id, centro_custo: atual.centro_custo, anexos: atual.anexos ?? [], comprovante: atual.comprovante ?? '' }
    : conta;

  await exec.query(
    `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, status = EXCLUDED.status, updated_at = NOW()
     WHERE contas_pagar.tenant_id = EXCLUDED.tenant_id`,
    [gravar.id, tenantId, '', gravar.status, JSON.stringify(gravar)],
  );
  return { acao: atual ? (gravar.status === 'CANCELADO' ? 'cancelada' : 'atualizada') : 'criada', id };
}
