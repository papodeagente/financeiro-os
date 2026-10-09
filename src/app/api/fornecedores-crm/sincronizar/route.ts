import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { integracaoCrmAtiva, sincronizarTodosOsFornecedores } from '@/lib/crm-integration';

/**
 * Acerto completo dos fornecedores com o CRM: manda todos os daqui e pede os
 * de lá. Responde na hora com quantos vão; o envio segue em segundo plano,
 * porque cada fornecedor é um aviso.
 */
export async function POST() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
    const tenantId = await getTenantId();
    if (!(await integracaoCrmAtiva(tenantId))) {
      return NextResponse.json({ error: 'A integração com o CRM está desligada. Ligue em Configurações, CRM Entur.' }, { status: 409 });
    }
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM fornecedores_crm WHERE tenant_id = $1`,
      [tenantId],
    );
    void sincronizarTodosOsFornecedores(tenantId, { pedirOsDoCrm: true });
    return NextResponse.json({ enviados: rows[0]?.n ?? 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
