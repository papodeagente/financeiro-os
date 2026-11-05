/**
 * Edição de conta a receber/pagar com o caixa junto, numa transação só.
 *
 * Antes, a edição "sem movimento" (calculada sobre o estado lido FORA da
 * transação) regravava a conta sem guarda: quem abriu a tela com a conta
 * PENDENTE e salvou uma descrição depois de outra pessoa receber o dinheiro
 * voltava a conta a PENDENTE sem estornar o caixa (auditoria 04/11, FIN2-03).
 * E um movimento que não achava a conta bancária devolvia sucesso, deixando a
 * conta RECEBIDA sem o dinheiro no saldo (FIN2-02).
 *
 * Agora a linha é travada (FOR UPDATE), o movimento é calculado sobre o
 * estado ATUAL dentro da transação, e um movimento que não acontece desfaz
 * tudo. Duplo clique continua idempotente: o segundo PUT espera o primeiro e
 * encontra a conta já baixada, sem nada a mover.
 */
import {
  calcularMovimentos,
  emTransacao,
  moverCaixaOuFalhar,
  pessoaDaConta,
  atualizarContaComGuarda,
  statusMovimentaCaixa,
  type ExecutorSQL,
} from './caixa-atomico';

export class ErroEdicaoConta extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ErroEdicaoConta';
  }
}

export interface EdicaoDeConta {
  tabela: 'contas_receber' | 'contas_pagar';
  colunasIndice: string[];
  campo: 'valor_recebido' | 'valor_pago';
  sinal: 1 | -1;
  id: string;
  tenantId: string;
  item: Record<string, unknown>;
}

/** Variante que recebe o executor (para testes e para quem já está numa transação). */
export async function editarContaNoExecutor(exec: ExecutorSQL, p: EdicaoDeConta): Promise<Record<string, unknown>> {
  const { rows } = await exec.query(
    `SELECT data FROM ${p.tabela} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [p.id, p.tenantId],
  );
  if (rows.length === 0) throw new ErroEdicaoConta('Conta não encontrada.', 404);
  const prev = (rows[0].data ?? {}) as Record<string, unknown>;
  const { _status_lido: statusLido, ...semMarca } = p.item;
  const item: Record<string, unknown> = { ...semMarca, id: p.id };

  // Tela velha: a conta foi baixada por outra pessoa depois que esta tela
  // abriu, e o salvamento chega com o status antigo (não baixado). Desfazer a
  // baixa só vale como ação explícita: a tela manda o status que ela LEU
  // (`_status_lido`), e ele precisa ser o status baixado que está no banco.
  const prevStatus = String(prev.status ?? '');
  const novoStatus = String(item.status ?? '');
  if (statusMovimentaCaixa(prevStatus) && !statusMovimentaCaixa(novoStatus) && statusLido !== prevStatus) {
    throw new ErroEdicaoConta('Esta conta foi atualizada por outra pessoa. Recarregue a página antes de salvar.', 409);
  }
  const movimentos = calcularMovimentos(prev, item, p.campo, p.sinal);

  const ok = await atualizarContaComGuarda({
    exec,
    tabela: p.tabela,
    colunasIndice: p.colunasIndice,
    id: p.id,
    tenantId: p.tenantId,
    item,
    versaoAnterior: null,
    statusAlvo: null,
  });
  if (!ok) throw new ErroEdicaoConta('Conta não encontrada.', 404);

  // Ordem fixa por conta: duas trocas de conta simultâneas travariam uma na
  // outra se cada transação bloqueasse as linhas em ordem diferente.
  movimentos.sort((a, b) => String(a.conta).localeCompare(String(b.conta)));
  const origem = {
    tipo: p.tabela === 'contas_receber' ? 'baixa_receber' as const : 'baixa_pagar' as const,
    tabela: p.tabela,
    id: p.id,
    pessoaId: pessoaDaConta(p.tabela, { ...prev, ...item }),
  };
  for (const mov of movimentos) await moverCaixaOuFalhar(p.tenantId, mov.conta, mov.delta, exec, origem);
  return item;
}

export function editarConta(p: EdicaoDeConta): Promise<Record<string, unknown>> {
  return emTransacao(exec => editarContaNoExecutor(exec, p));
}
