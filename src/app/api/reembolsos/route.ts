import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { criarReembolso, listarReembolsos, type SituacaoDoReembolso, type TipoDeReembolso } from '@/lib/reembolsos-servidor';
import { centavosDe, lerJson, respostaDeErroDaParteD } from '@/lib/parte-d-rota';

// Reembolsos ao cliente e do fornecedor (E5, parte D). Contrato em src/lib/parte-d-rota.ts.
export const dynamic = 'force-dynamic';

const TIPOS = new Set(['CLIENTE', 'FORNECEDOR']);
const SITUACOES = new Set(['SOLICITADO', 'APROVADO', 'PAGO', 'CANCELADO', 'em_andamento']);

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ reembolsos: [], totais: null });
  const tenantId = await getTenantId();
  const u = new URL(req.url).searchParams;
  const tipo = u.get('tipo') ?? '';
  const situacao = u.get('situacao') ?? '';
  try {
    return NextResponse.json(await emTransacao(exec => listarReembolsos(exec, tenantId, {
      tipo: TIPOS.has(tipo) ? tipo as TipoDeReembolso : '',
      sentido: u.get('sentido') === 'PAGAR' ? 'PAGAR' : u.get('sentido') === 'RECEBER' ? 'RECEBER' : '',
      situacao: SITUACOES.has(situacao) ? situacao as SituacaoDoReembolso | 'em_andamento' : '',
      de: u.get('de') ?? '', ate: u.get('ate') ?? '', busca: u.get('busca') ?? '', venda_id: u.get('venda_id') ?? '',
    })));
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('cuidar_reembolsos');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const tenantId = await getTenantId();
  const sessao = await getSession();
  const c = await lerJson<Record<string, unknown>>(req);
  const tipo = String(c?.tipo ?? '');
  try {
    const exec = pool as unknown as ExecutorSQL;
    let vendaNumero = '';
    const vendaId = String(c?.venda_id ?? '');
    if (vendaId) {
      const { rows } = await exec.query(`SELECT data->>'numero' AS n FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, vendaId]);
      if (!rows.length) return NextResponse.json({ error: 'Venda não encontrada.', codigo: 'VENDA' }, { status: 404 });
      vendaNumero = String(rows[0].n ?? '');
    }
    const r = await emTransacao(e => criarReembolso(e, tenantId, {
      tipo: (TIPOS.has(tipo) ? tipo : '') as TipoDeReembolso, venda_id: vendaId, venda_numero: vendaNumero,
      sentido: String(c?.sentido ?? '').toUpperCase() === 'PAGAR' ? 'PAGAR' : 'RECEBER',
      pessoa_id: String(c?.pessoa_id ?? ''), pessoa_nome: String(c?.pessoa_nome ?? ''),
      valor_centavos: centavosDe(c?.valor_centavos), descricao: String(c?.descricao ?? ''),
      prazo: typeof c?.prazo === 'string' ? c.prazo : undefined, aprovar: c?.aprovar === true,
    }, sessao?.nome || sessao?.userId || ''));
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}
