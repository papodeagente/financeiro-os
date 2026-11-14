// Aprovações (05/11/2026).
//   GET ?status=PENDENTE|APROVADO|RECUSADO|EXECUTADO|EXPIRADO|TODOS
//     → { pedidos (com posso_decidir), para_mim } — para_mim = abertos que esta pessoa pode decidir
//   POST { acao: 'decidir', id, decisao: 'aprovar'|'recusar', motivo }
//   POST { acao: 'pedir_pagamento', conta_pagar_id, motivo }
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { conferirSegundoFatorDoPagador, recusaFinanceira } from '@/lib/guarda-rota';
import '@/lib/aprovacoes-executores';
import {
  decidirPedido, expirarVencidos, listarPedidos, marcarQuemPodeDecidir, pedirAprovacaoDoPagamento,
} from '@/lib/aprovacoes-servidor';
import { STATUS_PEDIDO, type StatusPedido } from '@/lib/aprovacoes';
import { tenantDaSessao, type ExecutorPermissoes } from '@/lib/permissoes-servidor';
import { corpoJson, respostaDeErro } from '@/lib/permissoes-rota';

export async function GET(req: Request) {
  try {
    await initDB();
    const recusa = await recusaFinanceira('ler');
    if (recusa) return recusa;
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const sessao = (await getSession())!;
    const exec = pool as unknown as ExecutorPermissoes;
    const tenantId = tenantDaSessao(sessao);
    const pedido = new URL(req.url).searchParams.get('status') || 'PENDENTE';
    const status = pedido === 'TODOS' || STATUS_PEDIDO.includes(pedido as StatusPedido) ? pedido as StatusPedido | 'TODOS' : 'PENDENTE';
    await expirarVencidos(exec, tenantId);
    const pedidos = await marcarQuemPodeDecidir(exec, sessao, await listarPedidos(exec, tenantId, { status }));
    const abertos = status === 'PENDENTE' ? pedidos
      : await marcarQuemPodeDecidir(exec, sessao, await listarPedidos(exec, tenantId, { status: 'PENDENTE' }));
    return NextResponse.json({ pedidos, para_mim: abertos.filter(p => p.posso_decidir).length });
  } catch (e) {
    return respostaDeErro(e);
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const recusa = await recusaFinanceira('escrever');
    if (recusa) return recusa;
    const sessao = (await getSession())!;
    const corpo = await corpoJson(req);
    if (corpo.acao === 'decidir') {
      // Aprovar libera dinheiro saindo: quem aprova sem ser administrador
      // precisa da verificação em duas etapas (E7). Recusar não pede.
      const segundoFator = corpo.decisao === 'aprovar' ? await conferirSegundoFatorDoPagador() : { recusa: null, aviso: null };
      if (segundoFator.recusa) return segundoFator.recusa;
      const pedido = await decidirPedido({
        id: String(corpo.id ?? ''), decisao: corpo.decisao === 'recusar' ? 'recusar' : corpo.decisao === 'aprovar' ? 'aprovar' : ('' as 'aprovar'),
        motivo: typeof corpo.motivo === 'string' ? corpo.motivo : '', sessao,
      });
      return NextResponse.json(segundoFator.aviso ? { pedido, aviso_segundo_fator: segundoFator.aviso } : { pedido });
    }
    if (corpo.acao === 'pedir_pagamento') {
      const r = await pedirAprovacaoDoPagamento({
        tenantId: tenantDaSessao(sessao), contaPagarId: String(corpo.conta_pagar_id ?? ''),
        solicitante: { id: sessao.userId, nome: sessao.nome }, motivo: typeof corpo.motivo === 'string' ? corpo.motivo : '',
      });
      return NextResponse.json(r, { status: r.jaExistia ? 200 : 201 });
    }
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (e) {
    return respostaDeErro(e);
  }
}
