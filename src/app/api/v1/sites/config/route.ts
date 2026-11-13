import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { configSites, salvarConfigSites } from '@/lib/sites-integration';
import { registrarEventoAuditoria } from '@/lib/audit';
import { cofreDisponivel, ErroCofre } from '@/lib/cofre';

export async function GET(req: NextRequest) {
  const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
  if (bloqueio) return NextResponse.json({ erro: bloqueio.erro }, { status: bloqueio.status });
  try {
    const tenantId = await getTenantId();
    const cfg = await configSites(tenantId);
    const origem = (process.env.PUBLIC_APP_URL || process.env.COOLIFY_URL || new URL(req.url).origin).replace(/\/$/, '');
    return NextResponse.json({
      ativo: cfg?.ativo ?? false,
      companyId: cfg?.company_id ?? null,
      temSegredo: Boolean(cfg?.segredo),
      cofreDisponivel: cofreDisponivel(),
      webhookUrl: `${origem}/api/v1/sites/webhook/${encodeURIComponent(tenantId)}`,
    });
  } catch { return NextResponse.json({ erro: 'Falha ao carregar integração' }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
  if (bloqueio) return NextResponse.json({ erro: bloqueio.erro }, { status: bloqueio.status });
  try {
    const tenantId = await getTenantId();
    const body = await req.json() as { companyId?: unknown; segredo?: unknown; ativo?: unknown };
    const companyId = Number(body.companyId);
    const segredo = typeof body.segredo === 'string' ? body.segredo : undefined;
    await salvarConfigSites(tenantId, companyId, segredo, body.ativo !== false);
    await registrarEventoAuditoria({
      tenantId, acao: 'EDITAR', modulo: 'Integrações', entidade: 'sites_config', entidadeId: tenantId,
      descricao: `Atualizou a integração do Sites para a empresa ${companyId}.`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    const invalido = /inválido|Informe/.test(msg);
    return NextResponse.json({ erro: invalido || e instanceof ErroCofre ? msg : 'Falha ao salvar integração' }, { status: invalido ? 400 : 500 });
  }
}
