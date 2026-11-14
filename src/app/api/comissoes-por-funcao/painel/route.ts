import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao, ISO_MES } from '@/lib/comissao-rota';
import { painelDoVendedor } from '@/lib/comissao-funcoes-servidor';
import { hojeISO } from '@/lib/money';
import { registrarAcessoSensivel } from '@/lib/acesso-sensivel';
import { recusaModulo } from '@/lib/guarda-rota';

// Painel do vendedor: o mês, a faixa, quanto falta e cada venda com "por que recebi isto?".
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  const ctx = await contextoDaComissao();
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const pedida = u.get('pessoa_id');
  const pessoa = pedida && pedida !== ctx.usuario.id ? pedida : ctx.usuario.id;
  const permitido = pessoa === ctx.usuario.id ? ctx.ver_proprias || ctx.ver_todos : ctx.ver_todos;
  if (!permitido) return NextResponse.json({ error: 'Seu acesso não inclui esta comissão.', codigo: 'SEM_DIREITO' }, { status: 403 });
  const mes = u.get('mes') ?? hojeISO().slice(0, 7);
  if (!ISO_MES.test(mes)) return NextResponse.json({ error: 'Mês inválido.', codigo: 'DADOS' }, { status: 400 });
  try {
    const painel = await painelDoVendedor(ctx.exec, ctx.tenantId, pessoa, mes);
    // Comissão de OUTRA pessoa: quem viu fica no Registro de atividades (E7).
    if (pessoa !== ctx.usuario.id) await registrarAcessoSensivel(ctx.sessao, 'comissao_pessoa', { alvo: pessoa, detalhe: `Mês ${mes}.` });
    return NextResponse.json(painel);
  } catch (e) { return respostaDeErroDaComissao(e); }
}
