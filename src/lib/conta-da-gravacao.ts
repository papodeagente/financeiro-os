// Conta bancária usada numa gravação (E7, 06/11/2026): lançar, transferir
// ou trocar a conta de um título exige a conta liberada para MOVIMENTAR.
// Quem só vê a conta ("só ver", no perfil de acesso ou na restrição da
// pessoa) enxerga saldo e extrato, mas não grava nada que use a conta.
//
// Sem perfil nem restrição (o padrão), `pode` responde como sempre e nada
// muda. Administrador nunca é barrado.
import { ACOES_FINANCEIRAS, type AcaoFinanceira } from './acoes-financeiras';
import { pode, type ExecutorPermissoes, type SessaoPermissoes } from './permissoes-servidor';

export interface ContasDaGravacao {
  /** Campos do registro com id de conta bancária. */
  campos: string[];
  /**
   * Confere sempre (inclusive a conta que o registro já tinha). Sem isto, só
   * a conta nova ou trocada é conferida: editar a descrição de um título numa
   * conta que a pessoa só vê continua valendo.
   */
  sempre?: boolean;
  /** Direito conferido com a conta (padrão: usar a conta em pagamentos e recebimentos). */
  acao?: AcaoFinanceira;
}

export interface RecusaDaConta { status: 403; error: string; acao: AcaoFinanceira; conta: string }

export const MENSAGEM_CONTA_SO_VER =
  'Esta conta bancária está liberada só para ver o saldo e o extrato. Para pagar, receber, transferir ou lançar nela, peça a quem cuida dos acessos.';

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Contas que esta gravação usa (as novas; com `sempre`, também as de antes). */
export function contasUsadas(
  novo: Record<string, unknown>, antes: Record<string, unknown> | null, regra: ContasDaGravacao,
): string[] {
  const usadas = new Set<string>();
  for (const campo of regra.campos) {
    const n = texto(novo[campo]);
    const a = antes ? texto(antes[campo]) : null;
    if (n && (regra.sempre || n !== a)) usadas.add(n);
    if (regra.sempre && a) usadas.add(a);
  }
  return [...usadas];
}

/** Recusa (403) quando alguma conta usada não está liberada para movimentar. */
export async function recusaDaContaNaGravacao(
  sessao: SessaoPermissoes | null | undefined,
  novo: Record<string, unknown>,
  antes: Record<string, unknown> | null,
  regra: ContasDaGravacao,
  exec?: ExecutorPermissoes,
): Promise<RecusaDaConta | null> {
  const acao = regra.acao ?? 'movimentar_conta_bancaria';
  for (const conta of contasUsadas(novo, antes, regra)) {
    if (await pode(sessao, acao, { contaBancariaId: conta, exec })) continue;
    let error: string;
    if (!(await pode(sessao, acao, { exec }))) {
      const rotulo = ACOES_FINANCEIRAS.find(a => a.id === acao)?.rotulo ?? acao;
      error = `Seu acesso não inclui: ${rotulo.charAt(0).toLowerCase()}${rotulo.slice(1)}.`;
    } else if (await pode(sessao, 'ver_conta_bancaria', { contaBancariaId: conta, exec })) {
      error = MENSAGEM_CONTA_SO_VER;
    } else {
      error = 'Esta conta bancária não está liberada para você.';
    }
    return { status: 403, error, acao, conta };
  }
  return null;
}
