import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { pode } from '@/lib/permissoes-servidor';
import { registrarEventoAuditoria } from '@/lib/audit';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import {
  buscarItensDeVenda, comissaoGeral, criarConferencia, ErroConferencia, leituraGuardada, listarConferencias,
} from '@/lib/conferencia-operadora-servidor';

/**
 * Conferência do extrato de operadora (E6, 05/11/2026).
 *
 * GET  → as conferências (abertas e fechadas) e a comissão esperada ×
 *        informada × recebida por operadora (?de=&ate=). `?venda=termo` busca
 *        vendas para ligar uma linha à mão.
 * POST { hash, fornecedor_id, fornecedor_nome, periodo_de?, periodo_ate? }
 *        grava a conferência do arquivo já lido (POST /ler). As linhas vêm da
 *        leitura guardada pelo hash, nunca do corpo.
 */
export const dynamic = 'force-dynamic';

const dataOuNull = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function GET(req: Request) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('conciliar');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  const tenantId = await getTenantId();
  const url = new URL(req.url);
  const termo = url.searchParams.get('venda');
  if (termo !== null) return NextResponse.json({ itens: await buscarItensDeVenda(exec, tenantId, termo) });
  const verComissao = await pode(await getSession(), 'ver_colunas_comissao');
  const [conferencias, comissao] = await Promise.all([
    listarConferencias(exec, tenantId),
    verComissao ? comissaoGeral(exec, tenantId, dataOuNull(url.searchParams.get('de')), dataOuNull(url.searchParams.get('ate'))) : Promise.resolve(null),
  ]);
  return NextResponse.json({ conferencias, comissao });
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('conciliar');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  try {
    const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const hash = String(corpo?.hash ?? '');
    if (!/^[a-f0-9]{64}$/.test(hash)) return NextResponse.json({ error: 'Leia o extrato antes de conferir.' }, { status: 400 });
    const sessao = await getSession();
    const tenantId = await getTenantId();
    const exec = pool as unknown as ExecutorSQL;
    const guardada = await leituraGuardada(exec, tenantId, hash);
    if (!guardada) return NextResponse.json({ error: 'A leitura deste extrato não foi encontrada. Envie o arquivo de novo.' }, { status: 404 });
    const r = await emTransacao(x => criarConferencia(x, tenantId, {
      hash, extrato: guardada.leitura.extrato, arquivo_nome: guardada.nome, origem: guardada.leitura.origem,
      fornecedor_id: String(corpo?.fornecedor_id ?? ''), fornecedor_nome: String(corpo?.fornecedor_nome ?? ''),
      periodo_de: dataOuNull(corpo?.periodo_de ? String(corpo.periodo_de) : null),
      periodo_ate: dataOuNull(corpo?.periodo_ate ? String(corpo.periodo_ate) : null),
      quem: { usuarioId: sessao?.userId, usuarioNome: sessao?.nome },
    }));
    await registrarEventoAuditoria({
      tenantId, acao: 'CRIAR', modulo: 'Financeiro', entidade: 'conferencias_operadora', entidadeId: r.id,
      descricao: `Abriu a conferência do extrato ${guardada.nome} (${guardada.leitura.extrato.linhas.length} linhas).`,
    }).catch(() => {});
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof ErroConferencia) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[conferencia-operadora]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível gravar a conferência. Nada foi gravado.' }, { status: 500 });
  }
}
