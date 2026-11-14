import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { normalizarVenda, novoIdDaVenda } from '@/lib/venda-modelo';
import { salvarVenda } from '@/lib/venda-servidor';
import { aplicarAcordosDaAgencia } from '@/lib/fornecedor-servidor';
import { montarFicha, respostaDeErroDaVenda, usuarioDa } from '@/lib/venda-rota';
import { cabecalhoDaEmpresa } from '@/lib/empresas-rota';

// Lançar venda à mão no modelo completo (E5). Contrato em src/lib/venda-rota.ts.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => null)) as { venda?: unknown; empresa_id?: unknown } | null;
  const { venda, erros } = normalizarVenda(corpo?.venda);
  if (erros.length) return NextResponse.json({ error: erros[0].mensagem, codigo: 'DADOS', detalhes: { erros } }, { status: 400 });
  const sessao = await getSession();
  const tenantId = await getTenantId();
  const exec = pool as unknown as ExecutorSQL;
  venda.id = venda.id || novoIdDaVenda('vm-');
  venda.origem = 'manual';
  if (!venda.vendedor && sessao?.userId) venda.vendedor = { id: sessao.userId, nome: sessao.nome ?? '' };
  try {
    const { rows } = await exec.query(`SELECT 1 FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, venda.id]);
    if (rows.length) return NextResponse.json({ error: 'Esta venda já existe. Use a ficha da venda para mudar.', codigo: 'JA_EXISTE' }, { status: 409 });
    // Comissão, Over e Taxa CC que faltam vêm do acordo vigente na data da venda (parte C).
    // Várias empresas (E7): a empresa da venda, quando a tela manda (liberada para quem lança).
    const cabecalho = await cabecalhoDaEmpresa(sessao, corpo?.empresa_id);
    if (cabecalho instanceof NextResponse) return cabecalho;
    await emTransacao(async e => salvarVenda(e, tenantId, (await aplicarAcordosDaAgencia(e, tenantId, venda)).venda, { usuario: usuarioDa(sessao), origem: 'manual', cabecalho }));
    return NextResponse.json(await montarFicha(exec, tenantId, venda.id, sessao), { status: 201 });
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}
