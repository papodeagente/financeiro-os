import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { podeGerenciarUsuarios } from '@/lib/permissoes';
import { emTransacao } from '@/lib/caixa-atomico';
import {
  escopoDaSessao, listarEmpresas, salvarEmpresa, type ExecutorEmpresas,
} from '@/lib/empresas-servidor';
import { respostaDeErroDaEmpresa } from '@/lib/empresas-rota';

// Empresas da agência (06/11/2026, E7 G2). Contrato em src/lib/empresas-rota.ts.
//   GET  → { empresas, multi, selecao, permitidas, visiveis, pode_editar }
//          ?inativas=1 inclui as desativadas (tela de cadastro)
//   POST → cria ou altera uma empresa (só administrador) → a empresa gravada
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const semModulo = await recusaModulo('empresas');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ empresas: [], multi: false, selecao: [], permitidas: null, visiveis: null, pode_editar: false }, { headers: HEADERS });
  try {
    const sessao = await getSession();
    const exec = pool as unknown as ExecutorEmpresas;
    const tenantId = await getTenantId();
    const escopo = await escopoDaSessao(sessao, exec);
    const inativas = req?.url ? new URL(req.url).searchParams.get('inativas') === '1' : false;
    const empresas = inativas || !escopo.multi ? await listarEmpresas(exec, tenantId, { inativas }) : escopo.empresas;
    // Quem tem empresas restritas só enxerga as liberadas, também no seletor.
    const doSeletor = escopo.permitidas === null ? empresas : empresas.filter(e => escopo.permitidas!.includes(e.id));
    return NextResponse.json({
      empresas: inativas ? empresas : doSeletor,
      multi: escopo.multi,
      selecao: escopo.selecao,
      permitidas: escopo.permitidas,
      visiveis: escopo.visiveis,
      pode_editar: podeGerenciarUsuarios(sessao),
    }, { headers: HEADERS });
  } catch (e) {
    return respostaDeErroDaEmpresa(e);
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('empresas');
  if (semModulo) return semModulo;
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  try {
    const tenantId = await getTenantId();
    const empresa = await emTransacao(exec => salvarEmpresa(exec as unknown as ExecutorEmpresas, tenantId, corpo as Record<string, unknown>));
    return NextResponse.json(empresa);
  } catch (e) {
    return respostaDeErroDaEmpresa(e);
  }
}
