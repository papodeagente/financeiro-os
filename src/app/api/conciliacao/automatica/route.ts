import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, respostaPeriodoFechado, recusaModulo } from '@/lib/guarda-rota';
import { contasPermitidas } from '@/lib/permissoes-servidor';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { ErroConciliacao } from '@/lib/conciliacao-servidor';
import { ErroBaixa } from '@/lib/baixas-servidor';
import { conferirBaixa, RecusaDaBaixa, type SessaoDaBaixa } from '@/lib/baixas-porteiro';
import { registrarEventoAuditoria } from '@/lib/audit';
import {
  criarContaDaTarifa, excluirRegra, executarConciliacaoAutomatica, ligarRegra, listarAutomaticas, listarRegras,
  sugestoesDasRegras, tarifasSugeridas,
} from '@/lib/conciliacao-automatica';
import { certezaDaRegra } from '@/lib/conciliacao-regras';

/**
 * Conciliação automática com regras aprendidas (E6, 05/11/2026).
 *
 * GET  → regras aprendidas, sugestões das linhas a conciliar, a lista
 *        "conciliado sozinho" e as tarifas que se repetem. Só das contas
 *        bancárias liberadas para a pessoa.
 * POST { acao: 'executar', conta_bancaria_id? }   concilia sozinho o que a
 *        regra ligada tem certeza; cada baixa passa pelo porteiro.
 *      { acao: 'ligar', regra_id, ligar }          só quem configura limites.
 *      { acao: 'excluir_regra', regra_id }
 *      { acao: 'criar_tarifa', chave, fornecedor_nome, categoria_id? }
 * Desfazer uma conciliação automática é o mesmo "desfazer" da conciliação
 * (POST /api/conciliacao/conciliar { acao: 'desfazer' }).
 */
export const dynamic = 'force-dynamic';

function erro(e: unknown) {
  if (e instanceof ErroConciliacao || e instanceof ErroBaixa) return NextResponse.json({ error: e.message }, { status: e.status });
  const fechado = respostaPeriodoFechado(e);
  if (fechado) return fechado;
  console.error('[conciliacao-automatica]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir. Nada foi gravado.' }, { status: 500 });
}

export async function GET(req: Request) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('conciliar');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  try {
    const sessao = await getSession();
    const tenantId = await getTenantId();
    const exec = pool as unknown as ExecutorSQL;
    const contas = await contasPermitidas(sessao);
    const conta = new URL(req.url).searchParams.get('conta_bancaria_id') || null;
    const [regras, sugestoes, automaticas, tarifas] = await Promise.all([
      listarRegras(exec, tenantId),
      sugestoesDasRegras(exec, tenantId, { contas, contaBancariaId: conta }),
      listarAutomaticas(exec, tenantId, { contas }),
      tarifasSugeridas(exec, tenantId, contas),
    ]);
    return NextResponse.json({
      regras: regras
        .filter(r => !contas || !r.conta_bancaria_id || contas.includes(r.conta_bancaria_id))
        .map(r => ({ ...r, certeza: certezaDaRegra(r) })),
      sugestoes,
      automaticas,
      tarifas,
    });
  } catch (e) {
    return erro(e);
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const acao = String(corpo?.acao ?? '');
  const contaPedida = corpo?.conta_bancaria_id ? String(corpo.conta_bancaria_id) : null;
  const recusa = await recusaAcao('conciliar', contaPedida ? { contaBancariaId: contaPedida } : undefined);
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  try {
    const sessao = await getSession();
    const tenantId = await getTenantId();
    const exec = pool as unknown as ExecutorSQL;
    const contas = await contasPermitidas(sessao);
    const quem = { usuarioId: sessao?.userId, usuarioNome: sessao?.nome };

    if (acao === 'executar') {
      const porteiro = (sessao ?? {}) as SessaoDaBaixa;
      const r = await executarConciliacaoAutomatica(exec, emTransacao, {
        tenantId, ...quem, contas,
        conferir: async (x, itens, previa) => {
          try {
            await conferirBaixa(x, porteiro, tenantId, itens, previa);
          } catch (e) {
            // A recusa do porteiro vira o motivo de a linha não ir sozinha.
            if (e instanceof RecusaDaBaixa) throw new ErroConciliacao(e.message, e.status);
            throw e;
          }
        },
      }, { contaBancariaId: contaPedida });
      if (r.conciliadas.length > 0) {
        await registrarEventoAuditoria({
          tenantId, acao: 'EDITAR', modulo: 'Financeiro', entidade: 'conciliacoes_automaticas', entidadeId: r.conciliadas[0].automatica_id,
          descricao: `Conciliação automática: ${r.conciliadas.length} ${r.conciliadas.length === 1 ? 'linha conciliada' : 'linhas conciliadas'} pelas regras ligadas.`,
        }).catch(() => {});
      }
      return NextResponse.json(r);
    }

    if (acao === 'ligar') {
      // Conciliar sozinho é política da agência: decide quem configura limites.
      const recusaPolitica = await recusaAcao('configurar_limites');
      if (recusaPolitica) return recusaPolitica;
      const ligar = corpo?.ligar === true;
      const r = await emTransacao(x => ligarRegra(x, tenantId, String(corpo?.regra_id ?? ''), ligar, quem));
      await registrarEventoAuditoria({
        tenantId, acao: 'EDITAR', modulo: 'Financeiro', entidade: 'conciliacao_regras', entidadeId: r.id,
        descricao: `${ligar ? 'Ligou' : 'Desligou'} a conciliação automática da regra de ${r.pessoa_nome || 'uma descrição do banco'}.`,
      }).catch(() => {});
      return NextResponse.json({ regra: { ...r, certeza: certezaDaRegra(r) } });
    }

    if (acao === 'excluir_regra') {
      const ok = await excluirRegra(exec, tenantId, String(corpo?.regra_id ?? ''));
      if (!ok) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (acao === 'criar_tarifa') {
      const recusaEditar = await recusaAcao('editar_financeiro');
      if (recusaEditar) return recusaEditar;
      const r = await emTransacao(x => criarContaDaTarifa(x, tenantId, String(corpo?.chave ?? ''), {
        fornecedor_nome: String(corpo?.fornecedor_nome ?? ''),
        categoria_id: corpo?.categoria_id ? String(corpo.categoria_id) : undefined,
        contas,
      }));
      return NextResponse.json(r);
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (e) {
    return erro(e);
  }
}
