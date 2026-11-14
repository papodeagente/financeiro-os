import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import { emTransacao } from '@/lib/caixa-atomico';
import { alterarTaxaCC } from '@/lib/fornecedor-servidor';
import { corpo, respostaDeErroDoFornecedor, texto } from '@/lib/fornecedor-rota';

// Alterar a Taxa CC DU ou RAV de um produto ainda a faturar, com motivo.
// A venda refaz as contas e o motivo fica no histórico dela.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('gerar_fatura_fornecedor');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const c = await corpo(req);
  const acesso = await vendaAutorizada(texto(c.venda_id));
  if (acesso instanceof NextResponse) return acesso;
  try {
    const r = await emTransacao(e => alterarTaxaCC(e, acesso.tenantId, {
      venda_id: texto(c.venda_id), produto_id: texto(c.produto_id), lado: texto(c.lado).toUpperCase() as 'DU' | 'RAV',
      valor_centavos: Number(c.valor_centavos), motivo: texto(c.motivo),
    }, { id: acesso.sessao.userId, nome: acesso.sessao.nome ?? '' }));
    return NextResponse.json({ de: r.de, para: r.para });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
