import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { contasPermitidas, pode } from '@/lib/permissoes-servidor';
import { registrarEventoAuditoria } from '@/lib/audit';
import { hojeISO } from '@/lib/money';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import {
  EXPORTACAO_MAX, FiltroInvalido, SELECAO_MAX, csvDasContas, lerContas, lerFiltro, lerTodas,
} from '@/lib/contas-pagar-receber';

/**
 * Contas a Pagar/Receber numa lista só (05/11/2026): só leitura, paginada no
 * servidor, com os totais do filtro inteiro no mesmo retrato.
 *
 *   GET ?de=&ate=&data=emissao|vencimento|liquidacao&situacao=&tipo=pagar|receber|ambos
 *       &busca=&em=&categoria=&centro=&conta=&ordem=&direcao=&pagina=&por_pagina=
 *   GET ...&format=csv     planilha do filtro inteiro (até 50.000 linhas; direito "exportar")
 *   GET ...&format=chaves  as contas do filtro inteiro, para "selecionar todas" (até 2.000)
 */
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  try {
    const recusa = await recusaFinanceira('ler');
    if (recusa) return recusa;
    const session = await getSession();
    const tenantId = session?.impersonatingTenantId || session?.tenantId;
    if (!tenantId) return NextResponse.json({ error: 'Agência não identificada.' }, { status: 403, headers: HEADERS });

    const params = new URL(req.url).searchParams;
    const filtro = lerFiltro(params, hojeISO());
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: HEADERS });
    // Contas liberadas (perfis de acesso): a regra das telas de pagar e receber.
    const liberadas = await contasPermitidas(session);
    const exec = pool as unknown as ExecutorSQL;
    const formato = params.get('format');

    if (formato === 'csv') {
      if (!(await pode(session, 'exportar'))) {
        return NextResponse.json({ error: 'Seu acesso não inclui baixar em Excel e PDF.' }, { status: 403, headers: HEADERS });
      }
      const linhas = await lerTodas(exec, tenantId, filtro, liberadas, EXPORTACAO_MAX + 1);
      if (linhas.length > EXPORTACAO_MAX) {
        return NextResponse.json(
          { error: 'A planilha aceita até 50.000 contas. Escolha um período menor ou mais filtros.' },
          { status: 422, headers: HEADERS },
        );
      }
      await registrarEventoAuditoria({
        session, tenantId, acao: 'EXPORTAR', modulo: 'Financeiro', entidade: 'contas_pagar_receber',
        descricao: `Exportou ${linhas.length} contas a pagar e a receber.`,
      }).catch(() => undefined);
      const nome = `contas-a-pagar-e-receber-${filtro.hoje}.csv`;
      return new Response(csvDasContas(linhas), {
        headers: { ...HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"` },
      });
    }

    if (formato === 'chaves') {
      const linhas = await lerTodas(exec, tenantId, filtro, liberadas, SELECAO_MAX + 1);
      return NextResponse.json({
        linhas: linhas.slice(0, SELECAO_MAX),
        cortado: linhas.length > SELECAO_MAX,
      }, { headers: HEADERS });
    }

    // Total, página e totais no mesmo retrato do banco.
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const resultado = await lerContas(client as unknown as ExecutorSQL, tenantId, filtro, liberadas);
      await client.query('COMMIT');
      return NextResponse.json(resultado, { headers: HEADERS });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e instanceof FiltroInvalido) return NextResponse.json({ error: e.message }, { status: 400, headers: HEADERS });
    console.error('[contas-pagar-receber] falha:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível ler as contas. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}
