import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { comissoesAPagar, lerConfigComissao } from '@/lib/comissao-funcoes-servidor';
import { registrarAcessoSensivel } from '@/lib/acesso-sensivel';
import { recusaModulo } from '@/lib/guarda-rota';

// Comissões fechadas em aberto, por pessoa. Quem não vê a equipe vê só as suas.
export const dynamic = 'force-dynamic';

export async function GET() {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  const ctx = await contextoDaComissao();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.ver_todos && !ctx.ver_proprias) return NextResponse.json({ error: 'Seu acesso não inclui comissões.', codigo: 'SEM_DIREITO' }, { status: 403 });
  try {
    const [pessoas, config] = await Promise.all([
      comissoesAPagar(ctx.exec, ctx.tenantId, ctx.ver_todos ? {} : { pessoa_id: ctx.usuario.id }),
      lerConfigComissao(ctx.exec, ctx.tenantId),
    ]);
    // A equipe inteira: quem viu fica no Registro de atividades (E7).
    if (ctx.ver_todos) await registrarAcessoSensivel(ctx.sessao, 'comissoes_equipe');
    return NextResponse.json({ regra: config.regra, so_as_suas: !ctx.ver_todos, pessoas });
  } catch (e) { return respostaDeErroDaComissao(e); }
}
