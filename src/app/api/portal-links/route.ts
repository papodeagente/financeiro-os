import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { registrarEventoAuditoria } from '@/lib/audit';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { getCanonicalBaseUrl } from '@/lib/canonical-hosts';
import { recusaAcao, recusaFinanceira } from '@/lib/guarda-rota';
import { clienteDaAgencia, criarLink, estadoDoLink, revogarLink, type EstadoDoLink } from '@/lib/cobranca/portal-servidor';

/**
 * Link do portal do cliente, do lado da agência (05/11/2026).
 *
 *   GET    ?cliente_id=   o link está ativo? desde quando, último acesso
 *   POST   { cliente_id } cria o link (o anterior para de abrir)
 *   DELETE { cliente_id } revoga: o link para de abrir na hora
 *
 * Ver é de quem vê o financeiro; criar e revogar, de quem emite boleto e Pix
 * (o link mostra as cobranças ao cliente).
 */
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

function tenantDa(s: Awaited<ReturnType<typeof getSession>>): string | null {
  return s?.impersonatingTenantId || s?.tenantId || null;
}

function comUrl(e: EstadoDoLink, req: Request) {
  let base = '';
  try { base = getCanonicalBaseUrl(); } catch { base = ''; }
  if (!base) { try { base = new URL(req.url).origin; } catch { base = ''; } }
  return {
    ativo: e.ativo,
    url: e.caminho ? `${base}${e.caminho}` : null,
    criado_em: e.criado_em,
    ultimo_acesso_em: e.ultimo_acesso_em,
    acessos: e.acessos,
  };
}

async function clienteDoPedido(req: Request, deCorpo: boolean): Promise<string> {
  if (!deCorpo) return (new URL(req.url).searchParams.get('cliente_id') ?? '').trim();
  const corpo = (await req.json().catch(() => null)) as { cliente_id?: unknown } | null;
  return typeof corpo?.cliente_id === 'string' ? corpo.cliente_id.trim() : '';
}

async function preparar(req: Request, modo: 'ler' | 'escrever') {
  const recusa = modo === 'ler' ? await recusaFinanceira('ler') : await recusaAcao('gerar_boletos');
  if (recusa) return { resposta: recusa };
  const sessao = await getSession();
  const tenant = tenantDa(sessao);
  if (!tenant) return { resposta: NextResponse.json({ error: 'Agência não identificada.' }, { status: 403, headers: HEADERS }) };
  const clienteId = await clienteDoPedido(req, modo === 'escrever');
  if (!clienteId || clienteId.length > 100) {
    return { resposta: NextResponse.json({ error: 'Escolha o cliente.' }, { status: 400, headers: HEADERS }) };
  }
  await initDB();
  if (!pool) return { resposta: NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: HEADERS }) };
  const exec = pool as unknown as ExecutorSQL;
  if (!(await clienteDaAgencia(exec, tenant, clienteId))) {
    return { resposta: NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404, headers: HEADERS }) };
  }
  return { sessao, tenant, clienteId, exec };
}

export async function GET(req: Request) {
  try {
    const p = await preparar(req, 'ler');
    if ('resposta' in p) return p.resposta;
    return NextResponse.json(comUrl(await estadoDoLink(p.exec, p.tenant, p.clienteId), req), { headers: HEADERS });
  } catch (e) {
    console.error('[portal-links] GET:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível ler o link do portal.' }, { status: 500, headers: HEADERS });
  }
}

export async function POST(req: Request) {
  try {
    const p = await preparar(req, 'escrever');
    if ('resposta' in p) return p.resposta;
    const estado = await emTransacao(exec => criarLink(exec, p.tenant, p.clienteId, p.sessao?.userId ?? null));
    await registrarEventoAuditoria({
      session: p.sessao, tenantId: p.tenant, acao: 'CRIAR', modulo: 'Financeiro', entidade: 'portal_do_cliente',
      entidadeId: p.clienteId, descricao: 'Criou o link do portal do cliente (o anterior, se havia, parou de abrir).',
    }).catch(() => undefined);
    return NextResponse.json(comUrl(estado, req), { status: 201, headers: HEADERS });
  } catch (e) {
    console.error('[portal-links] POST:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível criar o link. Nada mudou; tente de novo.' }, { status: 500, headers: HEADERS });
  }
}

export async function DELETE(req: Request) {
  try {
    const p = await preparar(req, 'escrever');
    if ('resposta' in p) return p.resposta;
    const n = await revogarLink(p.exec, p.tenant, p.clienteId);
    if (n > 0) {
      await registrarEventoAuditoria({
        session: p.sessao, tenantId: p.tenant, acao: 'EXCLUIR', modulo: 'Financeiro', entidade: 'portal_do_cliente',
        entidadeId: p.clienteId, descricao: 'Revogou o link do portal do cliente.',
      }).catch(() => undefined);
    }
    return NextResponse.json(comUrl(await estadoDoLink(p.exec, p.tenant, p.clienteId), req), { headers: HEADERS });
  } catch (e) {
    console.error('[portal-links] DELETE:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível revogar o link. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}
