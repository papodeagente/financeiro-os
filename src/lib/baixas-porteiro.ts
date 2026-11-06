/**
 * Porteiro da liquidação (05/11/2026). Antes de gravar uma baixa, confere:
 *   1. o direito de dar baixa (pagar ou receber) e a conta bancária liberada;
 *   2. a alçada de pagamento (contas a pagar acima do limite precisam de
 *      aprovação, pedida pela tela de Aprovações ou pelo botão da recusa);
 *   3. os limites da agência (desconto, acréscimo, data da movimentação):
 *      fora deles, a baixa vira um pedido de aprovação e é gravada sozinha
 *      quando alguém com o direito aprovar.
 * Sem perfis, alçadas nem limites cadastrados (o padrão), nada muda.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { hojeISO, round2 } from './money';
import { pode, type SessaoPermissoes, type ExecutorPermissoes } from './permissoes-servidor';
import { MENSAGEM_CONTA_SO_VER } from './conta-da-gravacao';
import { verificarBloqueios } from './bloqueios-financeiros';
import { lerBloqueios } from './bloqueios-servidor';
import {
  avisarAprovadores, criarPedidoAprovacao, exigeAprovacaoDoPagamento, registrarExecutorDeAprovacao,
  type ContaPagarParaAprovacao,
} from './aprovacoes-servidor';
import { ErroBaixa, registrarBaixas, type ItemBaixa, type ResultadoItem } from './baixas-servidor';
import type { TituloTabela } from './baixa-calculo';

export type SessaoDaBaixa = SessaoPermissoes & { nome?: string };

/** Recusa do porteiro: vira a resposta da rota. */
export class RecusaDaBaixa extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 'limites' = dá para pedir aprovação desta baixa; 'pagamento' = pedir aprovação do pagamento da conta. */
    readonly pedir?: { tipo: 'limites' | 'pagamento'; conta_pagar_id?: string; status?: string },
  ) { super(message); }
}

const ACAO_DA_TABELA: Record<TituloTabela, 'liquidar_pagar' | 'liquidar_receber'> = {
  contas_pagar: 'liquidar_pagar',
  contas_receber: 'liquidar_receber',
};

/** 1. Direito de dar baixa e conta liberada. */
async function conferirDireitos(exec: ExecutorSQL, sessao: SessaoDaBaixa, itens: ItemBaixa[]): Promise<void> {
  const e = exec as unknown as ExecutorPermissoes;
  const vistos = new Set<string>();
  for (const it of itens) {
    const acao = ACAO_DA_TABELA[it.titulo_tabela];
    if (!acao) continue;
    const chave = `${acao}|${it.conta_bancaria_id ?? ''}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (!(await pode(sessao, acao, { exec: e }))) {
      throw new RecusaDaBaixa(403, acao === 'liquidar_pagar'
        ? 'Seu acesso não inclui dar baixa em contas a pagar.'
        : 'Seu acesso não inclui dar baixa em contas a receber.');
    }
    if (it.conta_bancaria_id && !(await pode(sessao, 'movimentar_conta_bancaria', { contaBancariaId: it.conta_bancaria_id, exec: e }))) {
      // Conta "só ver" (E7): a pessoa vê o saldo, mas não paga nem recebe nela.
      const soVer = await pode(sessao, 'ver_conta_bancaria', { contaBancariaId: it.conta_bancaria_id, exec: e });
      throw new RecusaDaBaixa(403, soVer ? MENSAGEM_CONTA_SO_VER : 'Esta conta bancária não está liberada para você.');
    }
  }
}

/** 2. Alçada de pagamento (só contas a pagar). */
async function conferirAlcada(exec: ExecutorSQL, tenantId: string, itens: ItemBaixa[]): Promise<void> {
  const ids = [...new Set(itens.filter(i => i.titulo_tabela === 'contas_pagar').map(i => i.titulo_id))];
  if (ids.length === 0) return;
  const { rows } = await exec.query(
    `SELECT id, data FROM contas_pagar WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]);
  for (const r of rows) {
    const conta = { ...(r.data as Record<string, unknown>), id: String(r.id) } as ContaPagarParaAprovacao;
    const s = await exigeAprovacaoDoPagamento(conta, { tenantId, exec: exec as unknown as ExecutorPermissoes });
    if (s.exige && !s.liberado) {
      const nome = String((r.data as Record<string, unknown>)?.fornecedor_nome ?? '').trim();
      throw new RecusaDaBaixa(409, ids.length > 1 && nome ? `${nome}: ${s.motivo}` : s.motivo,
        { tipo: 'pagamento', conta_pagar_id: String(r.id), status: s.status });
    }
  }
}

/**
 * 3. Limites da agência. Encargos sugeridos pela política da própria agência
 * não contam: só o que a pessoa pôs além (ou o desconto que ela deu).
 */
async function conferirLimites(
  exec: ExecutorSQL, sessao: SessaoDaBaixa, tenantId: string, itens: ItemBaixa[], previa: ResultadoItem[],
): Promise<void> {
  const e = exec as unknown as ExecutorPermissoes;
  const config = await lerBloqueios(e, tenantId);
  const dispensa = await pode(sessao, 'aprovar_excecao', { exec: e });
  const hoje = hojeISO();
  const motivos: string[] = [];
  for (let i = 0; i < previa.length; i++) {
    const r = previa[i];
    if (!r || r.ja_existia) continue;
    const sug = r.encargos_sugeridos;
    const desconto = Math.max(0, round2(r.plano.desconto - sug.desconto_antecipacao));
    const acrescimo = Math.max(0, round2(r.plano.juros + r.plano.multa - sug.juros - sug.multa));
    const v = verificarBloqueios({
      config, hoje, dispensaAprovacao: dispensa,
      desconto, acrescimo, valor_base: r.plano.saldo_antes,
      data_movimentacao: itens[i]?.data || r.data || hoje,
    });
    if (!v.ok) motivos.push(previa.length > 1 && r.pessoa ? `${r.pessoa}: ${v.motivo}` : v.motivo);
  }
  if (motivos.length > 0) {
    throw new RecusaDaBaixa(409, `${motivos.join(' ')} Peça aprovação para registrar.`, { tipo: 'limites' });
  }
}

/** Todas as conferências, na ordem. Lança RecusaDaBaixa. */
export async function conferirBaixa(
  exec: ExecutorSQL, sessao: SessaoDaBaixa, tenantId: string, itens: ItemBaixa[], previa: ResultadoItem[],
): Promise<void> {
  await conferirDireitos(exec, sessao, itens);
  await conferirAlcada(exec, tenantId, itens);
  await conferirLimites(exec, sessao, tenantId, itens, previa);
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Abre o pedido de aprovação de uma baixa fora dos limites. Direitos e
 * alçada já foram conferidos; só os limites ficam para quem aprova.
 */
export async function pedirAprovacaoDaBaixa(input: {
  exec: ExecutorSQL; tenantId: string; sessao: SessaoDaBaixa; itens: ItemBaixa[]; previa: ResultadoItem[];
  origem: 'tela' | 'lote'; idempotencia?: string; motivo?: string;
}): Promise<{ pedido_id: string; ja_existia: boolean }> {
  const total = round2(input.previa.reduce((a, r) => a + (r?.plano.valor ?? 0), 0));
  const primeiro = input.previa[0];
  const pagar = input.itens[0]?.titulo_tabela === 'contas_pagar';
  const descricao = input.itens.length === 1 && primeiro
    ? `${pagar ? 'Pagar' : 'Receber'} ${brl(total)} ${pagar ? 'a' : 'de'} ${primeiro.pessoa || (pagar ? 'fornecedor' : 'cliente')}${primeiro.descricao ? ` (${primeiro.descricao})` : ''}, fora dos limites`
    : `Liquidar ${input.itens.length} contas (${brl(total)}), fora dos limites`;
  const alvo = input.idempotencia || `baixa_${generateId()}`;
  const r = await criarPedidoAprovacao({
    tenantId: input.tenantId, tipo: 'baixa', alvo_tabela: 'baixas', alvo_id: alvo.slice(0, 120),
    descricao,
    payload: { itens: input.itens, origem: input.origem },
    valor_centavos: Math.round(total * 100),
    solicitante: { id: String(input.sessao.userId ?? ''), nome: String(input.sessao.nome ?? '') },
    motivo: input.motivo,
    notificar: false,
  }, input.exec as unknown as ExecutorPermissoes);
  if (!r.jaExistia) await avisarAprovadores(r.pedido, input.tenantId);
  return { pedido_id: r.pedido.id, ja_existia: r.jaExistia };
}

function lerCarga(payload: Record<string, unknown>): { itens: ItemBaixa[]; origem: 'tela' | 'lote' } {
  const itens = Array.isArray(payload.itens) ? payload.itens as ItemBaixa[] : [];
  return { itens, origem: payload.origem === 'lote' ? 'lote' : 'tela' };
}

// Aprovado: grava a baixa como foi pedida. Se a conta mudou no meio (outra
// baixa, valor editado), o "esperado" da tela não bate e nada é gravado.
registrarExecutorDeAprovacao('baixa', async ({ exec, tenantId, pedido, aprovador }) => {
  const { itens, origem } = lerCarga(pedido.payload);
  const r = await registrarBaixas(exec as unknown as ExecutorSQL, {
    tenantId,
    usuarioId: pedido.solicitante_id,
    usuarioNome: `${pedido.solicitante_nome || 'Alguém'} (aprovado por ${aprovador.nome || 'aprovador'})`,
    origem,
    idempotencia: `apr:${pedido.id}`,
  }, itens, { gravar: true });
  return { baixas: r.itens.map(i => i.baixa_id).filter(Boolean) };
}, {
  acaoAprovadora: 'aprovar_excecao',
  revalidar: async ({ exec, tenantId, pedido }) => {
    const { itens, origem } = lerCarga(pedido.payload);
    if (itens.length === 0) return { ok: false, motivo: 'O pedido não tem contas.' };
    try {
      const r = await registrarBaixas(exec as unknown as ExecutorSQL, { tenantId, origem }, itens, { gravar: false });
      const erro = r.itens.find(i => i.plano.erros.length > 0);
      if (erro) return { ok: false, motivo: erro.plano.erros[0] };
      // O mesmo "esperado" que a gravação confere: a conta não pode ter mudado.
      const mudou = r.itens.some((res, i) => {
        const e = itens[i]?.esperado;
        if (!e || !res) return false;
        return (e.status_depois !== undefined && e.status_depois !== res.plano.status_depois)
          || (e.valor_baixado_depois !== undefined && round2(Number(e.valor_baixado_depois)) !== res.plano.valor_baixado_depois)
          || (e.saldo_depois !== undefined && round2(Number(e.saldo_depois)) !== res.plano.saldo_depois);
      });
      return mudou ? { ok: false, motivo: 'A conta mudou depois do pedido (outra baixa ou valor editado). Peça de novo.' } : { ok: true };
    } catch (e) {
      if (e instanceof ErroBaixa) return { ok: false, motivo: e.message };
      throw e;
    }
  },
});

const BAIXADOS = new Set(['PAGO', 'RECEBIDO', 'PARCIAL']);

/**
 * Edição direta do título (tela antiga, PUT de contas-*): marcar como pago
 * ou recebido é uma baixa, e mexer em título já baixado pede o direito
 * "Alterar lançamento já baixado". Devolve a recusa ou null.
 */
export async function conferirEdicaoDoTitulo(
  exec: ExecutorSQL, sessao: SessaoDaBaixa, tenantId: string, tabela: TituloTabela, id: string, novo: Record<string, unknown>,
): Promise<RecusaDaBaixa | null> {
  const e = exec as unknown as ExecutorPermissoes;
  const { rows } = await exec.query(`SELECT data, status FROM ${tabela} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows[0]) return null;
  const antes = (rows[0].data ?? {}) as Record<string, unknown>;
  const statusAntes = String(rows[0].status || antes.status || '');
  const statusDepois = String(novo.status ?? statusAntes);
  const conta = (novo.conta_bancaria_id ?? antes.conta_bancaria_id ?? null) as string | null;

  if (BAIXADOS.has(statusAntes) && !(await pode(sessao, 'editar_liquidado', { exec: e }))) {
    return new RecusaDaBaixa(403, 'Seu acesso não inclui alterar lançamento já baixado.');
  }
  if (BAIXADOS.has(statusDepois) && statusDepois !== statusAntes) {
    try {
      await conferirDireitos(exec, sessao, [{ titulo_tabela: tabela, titulo_id: id, valor: 0, conta_bancaria_id: conta }]);
      if (tabela === 'contas_pagar') await conferirAlcada(exec, tenantId, [{ titulo_tabela: tabela, titulo_id: id, valor: 0 }]);
    } catch (err) {
      if (err instanceof RecusaDaBaixa) return err;
      throw err;
    }
  }
  return null;
}
