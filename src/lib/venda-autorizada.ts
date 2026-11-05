// Resolve a venda UMA vez, já conferindo se a pessoa pode vê-la (FIN2-04).
//
// A rota principal da venda escondia do vendedor as vendas dos outros, mas as
// sub-rotas (financeiro, tarefas, anotações) e o PUT só olhavam o tenant: um
// vendedor lia a margem e o custo da venda de um colega trocando o id na URL.
import { NextResponse } from 'next/server';
import pool from './db';
import { getSession, type SessionPayload } from './auth';
import { getTenantId } from './tenant';
import { podeVerVenda } from './permissoes';

export interface VendaAutorizada {
  venda: Record<string, unknown>;
  sessao: SessionPayload;
  tenantId: string;
}

/** Devolve a venda autorizada, ou a resposta de recusa (401/404). */
export async function vendaAutorizada(id: string): Promise<VendaAutorizada | NextResponse> {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  const tenantId = await getTenantId();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
  const { rows } = await pool.query(`SELECT data FROM vendas_crm WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const venda = rows[0]?.data as Record<string, unknown> | undefined;
  // Venda de outro vendedor responde igual a venda inexistente.
  if (!venda || !podeVerVenda(sessao, String(venda.vendedor_id ?? ''))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return { venda, sessao, tenantId };
}
