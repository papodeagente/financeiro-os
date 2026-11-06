// Abas "Itens" e "Comissões" da conta a pagar/receber (E7, frente D):
// GET /api/titulos/{pagar|receber}/{id}/origem → { origem, itens, comissoes, comissoes_ocultas, anexos }.
// Comissões aparecem conforme o direito: ganho da agência, comissão da
// equipe ou só a própria.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { pode } from '@/lib/permissoes-servidor';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { lerTitulo, origemDoTitulo } from '@/lib/titulo-origem-servidor';
import { naoAchado, tabelaDoEndereco, tituloEscondido } from '@/lib/titulo-rota';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ tabela: string; id: string }> }) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  const { tabela: t, id } = await params;
  const tabela = tabelaDoEndereco(t);
  if (!tabela) return NextResponse.json({ error: 'Tabela inválida' }, { status: 400 });
  if (!pool) return NextResponse.json({ origem: { tipo: 'manual', rotulo: '', venda_id: null, fatura_id: null }, itens: [], comissoes: [], comissoes_ocultas: false, anexos: [] });
  const tenantId = await getTenantId();
  if (await tituloEscondido(tabela, id)) return naoAchado();
  const exec = pool as unknown as ExecutorSQL;
  const dados = await lerTitulo(exec, tenantId, tabela, id);
  if (!dados) return naoAchado();
  const sessao = await getSession();
  const [verGanho, verEquipe, verPropria] = await Promise.all([
    pode(sessao, 'ver_colunas_comissao'), pode(sessao, 'ver_comissoes_todos'), pode(sessao, 'ver_proprias_comissoes'),
  ]);
  try {
    return NextResponse.json(await origemDoTitulo(exec, tenantId, tabela, dados, {
      verGanho, verEquipe, verPropria, usuarioId: sessao?.userId ?? '',
    }));
  } catch (e) {
    console.error('[titulo-origem]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível ler a origem desta conta.' }, { status: 500 });
  }
}
