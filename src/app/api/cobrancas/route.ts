import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira } from '@/lib/guarda-rota';
import { contasPermitidas } from '@/lib/permissoes-servidor';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import {
  gravarEmissao, hojeEmBrasilia, listarCobrancas, previaDaEmissao, type PedidoDeEmissao,
} from '@/lib/cobranca/servidor';
import {
  chaveDe, cobrancaParaTela, gravacaoParaTela, lerCorpo, previaParaTela, quemEsta, respostaDeErroDaCobranca,
} from '@/lib/cobranca/rota';

// Cobranças (E3, 05/11/2026). Dinheiro em reais nas respostas; erro = { error, codigo? }.
//   GET  ?status=<um status | em_aberto | lista com vírgula>&de=&ate= (vencimento)&provedor=&tipo=&busca=&conta_id=
//        &cliente_id=&pendencia=1 (só as pagas cuja baixa não entrou sozinha)&pagina=&por_pagina=
//        → { cobrancas: Cobranca[], totais: { aberto, vencido, pago, falhou }, por_status, pendencias: { quantidade, valor },
//            total, pagina, por_pagina }
//        (com conta_id: a mais recente primeiro)
//   POST { modo: 'previa' | 'gravar', contas: string[] (ou itens: [{ conta_id, vencimento? }]), provedor?, tipo?,
//          vencimento_vencidas?, descricao?, assinatura? }   cabeçalho Idempotency-Key ao gravar
//        prévia → { provedor, tipo, capacidades, itens: [{ conta_id, ok, motivo, codigo, aviso, cliente_nome,
//                   descricao, valor, vencimento, tipo }], prontos, total, encargos, conta_bancaria_id, assinatura }
//        gravar → { itens: [{ conta_id, ok, cobranca_id, status, erro }], na_fila (boolean), emitidas, cobrancas }
//        Uma conta = emitida na hora; várias = pela fila (2 chamadas/s por agência). Repetir não emite em dobro.
export const dynamic = 'force-dynamic';

type CorpoDaEmissao = Omit<PedidoDeEmissao, 'itens'> & {
  modo?: string; assinatura?: string; contas?: string[]; itens?: PedidoDeEmissao['itens'];
};

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ cobrancas: [], totais: null, total: 0 });
  const tenantId = await getTenantId();
  const u = new URL(req.url).searchParams;
  const status = (u.get('status') ?? '').split(',').map(s => s.trim()).filter(s => s && s !== 'todas');
  try {
    const r = await listarCobrancas(pool as unknown as ExecutorSQL, tenantId, {
      status, provedor: u.get('provedor') || undefined, tipo: u.get('tipo') || undefined,
      vencimento_de: u.get('de') || u.get('vencimento_de') || undefined,
      vencimento_ate: u.get('ate') || u.get('vencimento_ate') || undefined,
      cliente_id: u.get('cliente_id') || undefined, titulo_id: u.get('conta_id') || undefined, busca: u.get('busca') || undefined,
      pendencia: u.get('pendencia') === '1',
      pagina: Number(u.get('pagina')) || 1, por_pagina: Number(u.get('por_pagina')) || 50,
    }, await contasPermitidas(await getSession()));
    const { itens, ...resto } = r;
    return NextResponse.json({ ...resto, cobrancas: itens.map(cobrancaParaTela) });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'lista');
  }
}

export async function POST(req: Request) {
  const corpo = await lerCorpo<CorpoDaEmissao>(req);
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  const itens = Array.isArray(corpo?.itens) ? corpo!.itens
    : Array.isArray(corpo?.contas) ? corpo!.contas.map(conta_id => ({ conta_id: String(conta_id) })) : null;
  if (!corpo || !itens) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  if (corpo.tipo === 'carne' || corpo.tipo === 'link') {
    return NextResponse.json({ error: 'Carnê e link têm rota própria: /api/cobrancas/carne e /api/cobrancas/link.' }, { status: 400 });
  }
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const tenantId = await getTenantId();
  const pedido: PedidoDeEmissao = {
    itens, provedor: corpo.provedor || undefined, tipo: corpo.tipo || undefined,
    vencimento_vencidas: corpo.vencimento_vencidas, descricao: corpo.descricao,
  };
  try {
    const previa = await previaDaEmissao(pool as unknown as ExecutorSQL, tenantId, pedido, hojeEmBrasilia());
    if (corpo.modo !== 'gravar') return NextResponse.json(previaParaTela(previa));
    // A conta bancária onde a baixa vai entrar precisa estar liberada para quem emite.
    const recusaConta = await recusaAcao('gerar_boletos', { contaBancariaId: previa.conta_bancaria_id });
    if (recusaConta) return recusaConta;
    const r = await gravarEmissao(tenantId, pedido, { assinatura: corpo.assinatura, quem: await quemEsta(), idempotencia: chaveDe(req) });
    return NextResponse.json(gravacaoParaTela(r));
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'emitir');
  }
}
