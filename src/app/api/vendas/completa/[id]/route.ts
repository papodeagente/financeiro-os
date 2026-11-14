import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { normalizarVenda } from '@/lib/venda-modelo';
import { carregarVenda, ErroVenda, salvarVenda } from '@/lib/venda-servidor';
import { mudancaQueAfetaORecibo, recibosValendoDaVenda, resumoDaMudanca, substituirRecibosDaVenda } from '@/lib/recibo-emitido';
import { aplicarAcordosDaAgencia } from '@/lib/fornecedor-servidor';
import { montarFicha, respostaDeErroDaVenda, usuarioDa } from '@/lib/venda-rota';
import { cabecalhoDaEmpresa } from '@/lib/empresas-rota';

// Ficha da venda completa (E5): ler e gravar. Contrato em src/lib/venda-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  try {
    const ficha = await montarFicha(pool as unknown as ExecutorSQL, acesso.tenantId, id, acesso.sessao);
    if (!ficha) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(ficha);
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const corpo = (await req.json().catch(() => null)) as { venda?: unknown; empresa_id?: unknown; confirmar_recibo?: unknown } | null;
  const { venda, erros } = normalizarVenda(corpo?.venda);
  if (erros.length) return NextResponse.json({ error: erros[0].mensagem, codigo: 'DADOS', detalhes: { erros } }, { status: 400 });
  const exec = pool as unknown as ExecutorSQL;
  try {
    const atual = await carregarVenda(exec, acesso.tenantId, id);
    venda.id = id;
    venda.origem = atual?.venda.origem ?? 'manual';
    venda.crm_venda_id = atual?.venda.crm_venda_id ?? '';
    // Venda à mão: o que falta de Comissão, Over e Taxa CC vem do acordo vigente (parte C).
    // Várias empresas (E7): trocar a empresa da venda leva junto os títulos em aberto.
    const cabecalho = await cabecalhoDaEmpresa(acesso.sessao, corpo?.empresa_id);
    if (cabecalho instanceof NextResponse) return cabecalho;
    await emTransacao(async e => {
      const final = (await aplicarAcordosDaAgencia(e, acesso.tenantId, venda)).venda;
      // Trava da venda com recibo emitido (E7): mudar o valor ou quem paga pede confirmação;
      // confirmado, o histórico registra e os recibos emitidos ficam substituídos.
      const mudanca = atual ? mudancaQueAfetaORecibo(atual.venda, final) : null;
      const recibos = mudanca ? await recibosValendoDaVenda(e, acesso.tenantId, id) : [];
      const resumo = mudanca ? resumoDaMudanca(mudanca) : '';
      if (recibos.length && corpo?.confirmar_recibo !== true) {
        throw new ErroVenda('VENDA_COM_RECIBO',
          `Esta venda já tem recibo emitido (${recibos.map(r => `Nº ${r.numero}`).join(', ')}) e a mudança altera o recibo: ${resumo}. Confirme para gravar; o próximo recibo sai com número novo e substitui o anterior.`,
          409, { recibos, mudanca, resumo });
      }
      const usuario = usuarioDa(acesso.sessao);
      await salvarVenda(e, acesso.tenantId, final, {
        usuario, origem: venda.origem, cabecalho,
        ...(recibos.length ? { detalheDoEvento: { recibo_emitido_alterado: { recibos: recibos.map(r => r.numero), mudanca: resumo, confirmado: true } } } : {}),
      });
      if (recibos.length) await substituirRecibosDaVenda(e, acesso.tenantId, id, `Venda alterada depois de emitido (${resumo}), confirmado por ${usuario?.nome || 'usuário'}`);
    });
    return NextResponse.json(await montarFicha(exec, acesso.tenantId, id, acesso.sessao));
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}
