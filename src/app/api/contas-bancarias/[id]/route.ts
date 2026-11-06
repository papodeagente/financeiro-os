import { NextResponse } from 'next/server';
import { createCrudItemHandlers } from '@/lib/crud-api';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { recusaExclusao, recusaFinanceira } from '@/lib/guarda-rota';
import { contasPermitidas } from '@/lib/permissoes-servidor';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { mensagemContaComMovimento, usoDaContaBancaria } from '@/lib/contas-bancarias-servidor';
import { normalizarDadosDaConta } from '@/lib/contas-bancarias-dados';

// Uma conta bancária. Leitura e edição pelo CRUD de sempre, com a versão do
// registro (aviso de edição simultânea, 06/11/2026). Excluir (06/11/2026) só
// vale para a conta que nunca foi usada; a que tem movimento se desativa.
const crud = createCrudItemHandlers('contas_bancarias', ['nome', 'banco'], {
  somenteFinanceiro: true,
  // Conta não liberada por perfil de acesso: some da leitura e não se edita (05/11/2026).
  filtroDeConta: { cadastro: true },
  versao: true,
  mensagemConflito: 'Alguém mudou esta conta bancária depois que você abriu. Recarregue para ver a versão atual antes de salvar.',
});

type Params = { params: Promise<{ id: string }> };

export const GET = crud.GET;

export async function PUT(req: Request, ctx: Params) {
  const item = await req.json().catch(() => null);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
  const recusa = normalizarDadosDaConta(item as Record<string, unknown>);
  if (recusa) return NextResponse.json({ error: recusa }, { status: 400 });
  return crud.PUT(new Request(req.url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) }), ctx);
}

export async function DELETE(req: Request, ctx: Params) {
  try {
    const recusa = (await recusaExclusao()) ?? (await recusaFinanceira('escrever'));
    if (recusa) return recusa;
    await initDB();
    const { id } = await ctx.params;
    if (!pool) return crud.DELETE(req, ctx);
    const contas = await contasPermitidas(await getSession());
    if (contas !== null && !contas.includes(id)) {
      return NextResponse.json({ error: 'Esta conta bancária não está liberada para você.' }, { status: 403 });
    }
    const tenantId = await getTenantId();
    const uso = await usoDaContaBancaria(pool as unknown as ExecutorSQL, tenantId, id);
    if (uso.onde.length > 0) {
      return NextResponse.json({ error: mensagemContaComMovimento(uso.onde), com_movimento: true, onde: uso.onde }, { status: 409 });
    }
    return crud.DELETE(req, ctx);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
