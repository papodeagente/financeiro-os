import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { reabrirPeriodo } from '@/lib/periodo-fechado';
import { registrarEventoAuditoria } from '@/lib/audit';

// Reabre o caixa (05/11/2026): só administrador, motivo obrigatório,
// registrado no histórico de fechamentos e na auditoria.
//   POST { conta_bancaria_id?: string, ate: 'AAAA-MM-DD' | null, motivo }
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => ({}))) as { conta_bancaria_id?: string; ate?: string | null; motivo?: string };
  const tenantId = await getTenantId();
  const sessao = await getSession();
  try {
    await emTransacao(exec => reabrirPeriodo(exec, {
      tenantId, contaId: corpo.conta_bancaria_id || '', ate: corpo.ate || null, motivo: corpo.motivo ?? '',
      usuarioId: sessao?.userId, usuarioNome: sessao?.nome,
    }));
    await registrarEventoAuditoria({
      acao: 'EDITAR', modulo: 'financeiro', entidade: 'periodos_fechados',
      descricao: `Caixa reaberto${corpo.ate ? ` até ${corpo.ate}` : ' por completo'}${corpo.conta_bancaria_id ? ` na conta ${corpo.conta_bancaria_id}` : ''}: ${corpo.motivo ?? ''}`,
    }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 400 });
  }
}
