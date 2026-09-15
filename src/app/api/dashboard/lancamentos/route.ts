import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { hojeISO } from '@/lib/money';
import { RECORTES, listarLancamentos, type RecorteDoDetalhe } from '@/lib/dashboard-detalhe';

/**
 * Os lançamentos por trás de um número do painel.
 *
 * O recorte chega como NOME de uma lista fechada e a referência vai como
 * parâmetro da consulta. Nada vindo do navegador entra no SQL por concatenação
 * — e num banco sem foreign key e sem RLS, onde a única barreira entre duas
 * agências é o `WHERE tenant_id`, essa disciplina não é formalidade.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });

    const recusa = bloqueioFinanceiro(await getSession(), 'ler');
    if (recusa) return NextResponse.json({ error: recusa.erro }, { status: recusa.status });

    const tenantId = await getTenantId();
    const url = new URL(req.url);
    const hoje = hojeISO();

    const lado = url.searchParams.get('lado') === 'pagar' ? 'pagar' : 'receber';
    const recorteBruto = String(url.searchParams.get('recorte') ?? '');
    const recorte: RecorteDoDetalhe = RECORTES.includes(recorteBruto as RecorteDoDetalhe)
      ? (recorteBruto as RecorteDoDetalhe)
      : 'em-aberto';

    const deBruto = url.searchParams.get('de') ?? '';
    const ateBruto = url.searchParams.get('ate') ?? '';
    const de = DATA.test(deBruto) ? deBruto : `${hoje.slice(0, 7)}-01`;
    const ate = DATA.test(ateBruto) && ateBruto >= de ? ateBruto : hoje;

    const resultado = await listarLancamentos(pool, {
      tenantId, lado, recorte, de, ate, hoje,
      referencia: url.searchParams.get('ref') ?? '',
    });

    return NextResponse.json(resultado, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
