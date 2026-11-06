import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { carregarVenda } from '@/lib/venda-servidor';
import { escolherRegra } from '@/lib/fatura-regras';
import { faturasDisponiveis, listarRegras } from '@/lib/fatura-servidor';
import { notaDeDebitoDaVenda } from '@/lib/fatura-documento';
import { cabecalhoDoDocumento, respostaDeErroDaFatura } from '@/lib/fatura-rota';

// Nota de débito da venda (E5, parte B): o documento que o cliente confere ANTES do faturamento.
// GET → { nota: NotaDeDebito, emitente, sacado, instrucoes }. Vencimentos vêm das contas a receber da venda;
// retenções e solicitante, da regra de faturamento do pagante.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const exec = pool as unknown as ExecutorSQL;
  try {
    const carregada = await carregarVenda(exec, acesso.tenantId, id);
    if (!carregada) return NextResponse.json({ error: 'Venda não encontrada.', codigo: 'NAO_ACHOU' }, { status: 404 });
    const venda = carregada.venda;
    const { rows } = await exec.query(
      `SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND COALESCE(data->>'venda_pagamento_id','') <> ''
        ORDER BY data->>'venda_pagamento_id', (data->>'parcela_numero')::int`,
      [acesso.tenantId, id],
    );
    const vencimentos: Record<string, string[]> = {};
    for (const r of rows) {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const pag = String(d.venda_pagamento_id ?? '');
      (vencimentos[pag] ??= []).push(String(d.data_vencimento ?? '').slice(0, 10));
    }
    const pagante = venda.pagamentos.find(p => p.forma === 'FATURAR')?.pagante?.id || venda.cliente.id;
    let regra = null;
    if (pagante && await faturasDisponiveis(exec)) {
      const regras = await listarRegras(exec, acesso.tenantId, { pessoa_tipo: 'CLIENTE', pessoa_id: pagante });
      regra = escolherRegra(regras, {
        pessoa_tipo: 'CLIENTE', pessoa_id: pagante,
        produto_tipos: venda.produtos.map(p => p.tipo), fornecedor_ids: venda.produtos.map(p => p.fornecedor?.id ?? '').filter(Boolean),
      });
    }
    const cab = await cabecalhoDoDocumento(exec, acesso.tenantId, pagante, venda.cliente.nome);
    const nota = notaDeDebitoDaVenda(venda, { vencimentos, retencoes: regra?.retencoes ?? null, solicitante: regra?.solicitante ?? '', pagante_documento: cab.sacado.documento });
    return NextResponse.json({
      nota, emitente: cab.emitente, sacado: cab.sacado,
      instrucoes: typeof cab.agencia.instrucoes_nota_debito === 'string' ? cab.agencia.instrucoes_nota_debito.slice(0, 2000) : '',
    });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
