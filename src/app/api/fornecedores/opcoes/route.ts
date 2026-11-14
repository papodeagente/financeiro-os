import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { contexto } from '@/lib/fornecedor-rota';

// Fornecedores para escolher nas telas do lado do fornecedor (nunca digitar código).
export const dynamic = 'force-dynamic';

export async function GET() {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const { rows } = await pool.query(
    `SELECT id, data FROM fornecedores_crm WHERE tenant_id = $1 AND COALESCE(data->>'status', 'ATIVO') <> 'INATIVO'
      ORDER BY lower(COALESCE(NULLIF(data->>'nome_fantasia', ''), data->>'razao_social', '')), id`,
    [tenantId],
  );
  return NextResponse.json({
    fornecedores: rows.map(r => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return { id: String(r.id), nome: String(d.nome_fantasia || d.razao_social || 'Fornecedor'), tipo: String(d.tipo ?? 'OUTROS') };
    }),
  });
}
