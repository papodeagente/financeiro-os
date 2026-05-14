import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { ContaPagar } from '@/lib/crm-types';
import { registrarEvento } from '@/lib/gestao-grupos';

// POST /api/gestao-grupos/[grupo_id]/financeiro/vincular-despesa
// Body: { conta_pagar_id: string }
//
// Vincula uma conta_pagar existente ao grupo (preenche o campo grupo_id
// na coluna escalar + dentro do JSONB data). NÃO cria conta paralela —
// reutiliza a estrutura financeira oficial.
//
// Idempotente: se a conta já está vinculada a OUTRO grupo, retorna erro
// pedindo desvínculo explícito. Se já está vinculada a ESTE grupo, no-op.
export async function POST(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const body = await req.json();

  const contaId = String(body.conta_pagar_id || '');
  if (!contaId) return NextResponse.json({ error: 'conta_pagar_id é obrigatório' }, { status: 400 });

  // Verifica que o grupo existe
  const { rows: gRows } = await pool.query(
    `SELECT id FROM grupos WHERE id = $1 AND tenant_id = $2`,
    [grupo_id, tenantId],
  );
  if (gRows.length === 0) return NextResponse.json({ error: 'Grupo não encontrado' }, { status: 404 });

  // Carrega a conta
  const { rows: cRows } = await pool.query(
    `SELECT id, grupo_id, data FROM contas_pagar WHERE id = $1 AND tenant_id = $2`,
    [contaId, tenantId],
  );
  if (cRows.length === 0) return NextResponse.json({ error: 'Conta a pagar não encontrada' }, { status: 404 });

  const atual = cRows[0];
  if (atual.grupo_id && atual.grupo_id !== grupo_id) {
    return NextResponse.json(
      { error: `Conta já está vinculada a outro grupo (${atual.grupo_id}). Desvincule primeiro.` },
      { status: 409 },
    );
  }
  if (atual.grupo_id === grupo_id) {
    return NextResponse.json({ ok: true, already_linked: true });
  }

  const data = atual.data as ContaPagar;
  const dataNova: ContaPagar = { ...data, grupo_id, origem: data.origem === 'OUTROS' ? 'GRUPO' : data.origem };

  await pool.query(
    `UPDATE contas_pagar SET grupo_id = $1, data = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
    [grupo_id, JSON.stringify(dataNova), contaId, tenantId],
  );

  await registrarEvento(pool, {
    grupo_id, tenant_id: tenantId, tipo: 'despesa_vinculada',
    descricao: `Despesa vinculada: ${dataNova.descricao || '(sem descrição)'} — ${(dataNova.valor_final || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    entidade_id: contaId, entidade_label: dataNova.descricao,
    dados_novos: { fornecedor_nome: dataNova.fornecedor_nome, valor_final: dataNova.valor_final },
  });

  return NextResponse.json({ ok: true, conta_pagar_id: contaId, grupo_id });
}

// DELETE /api/gestao-grupos/[grupo_id]/financeiro/vincular-despesa?conta_pagar_id=X
// Desvincula uma conta_pagar do grupo (limpa grupo_id). A conta continua
// existindo no financeiro, apenas perde a associação com este grupo.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const url = new URL(req.url);
  const contaId = url.searchParams.get('conta_pagar_id') || '';
  if (!contaId) return NextResponse.json({ error: 'conta_pagar_id é obrigatório' }, { status: 400 });

  const { rows } = await pool.query(
    `SELECT data FROM contas_pagar WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [contaId, grupo_id, tenantId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Conta não vinculada a este grupo' }, { status: 404 });
  }
  const data = rows[0].data as ContaPagar;
  const dataNova: ContaPagar = { ...data, grupo_id: null };

  await pool.query(
    `UPDATE contas_pagar SET grupo_id = '', data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(dataNova), contaId, tenantId],
  );

  await registrarEvento(pool, {
    grupo_id, tenant_id: tenantId, tipo: 'despesa_desvinculada',
    descricao: `Despesa desvinculada: ${dataNova.descricao || '(sem descrição)'}`,
    entidade_id: contaId, entidade_label: dataNova.descricao,
  });

  return NextResponse.json({ ok: true });
}
