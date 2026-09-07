/**
 * Regras puras de proteção do lançamento financeiro.
 *
 * Vive fora de crud-api.ts de propósito: aquele arquivo importa next/server,
 * e a lógica de dinheiro precisa ser testável sem subir framework nem banco.
 */

/** Status em que o dinheiro JÁ se moveu. */
export const STATUS_DE_BAIXA = ['RECEBIDO', 'PARCIAL', 'PAGO', 'EFETIVADA'];

/** Campos que o servidor calcula e o cliente nunca deve poder sobrescrever. */
export const CAMPOS_DERIVADOS = ['saldo_atual'];

/**
 * Decide se um POST (upsert de cadastro) pode gravar.
 *
 * O POST NÃO movimenta caixa; só o PUT movimenta, em transação e com guarda
 * otimista. Duas coisas perigosas passavam por aqui:
 *
 *  1. Criar direto com status de baixa deixava o saldo sem o lançamento e,
 *     ao excluir a conta, o estorno CRIAVA dinheiro do nada.
 *  2. Regravar por cima de uma conta já baixada a rebaixava para PENDENTE
 *     sem estornar; o PUT seguinte debitava o caixa de novo. Era assim que
 *     pagar a mesma comissão duas vezes debitava duas vezes.
 *
 * @param statusEnviado  status que veio no corpo da requisição
 * @param statusGravado  status atual da linha, ou null se ela não existe
 */
export function recusaDoPost(
  statusEnviado: string,
  statusGravado: string | null,
): { status: 400 | 409; erro: string } | null {
  if (STATUS_DE_BAIXA.includes(statusEnviado)) {
    return {
      status: 400,
      erro: 'Criar lançamento já baixado não é permitido: o cadastro não movimenta caixa. '
        + 'Crie como PENDENTE e registre a baixa pela edição.',
    };
  }
  if (statusGravado !== null && STATUS_DE_BAIXA.includes(statusGravado)) {
    return {
      status: 409,
      erro: 'Este lançamento já foi baixado. Para alterá-lo, use a edição, '
        + 'que estorna o caixa antes de regravar.',
    };
  }
  return null;
}

/**
 * Devolve o item com os campos derivados restaurados a partir do que está
 * gravado no banco. A tela envia o objeto inteiro, incluindo um saldo que
 * pode ter sido lido minutos antes; gravá-lo de volta apagaria as baixas
 * ocorridas nesse intervalo.
 */
export function preservarCamposDerivados(
  enviado: Record<string, unknown>,
  gravado: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!gravado) return enviado;
  for (const campo of CAMPOS_DERIVADOS) {
    if (campo in gravado) enviado[campo] = gravado[campo];
  }
  return enviado;
}
