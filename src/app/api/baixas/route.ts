import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { conferirSegundoFatorDoPagador, recusaFinanceira, respostaPeriodoFechado, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { ErroBaixa, historicoDaConta, registrarBaixas, type ItemBaixa } from '@/lib/baixas-servidor';
import type { TituloTabela } from '@/lib/baixa-calculo';
import { conferirBaixa, pedirAprovacaoDaBaixa, RecusaDaBaixa, type SessaoDaBaixa } from '@/lib/baixas-porteiro';
import { garantirCategoriasDeEncargos } from '@/lib/encargos-servidor';

// Liquidação no servidor (05/11/2026).
//   POST { modo: 'previa' | 'gravar', itens: ItemBaixa[], assinatura? }
//        cabeçalho Idempotency-Key ao gravar: repetir não grava duas vezes.
//        pedir_aprovacao: true → fora dos limites, abre o pedido (202) em vez de recusar.
//        Antes de gravar: direito de dar baixa, conta liberada, alçada e limites (baixas-porteiro).
//   GET  ?titulo_tabela=contas_receber&titulo_id=...  → histórico de baixas.
export const dynamic = 'force-dynamic';

function erro(e: unknown) {
  if (e instanceof RecusaDaBaixa) {
    return NextResponse.json({ error: e.message, ...(e.pedir ? { pedir_aprovacao: e.pedir } : {}) }, { status: e.status });
  }
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  if (e instanceof ErroBaixa) return NextResponse.json({ error: e.message }, { status: e.status });
  const st = (e as { status?: number })?.status;
  if (typeof st === 'number' && st >= 400 && st < 500) {
    return NextResponse.json({ error: (e as Error).message }, { status: st });
  }
  console.error('[baixas]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível registrar a baixa. Nada foi gravado.' }, { status: 500 });
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  const corpo = (await req.json().catch(() => null)) as {
    modo?: string; itens?: ItemBaixa[]; assinatura?: string; pedir_aprovacao?: boolean; motivo?: string;
  } | null;
  const gravar = corpo?.modo === 'gravar';
  const recusa = await recusaFinanceira(gravar ? 'escrever' : 'ler');
  if (recusa) return recusa;
  if (!corpo || !Array.isArray(corpo.itens)) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const tenantId = await getTenantId();
  const sessao = await getSession();
  const ctx = {
    tenantId,
    usuarioId: sessao?.userId,
    usuarioNome: sessao?.nome,
    origem: (corpo.itens.length > 1 ? 'lote' : 'tela') as 'lote' | 'tela',
    idempotencia: req.headers.get('idempotency-key') || undefined,
  };
  const itens = corpo.itens;
  const quem = (sessao ?? {}) as SessaoDaBaixa;
  // Quem PAGA (conta a pagar) sem ser administrador precisa da verificação em
  // duas etapas (E7): sem ela, a tela leva a Meu perfil; até o prazo, só avisa.
  // Receber não pede o código.
  const pagando = itens.some(i => i?.titulo_tabela === 'contas_pagar');
  const segundoFator = pagando ? await conferirSegundoFatorDoPagador() : { recusa: null, aviso: null };
  if (gravar && segundoFator.recusa) return segundoFator.recusa;
  try {
    if (!gravar) {
      const previa = await registrarBaixas(pool as unknown as ExecutorSQL, ctx, itens, { gravar: false });
      // A prévia também diz se vai precisar de aprovação, sem bloquear a tela.
      let porteiro: { ok: true } | { ok: false; error: string; pedir_aprovacao?: RecusaDaBaixa['pedir'] } = { ok: true };
      try {
        await conferirBaixa(pool as unknown as ExecutorSQL, quem, tenantId, itens, previa.itens);
      } catch (e) {
        if (!(e instanceof RecusaDaBaixa)) throw e;
        porteiro = { ok: false, error: e.message, ...(e.pedir ? { pedir_aprovacao: e.pedir } : {}) };
      }
      return NextResponse.json({
        ...previa, porteiro,
        ...(segundoFator.recusa ? { precisa_segundo_fator: true } : {}),
        ...(segundoFator.aviso ? { aviso_segundo_fator: segundoFator.aviso } : {}),
      });
    }
    const r = await emTransacao(async exec => {
      // Repetição da mesma gravação (mesma Idempotency-Key): já passou pelo
      // porteiro da primeira vez; devolve o que foi feito.
      const chaves = ctx.idempotencia ? itens.map((_, i) => `${ctx.idempotencia}:${i}`) : [];
      const jaFeitas = chaves.length
        ? Number((await exec.query(
          `SELECT count(*)::int AS n FROM baixas WHERE tenant_id = $1 AND chave_idempotencia = ANY($2::text[])`,
          [tenantId, chaves])).rows[0]?.n ?? 0)
        : 0;
      if (jaFeitas === itens.length) return registrarBaixas(exec, ctx, itens, { gravar: true, assinatura: corpo.assinatura });
      const previa = await registrarBaixas(exec, ctx, itens, { gravar: false });
      try {
        await conferirBaixa(exec, quem, tenantId, itens, previa.itens);
      } catch (e) {
        // Fora dos limites e a pessoa pediu aprovação: abre o pedido no lugar da baixa.
        if (e instanceof RecusaDaBaixa && e.pedir?.tipo === 'limites' && corpo.pedir_aprovacao === true) {
          const pedido = await pedirAprovacaoDaBaixa({
            exec, tenantId, sessao: quem, itens, previa: previa.itens, origem: ctx.origem,
            idempotencia: ctx.idempotencia, motivo: typeof corpo.motivo === 'string' ? corpo.motivo : undefined,
          });
          return { aguardando_aprovacao: true as const, ...pedido };
        }
        throw e;
      }
      return registrarBaixas(exec, ctx, itens, { gravar: true, assinatura: corpo.assinatura });
    });
    if ('aguardando_aprovacao' in r) return NextResponse.json(r, { status: 202 });
    // Primeira baixa com juros, multa, desconto ou taxa: garante as
    // categorias desses encargos no plano de contas (05/11/2026). Fora da
    // transação da baixa e sem nunca derrubá-la: a baixa já está gravada.
    const comEncargo = r.itens.some(i => !i.ja_existia && (i.plano.juros > 0 || i.plano.multa > 0 || i.plano.desconto > 0 || i.plano.taxa > 0));
    if (comEncargo) {
      await emTransacao(exec => garantirCategoriasDeEncargos(exec, tenantId))
        .catch(e => console.error('[baixas] categorias dos encargos:', e instanceof Error ? e.message : e));
    }
    return NextResponse.json(segundoFator.aviso ? { ...r, aviso_segundo_fator: segundoFator.aviso } : r);
  } catch (e) {
    return erro(e);
  }
}

export async function GET(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json([]);
  const url = new URL(req.url);
  const tabela = url.searchParams.get('titulo_tabela') as TituloTabela | null;
  const id = url.searchParams.get('titulo_id');
  if (!id || (tabela !== 'contas_receber' && tabela !== 'contas_pagar')) {
    return NextResponse.json({ error: 'Informe titulo_tabela e titulo_id.' }, { status: 400 });
  }
  const tenantId = await getTenantId();
  return NextResponse.json(await historicoDaConta(pool as unknown as ExecutorSQL, tenantId, tabela, id));
}
