import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { contasPermitidas, pode } from '@/lib/permissoes-servidor';
import { registrarEventoAuditoria } from '@/lib/audit';
import { contasBancariasVisiveis, escopoDaSessao, type ExecutorEmpresas } from '@/lib/empresas-servidor';
import { hojeISO } from '@/lib/money';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import {
  EXPORTACAO_MAX, FiltroInvalido, csvDosMovimentos, lerFiltro, lerMovimentos, lerParaExportar,
  type LeiauteDeExportacao,
} from '@/lib/movimentos-caixa';

/**
 * Extrato de conta e Movimentações (05/11/2026): só leitura, paginado no
 * servidor, com saldo linha a linha. Exige permissão de leitura do
 * financeiro, como o painel (saldo é dado de dono).
 *
 *   GET ?contas=a,b&de=&ate=&tipo=&origem=&forma=&pessoa=&busca=&taxas=0|1
 *       &ordem=&direcao=&agrupar=&pagina=&por_pagina=
 *   GET ...&format=csv&leiaute=extrato|movimentacoes  (até 50.000 linhas)
 */
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const recusa = bloqueioFinanceiro(session, 'ler');
    if (recusa) return NextResponse.json({ error: recusa.erro }, { status: recusa.status, headers: HEADERS });
    const tenantId = session?.impersonatingTenantId || session?.tenantId;
    if (!tenantId) return NextResponse.json({ error: 'Agência não identificada.' }, { status: 403, headers: HEADERS });

    const params = new URL(req.url).searchParams;
    const filtro = lerFiltro(params, hojeISO());
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: HEADERS });
    // Perfis de acesso (05/11/2026): saldo e extrato só das contas liberadas.
    if (!(await pode(session, 'ver_conta_bancaria'))) {
      return NextResponse.json({ error: 'Seu acesso não inclui ver saldo e extrato.' }, { status: 403, headers: HEADERS });
    }
    const liberadas = await contasPermitidas(session);
    if (liberadas !== null) {
      const pedidas = filtro.contas.length ? filtro.contas.filter(c => liberadas.includes(c)) : liberadas;
      // Lista vazia quer dizer "todas"; sem conta liberada, um id que não existe.
      filtro.contas = pedidas.length ? pedidas : ['__nenhuma_conta_liberada__'];
    }
    // Várias empresas (E7): só as contas disponíveis nas empresas marcadas.
    // Uma empresa só: nada muda.
    const { visiveis } = await escopoDaSessao(session, pool as unknown as ExecutorEmpresas);
    const daEmpresa = await contasBancariasVisiveis(pool as unknown as ExecutorEmpresas, tenantId, visiveis);
    if (daEmpresa) {
      const pedidas = filtro.contas.length ? filtro.contas.filter(c => daEmpresa.has(c)) : [...daEmpresa];
      filtro.contas = pedidas.length ? pedidas : ['__nenhuma_conta_na_empresa__'];
    }

    if (params.get('format') === 'csv') {
      if (!(await pode(session, 'exportar'))) {
        return NextResponse.json({ error: 'Seu acesso não inclui baixar em Excel e PDF.' }, { status: 403, headers: HEADERS });
      }
      const leiaute: LeiauteDeExportacao = params.get('leiaute') === 'movimentacoes' ? 'movimentacoes' : 'extrato';
      const linhas = await lerParaExportar(pool as unknown as ExecutorSQL, tenantId, filtro);
      if (linhas.length > EXPORTACAO_MAX) {
        return NextResponse.json(
          { error: 'A exportação aceita até 50.000 linhas. Reduza o período ou use mais filtros.' },
          { status: 422, headers: HEADERS },
        );
      }
      await registrarEventoAuditoria({
        session, tenantId, acao: 'EXPORTAR', modulo: 'Financeiro', entidade: 'movimentos_caixa',
        descricao: `Exportou ${linhas.length} linhas de ${leiaute === 'extrato' ? 'Extrato de conta' : 'Movimentações'} (${filtro.de} a ${filtro.ate}).`,
      }).catch(() => undefined);
      const nome = `${leiaute === 'extrato' ? 'extrato-de-conta' : 'movimentacoes'}-${filtro.de}-a-${filtro.ate}.csv`;
      return new Response(csvDosMovimentos(linhas, leiaute), {
        headers: { ...HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"` },
      });
    }

    // Total, página, grupos e saldos por conta no mesmo retrato do banco.
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const resultado = await lerMovimentos(client as unknown as ExecutorSQL, tenantId, filtro);
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
    console.error('[movimentos-caixa] falha:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível ler os movimentos. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}
