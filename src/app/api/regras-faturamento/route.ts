import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { descricaoDaRegra } from '@/lib/fatura-regras';
import { listarRegras, salvarRegra } from '@/lib/fatura-servidor';
import { lerJson, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Regras de faturamento (E5, parte B).
//   GET ?pessoa_tipo=CLIENTE|FORNECEDOR|REPRESENTANTE&pessoa_id=&inativas=1 → { regras: [...regra, descricao_curta] }
//   POST { regra } → 201 { regra, descricao_curta }   (uma regra ativa por pessoa × produto × fornecedor: 409 REGRA_REPETIDA)
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ regras: [] });
  const u = new URL(req.url).searchParams;
  try {
    const regras = await listarRegras(pool as unknown as ExecutorSQL, await getTenantId(), {
      pessoa_tipo: u.get('pessoa_tipo') || undefined, pessoa_id: u.get('pessoa_id') || undefined, incluir_inativas: u.get('inativas') === '1',
    });
    return NextResponse.json({ regras: regras.map(r => ({ ...r, descricao_curta: descricaoDaRegra(r) })) });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await lerJson<{ regra?: Record<string, unknown> }>(req);
  if (!corpo?.regra) return NextResponse.json({ error: 'Mande a regra.', codigo: 'DADOS' }, { status: 400 });
  const tenantId = await getTenantId();
  const usuario = usuarioDaFatura(await getSession());
  try {
    const regra = await emTransacao(e => salvarRegra(e, tenantId, { ...corpo.regra, id: '' }, usuario));
    return NextResponse.json({ regra, descricao_curta: descricaoDaRegra(regra) }, { status: 201 });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
