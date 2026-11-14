import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import {
  comissoesManuaisDaVenda, excluirComissaoManual, lancarComissaoManual, lerCadastro, lerConfigComissao,
} from '@/lib/comissao-funcoes-servidor';
import { baseDaComissaoManual } from '@/lib/comissao-funcoes';
import { carregarVenda, lerConfigVenda } from '@/lib/venda-servidor';
import { pode } from '@/lib/permissoes-servidor';
import { emTransacao } from '@/lib/caixa-atomico';
import { recusaModulo } from '@/lib/guarda-rota';

// Comissão manual na venda (indicação, bônus), E7.
//   GET    ?venda_id=          as manuais da venda, a base do percentual e quem pode receber
//   POST   { venda_id, pessoa_funcao_id, descricao, tipo, percentual?, valor_centavos? }
//   DELETE ?venda_id=&id=      exclui a que ainda não entrou em nenhum fechamento
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  const ctx = await contextoDaComissao(['ver_colunas_comissao']);
  if (ctx instanceof NextResponse) return ctx;
  const vendaId = new URL(req.url).searchParams.get('venda_id') ?? '';
  if (!vendaId) return NextResponse.json({ error: 'Diga a venda.', codigo: 'DADOS' }, { status: 400 });
  try {
    const { exec, tenantId } = ctx;
    const carregada = await carregarVenda(exec, tenantId, vendaId);
    if (!carregada) return NextResponse.json({ error: 'Venda não encontrada.', codigo: 'NAO_ENCONTRADA' }, { status: 404 });
    const [config, cfgVenda, manuais, podeLancar] = await Promise.all([
      lerConfigComissao(exec, tenantId), lerConfigVenda(exec, tenantId), comissoesManuaisDaVenda(exec, tenantId, vendaId),
      pode(ctx.sessao, 'lancar_comissao_manual', { exec }),
    ]);
    let pessoas: Array<{ id: string; nome: string; funcao_nome: string }> = [];
    if (podeLancar && config.regra === 'FUNCOES') {
      const cad = await lerCadastro(exec, tenantId);
      const nomeDaFuncao = new Map(cad.funcoes.filter(f => f.ativo).map(f => [f.id, f.nome]));
      pessoas = cad.pessoas
        .filter(p => nomeDaFuncao.has(p.funcao_id))
        .map(p => ({ id: p.id, nome: p.pessoa_nome, funcao_nome: nomeDaFuncao.get(p.funcao_id) ?? '' }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.funcao_nome.localeCompare(b.funcao_nome, 'pt-BR'));
    }
    return NextResponse.json({
      regra: config.regra,
      pode_lancar: podeLancar,
      situacao_venda: carregada.situacao,
      cancelada: String(carregada.cabecalho.status ?? '').toUpperCase() === 'CANCELADO',
      base_centavos: baseDaComissaoManual(carregada.venda, cfgVenda.receita),
      manuais,
      pessoas,
    });
  } catch (e) { return respostaDeErroDaComissao(e); }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  const ctx = await contextoDaComissao(['lancar_comissao_manual']);
  if (ctx instanceof NextResponse) return ctx;
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo || !corpo.venda_id) return NextResponse.json({ error: 'Diga a venda.', codigo: 'DADOS' }, { status: 400 });
  try {
    const r = await emTransacao(e => lancarComissaoManual(e, ctx.tenantId, String(corpo.venda_id), corpo, ctx.usuario));
    return NextResponse.json(r, { status: 201 });
  } catch (e) { return respostaDeErroDaComissao(e); }
}

export async function DELETE(req: Request) {
  const semModulo = await recusaModulo('comissoes');
  if (semModulo) return semModulo;
  const ctx = await contextoDaComissao(['lancar_comissao_manual']);
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const vendaId = u.get('venda_id') ?? '';
  const id = u.get('id') ?? '';
  if (!vendaId || !id) return NextResponse.json({ error: 'Diga a venda e a comissão.', codigo: 'DADOS' }, { status: 400 });
  try {
    await emTransacao(e => excluirComissaoManual(e, ctx.tenantId, vendaId, id, ctx.usuario));
    return NextResponse.json({ ok: true });
  } catch (e) { return respostaDeErroDaComissao(e); }
}
