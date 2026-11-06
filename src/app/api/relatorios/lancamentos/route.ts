// Relatórios por categoria, por centro de custo e por rateio (05/11/2026).
// GET ?visao=categoria|centro|rateio&data_de=&de=&ate=&situacao=&tipo=...
// devolve a página pedida e os totais do recorte; &formato=csv devolve a
// planilha inteira (célula protegida contra fórmula) e registra a exportação;
// &formato=xlsx|pdf|imprimir devolve o mesmo recorte em Excel, PDF ou impressão.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { podeExportar } from '@/lib/permissoes';
import { registrarEventoAuditoria } from '@/lib/audit';
import { hojeISO } from '@/lib/money';
import { ErroFiltro, documentoDasLinhas, lerFiltros, planilhaDasLinhas } from '@/lib/lancamentos-por-dimensao';
import { consultarLancamentos, linhasDoRelatorio } from '@/lib/lancamentos-por-dimensao-servidor';
import { responderExportacao } from '@/lib/exportacao/servidor';
import type { ExecutorPermissoes } from '@/lib/permissoes-servidor';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

const NOME: Record<string, string> = {
  categoria: 'relatorio-por-categoria',
  centro: 'relatorio-por-centro-de-custo',
  rateio: 'relatorio-por-rateio',
};

export async function GET(req: Request) {
  try {
    const recusa = await recusaFinanceira('ler');
    if (recusa) return recusa;
    const params = new URL(req.url).searchParams;
    const hoje = hojeISO();
    const filtros = lerFiltros(params, hoje);
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Relatório indisponível no momento.' }, { status: 503, headers: HEADERS });
    const tenantId = await getTenantId();

    // Excel (.xlsx), PDF e impressão (E7, G3): o mesmo recorte do CSV, pelo módulo único.
    const formatoNovo = params.get('formato');
    if (formatoNovo === 'xlsx' || formatoNovo === 'pdf' || formatoNovo === 'imprimir') {
      const sessao = await getSession();
      if (!podeExportar(sessao)) {
        return NextResponse.json({ error: 'Seu perfil não pode exportar.' }, { status: 403, headers: HEADERS });
      }
      const { linhas } = await linhasDoRelatorio(pool, tenantId, filtros, hoje);
      return responderExportacao(sessao, documentoDasLinhas(filtros, linhas), formatoNovo, {
        exec: pool as unknown as ExecutorPermissoes, entidade: NOME[filtros.visao],
      });
    }

    if (params.get('formato') === 'csv') {
      const sessao = await getSession();
      if (!podeExportar(sessao)) {
        return NextResponse.json({ error: 'Seu perfil não pode exportar.' }, { status: 403, headers: HEADERS });
      }
      const { linhas } = await linhasDoRelatorio(pool, tenantId, filtros, hoje);
      const csv = planilhaDasLinhas(filtros.visao, linhas);
      await registrarEventoAuditoria({
        session: sessao, tenantId, acao: 'EXPORTAR', modulo: 'Financeiro', entidade: NOME[filtros.visao],
        descricao: `Exportou ${linhas.length} linhas de ${NOME[filtros.visao].replace(/-/g, ' ')} (${filtros.de} a ${filtros.ate}).`,
      });
      return new Response(csv, { headers: {
        ...HEADERS, 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${NOME[filtros.visao]}-${filtros.de}-a-${filtros.ate}.csv"`,
      } });
    }

    return NextResponse.json(await consultarLancamentos(pool, tenantId, filtros, hoje), { headers: HEADERS });
  } catch (e) {
    if (e instanceof ErroFiltro) return NextResponse.json({ error: e.message }, { status: 400, headers: HEADERS });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500, headers: HEADERS });
  }
}
