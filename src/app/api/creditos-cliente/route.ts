import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { criarCredito, extratoDoClienteNoBanco, listarCarteiras } from '@/lib/credito-cliente-servidor';
import { centavosDe, lerJson, respostaDeErroDaParteD } from '@/lib/parte-d-rota';

// Carteira de crédito do cliente (E5, parte D). Contrato em src/lib/parte-d-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ carteiras: [], totais: null });
  const exec = pool as unknown as ExecutorSQL;
  const tenantId = await getTenantId();
  const u = new URL(req.url).searchParams;
  try {
    const cliente = u.get('cliente_id');
    if (cliente) return NextResponse.json(await extratoDoClienteNoBanco(exec, tenantId, cliente));
    const carteiras = await listarCarteiras(exec, tenantId, undefined, { busca: u.get('busca') ?? '', so_com_saldo: u.get('so_com_saldo') === '1' });
    return NextResponse.json({
      carteiras,
      totais: {
        disponivel: carteiras.reduce((a, c) => a + c.disponivel, 0),
        vencendo: carteiras.reduce((a, c) => a + c.vencendo, 0),
        clientes_com_saldo: carteiras.filter(c => c.disponivel > 0).length,
      },
    });
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('usar_credito_cliente');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const tenantId = await getTenantId();
  const sessao = await getSession();
  const c = await lerJson<Record<string, unknown>>(req);
  const descricao = String(c?.descricao ?? '').trim();
  if (descricao.length < 5) return NextResponse.json({ error: 'Diga de onde vem o crédito (pelo menos 5 letras).', codigo: 'MOTIVO' }, { status: 400 });
  try {
    const credito = await emTransacao(e => criarCredito(e, tenantId, {
      cliente_id: String(c?.cliente_id ?? ''), cliente_nome: String(c?.cliente_nome ?? ''), origem: 'AJUSTE',
      valor_centavos: centavosDe(c?.valor_centavos), validade: typeof c?.validade === 'string' ? c.validade : undefined, descricao,
    }, sessao?.nome || sessao?.userId || ''));
    return NextResponse.json(credito, { status: 201 });
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}
