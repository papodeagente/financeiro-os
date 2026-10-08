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
 *
 * A CONTA ANTIGA (`pagar-<id>`). Até 08/10/2026 a tela de comissões criava
 * uma segunda conta ao aprovar e ao pagar, e cada comissão aprovada ficou com
 * duas. A que a tela criou e não foi cancelada é a conta da comissão: este
 * gancho não cria a `cp-comissao-<id>` ao lado dela e cancela a que já
 * existir em aberto. Ver `comissao-conta-unica.ts`.
 */
import pool from './db';
import type { ExecutorSQL } from './caixa-atomico';
import { DIA_ULTIMO, diaNoMes, proximaDataPagamento } from './comissao-agenda';
import {
  PREFIXO_CONTA_COMISSAO, contaBaixada, contaViva, idDaContaDaComissao, idDaContaLegada,
} from './comissao-conta-unica';
import type { ComissaoVenda, ContaPagar } from './crm-types';
import { hojeISO, num, round2 } from './money';

export { PREFIXO_CONTA_COMISSAO, idDaContaDaComissao };

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

  // A comissão que veio calculada do CRM não é de uma venda: é o mês do
  // vendedor sobre o dinheiro recebido. A conta não aponta para venda
  // nenhuma (o id `crm-competencia-…` não existe em vendas) e diz de onde veio.
  const doCrm = c.origem === 'crm';
  const vendaReal = doCrm ? '' : c.venda_id;
  const observacoes = [
    doCrm
      ? `${c.descricao || 'Comissão calculada pelo CRM'}: ${num(c.percentual_aplicado)}% sobre ${round2(num(c.valor_base)).toFixed(2)} recebidos.`
      : `Comissão da venda ${c.venda_numero || c.venda_id} (${c.plano_nome || 'plano de comissão'}, ${num(c.percentual_aplicado)}% sobre ${round2(num(c.valor_base)).toFixed(2)}).`,
    venc.semAgenda ? 'Agenda de pagamento de comissão não configurada: vencimento no fim do mês. Defina os dias em Configurações, Agência.' : '',
    c.status === 'PAGA' ? `Comissão consta como paga em ${String(c.data_pagamento ?? '').slice(0, 10) || 'data não informada'}: confirme a baixa com a conta bancária de onde o dinheiro saiu.` : '',
  ].filter(Boolean).join(' ');

  return {
    id: idDaContaDaComissao(c.id),
    origem: 'OUTROS',
    venda_id: vendaReal || null,
    grupo_id: null,
    fornecedor_id: '',
    fornecedor_nome: c.vendedor_nome || 'Vendedor',
    descricao: doCrm
      ? `Comissão · ${c.vendedor_nome || 'vendedor'} · ${c.descricao || 'calculada pelo CRM'}`
      : `Comissão · ${c.vendedor_nome || 'vendedor'} · venda ${c.venda_numero || c.venda_id}`,
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
    origem_venda_id: vendaReal || undefined,
    auto_gerado: true,
    origem_comissao_id: c.id,
  };
}

/** Uma linha de contas_pagar: o JSON, com o status da coluna como reserva. */
function lerConta(rows: Record<string, unknown>[]): ContaPagar | null {
  const r = rows[0];
  if (!r) return null;
  const data = (r.data ?? {}) as ContaPagar;
  // Baixada em qualquer um dos dois lugares conta como baixada: nunca tocar
  // uma conta que moveu caixa é a regra que não pode falhar.
  const coluna = String(r.status ?? '').toUpperCase();
  if ((coluna === 'PAGO' || coluna === 'PARCIAL') && !contaBaixada(data)) {
    return { ...data, status: coluna as ContaPagar['status'] };
  }
  return data;
}

/** Cancela a conta (nunca exclui: o histórico de que ela existiu fica). */
async function cancelarConta(
  exec: ExecutorSQL,
  tenantId: string,
  conta: ContaPagar,
  id: string,
  nota: string,
): Promise<void> {
  const observacoes = [String(conta.observacoes ?? '').trim(), nota].filter(Boolean).join(' ');
  await exec.query(
    `UPDATE contas_pagar SET data = $3::jsonb, status = 'CANCELADO', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND UPPER(COALESCE(data->>'status', '')) NOT IN ('PAGO', 'PARCIAL')
        AND UPPER(status) NOT IN ('PAGO', 'PARCIAL')`,
    [id, tenantId, JSON.stringify({ ...conta, status: 'CANCELADO', observacoes })],
  );
}

export type AcaoDaConta = 'criada' | 'atualizada' | 'cancelada' | 'preservada' | 'nenhuma' | 'legada';

/**
 * Sincroniza a conta a pagar com a comissão gravada. Chamada depois de todo
 * POST/PUT em `comissoes`, pelo gancho `aposGravar` do CRUD, e pela comissão
 * que chega calculada do CRM.
 *
 * `id` é a conta que É da comissão: a `cp-comissao-<id>`, ou a antiga
 * `pagar-<id>` quando ela existe viva (`acao: 'legada'`). `duplicataCancelada`
 * diz quando a `cp-comissao-<id>` foi cancelada por duplicar a antiga.
 * Nada aqui move caixa: baixa é só pelo PUT de contas a pagar.
 */
export async function sincronizarContaDaComissao(
  tenantId: string,
  comissao: ComissaoVenda,
  /** Injetável para o teste rodar contra Postgres real (PGlite), como caixa-atomico. */
  exec: ExecutorSQL | null = pool,
  hoje?: string,
): Promise<{ acao: AcaoDaConta; id: string; duplicataCancelada?: string }> {
  const id = idDaContaDaComissao(comissao.id);
  const idLegada = idDaContaLegada(comissao.id);
  if (!exec) return { acao: 'nenhuma', id };

  const [{ rows: ag }, { rows: cat }, { rows: existente }, { rows: antiga }] = await Promise.all([
    exec.query(
      `SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
      [tenantId],
    ),
    exec.query(
      `SELECT id FROM plano_contas WHERE tenant_id = $1 AND (codigo = '2.6' OR data->>'codigo' = '2.6') ORDER BY id ASC LIMIT 1`,
      [tenantId],
    ),
    exec.query(`SELECT data, status FROM contas_pagar WHERE id = $1 AND tenant_id = $2`, [id, tenantId]),
    exec.query(`SELECT data, status FROM contas_pagar WHERE id = $1 AND tenant_id = $2`, [idLegada, tenantId]),
  ]);

  const atual = lerConta(existente);
  const legada = lerConta(antiga);
  const dia = hoje ?? hojeISO();

  // A conta antiga viva É a conta da comissão. Nada de criar outra ao lado.
  if (contaViva(legada)) {
    let duplicataCancelada: string | undefined;
    if (atual && contaViva(atual) && !contaBaixada(atual)) {
      await cancelarConta(exec, tenantId, atual, id,
        `Cancelada em ${dia}: duplicava a conta ${idLegada}, que é a conta a pagar desta comissão.`);
      duplicataCancelada = id;
    }
    // Comissão cancelada (ou zerada) cancela a conta dela, se ainda não paga.
    const semDivida = comissao.status === 'CANCELADA' || round2(num(comissao.valor_comissao)) <= 0;
    if (semDivida && !contaBaixada(legada)) {
      await cancelarConta(exec, tenantId, legada as ContaPagar, idLegada,
        `Cancelada em ${dia}: a comissão ${comissao.id} foi cancelada.`);
      return { acao: 'cancelada', id: idLegada, duplicataCancelada };
    }
    return { acao: 'legada', id: idLegada, duplicataCancelada };
  }

  if (atual && contaBaixada(atual)) {
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
    if (atual && contaViva(atual)) {
      await cancelarConta(exec, tenantId, atual, id, '');
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
