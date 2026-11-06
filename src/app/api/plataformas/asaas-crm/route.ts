import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { podeEditarFinanceiro } from '@/lib/permissoes';
import { quemEsta } from '@/lib/cobranca/rota';
import {
  aplicarUnificacao, desfazerUnificacao, ErroUnificacao, planoDeUnificacao, type PlanoComLados,
} from '@/lib/asaas-unificado/servidor';

/**
 * Conexão Asaas unificada com o CRM (E7, 06/11/2026).
 *
 * GET: o plano (consulta o CRM e a conta Asaas daqui; não muda nada).
 * POST `{ acao: 'aplicar', assinatura }`: aplica o plano que a pessoa viu.
 * POST `{ acao: 'desfazer' }`: o CRM volta para a chave e o aviso dele.
 *
 * Mesma permissão da tela de plataformas: quem configura muda para onde o
 * dinheiro vai.
 */
function paraTela(p: PlanoComLados) {
  return {
    situacao: p.situacao,
    resumo: p.resumo,
    bloqueios: p.bloqueios,
    passos: p.passos,
    eventos_a_incluir: p.eventos_a_incluir,
    assinatura: p.assinatura,
    estado: p.estado,
    financeiro: { conectado: p.financeiro.conectado, ambiente: p.financeiro.ambiente, carteira: p.financeiro.carteira, aviso_encontrado: Boolean(p.financeiro.aviso) },
    crm: {
      situacao: p.crm.situacao, conectado: p.crm.conectado, ambiente: p.crm.ambiente, chave_final: p.crm.chave_final,
      carteira: p.crm.carteira, aviso_automatico: p.crm.aviso_automatico, pelo_financeiro: p.crm.pelo_financeiro,
    },
  };
}

async function porteiro(): Promise<NextResponse | null> {
  await initDB();
  if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
  const session = await getSession();
  if (!podeEditarFinanceiro(session ?? {})) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 });
  return null;
}

export async function GET() {
  try {
    const recusa = await porteiro();
    if (recusa) return recusa;
    const tenantId = await getTenantId();
    return NextResponse.json(paraTela(await planoDeUnificacao(tenantId)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const recusa = await porteiro();
    if (recusa) return recusa;
    const tenantId = await getTenantId();
    const body = (await req.json().catch(() => null)) as { acao?: string; assinatura?: string } | null;
    const quem = await quemEsta();
    if (body?.acao === 'aplicar') {
      const r = await aplicarUnificacao(tenantId, String(body.assinatura ?? ''), quem);
      return NextResponse.json({ ...paraTela(r.plano), aviso_do_crm: r.aviso_do_crm });
    }
    if (body?.acao === 'desfazer') {
      return NextResponse.json(paraTela(await desfazerUnificacao(tenantId, quem)));
    }
    return NextResponse.json({ error: 'Ação desconhecida: use aplicar ou desfazer.' }, { status: 400 });
  } catch (e) {
    if (e instanceof ErroUnificacao) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno' }, { status: 500 });
  }
}
