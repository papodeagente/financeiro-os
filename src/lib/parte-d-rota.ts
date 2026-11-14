/**
 * Peças das rotas da parte D da E5 (cancelamento, reembolsos, crédito do
 * cliente). Arquivo de rota só exporta handlers; o resto mora aqui.
 *
 * Contrato (dinheiro em CENTAVOS de real; datas AAAA-MM-DD):
 *   GET  /api/vendas/completa/[id]/cancelamento → ContextoDoCancelamento
 *        (políticas de multa por produto, saldo de crédito do cliente, cancelamentos já feitos)
 *   POST /api/vendas/completa/[id]/cancelamento { modo: 'previa'|'gravar', pedido, assinatura? }
 *        pedido = { data, motivo, itens: [{ produto_id, passageiro_ids: string[] | null }],
 *                   multas: [{ produto_id, fornecedor_centavos, cliente_centavos|null }],
 *                   zerar_fornecedor, zerar_cliente, manter_na_meta, sobra: 'reembolso'|'credito',
 *                   prazo_reembolso?, validade_credito? }
 *        → ResultadoDoCancelamento (prévia: nada gravado; ids de criação null) | gravar: o mesmo, gravado, + ficha
 *        409 MUDOU quando a assinatura da prévia não confere.
 *   POST /api/vendas/completa/[id]/cancelamento/desfazer { modo: 'previa'|'gravar', cancelamento_id, motivo, assinatura? }
 *        Desfaz (reativa) o ÚLTIMO cancelamento que vale: → ResultadoDoDesfazer (contas antes → depois, reembolsos e
 *        crédito cancelados, comissão devolvida) | gravar: o mesmo, gravado, + ficha. Direito `cancelar_produto`.
 *        409 NAO_E_O_ULTIMO, JA_DESFEITO, REEMBOLSO_PAGO, CREDITO_USADO, MUDOU.
 *        O GET do cancelamento lista também os desfeitos (`desfeito_em`, `motivo_desfazer`) e marca `pode_desfazer`.
 *   GET  /api/reembolsos?tipo=&sentido=(RECEBER|PAGAR)&situacao=(SOLICITADO|APROVADO|PAGO|CANCELADO|em_andamento)&de=&ate=&busca=&venda_id=
 *        → { reembolsos (cada um com `sentido`), totais (a_devolver_ao_cliente, a_receber_do_fornecedor, a_pagar_ao_fornecedor, ...) }
 *   POST /api/reembolsos { tipo, sentido?: 'RECEBER'|'PAGAR' (só FORNECEDOR; padrão RECEBER), venda_id?, pessoa_id, pessoa_nome, valor_centavos, descricao, prazo?, aprovar? }
 *   PATCH /api/reembolsos/[id] { acao: 'aprovar'|'cancelar'|'converter_em_credito', prazo?, motivo?, validade? }
 *   GET  /api/creditos-cliente?busca=&so_com_saldo=1 → { carteiras, totais }
 *   GET  /api/creditos-cliente?cliente_id= → ExtratoCompleto (créditos, saldo e extrato)
 *   POST /api/creditos-cliente { cliente_id, cliente_nome, valor_centavos, validade?, descricao } (lançado à mão)
 *   PATCH /api/creditos-cliente/[id] { ajuste_centavos, motivo }
 *   POST /api/creditos-cliente/usar { conta_receber_id, valor_centavos, data? } (liquida com crédito, sem caixa)
 * Erros: { error, codigo, detalhes? } com 400, 403, 404, 409, 423.
 */
import { NextResponse } from 'next/server';
import { ErroVenda } from './venda-servidor';
import { ErroCredito } from './credito-cliente-servidor';
import { ErroReembolso } from './reembolsos-servidor';
import { respostaPeriodoFechado } from './guarda-rota';

export function respostaDeErroDaParteD(e: unknown): NextResponse {
  if (e instanceof ErroVenda || e instanceof ErroCredito || e instanceof ErroReembolso) {
    const detalhes = e instanceof ErroVenda && e.detalhes ? { detalhes: e.detalhes } : {};
    return NextResponse.json({ error: e.message, codigo: e.codigo, ...detalhes }, { status: e.status });
  }
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  const msg = e instanceof Error ? e.message : 'Erro interno';
  console.error('[parte-d]', msg);
  return NextResponse.json({ error: 'Não deu certo. Tente de novo.', codigo: 'ERRO' }, { status: 500 });
}

export async function lerJson<T>(req: Request): Promise<T | null> {
  return (await req.json().catch(() => null)) as T | null;
}

/** Inteiro de centavos vindo da tela (número ou texto). */
export function centavosDe(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
