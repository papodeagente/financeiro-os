import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { QuartoData, PassageiroData } from '@/lib/gestao-grupos';

// POST /api/gestao-grupos/[grupo_id]/quartos/[quarto_id]/alocar
// Body: { passageiro_id }
//
// Aloca um passageiro a este quarto.
// Validações:
//   - quarto não está bloqueado
//   - capacidade atual + 1 <= capacidade total
//   - passageiro pertence ao grupo
//   - se passageiro já estava em outro quarto, a alocação atual sobrescreve
//     (não precisa desalocar antes — o quarto antigo perde o passageiro
//     automaticamente porque o quarto_id é mantido só no passageiro)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; quarto_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, quarto_id } = await params;
  const body = await req.json();

  const passageiroId = String(body.passageiro_id || '');
  if (!passageiroId) return NextResponse.json({ error: 'passageiro_id é obrigatório' }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Carrega quarto
    const { rows: qRows } = await client.query(
      `SELECT id, capacidade, data FROM grupo_quartos
        WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3
        FOR UPDATE`,
      [quarto_id, grupo_id, tenantId],
    );
    if (qRows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Quarto não encontrado' }, { status: 404 });
    }
    const quartoData = qRows[0].data as QuartoData;
    if (quartoData.bloqueado) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Quarto está bloqueado' }, { status: 400 });
    }

    // Carrega passageiro
    const { rows: pRows } = await client.query(
      `SELECT id, data FROM grupo_passageiros
        WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3
        FOR UPDATE`,
      [passageiroId, grupo_id, tenantId],
    );
    if (pRows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Passageiro não encontrado neste grupo' }, { status: 404 });
    }
    const passageiroData = pRows[0].data as PassageiroData;
    if (passageiroData.quarto_id === quarto_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ ok: true, already_allocated: true });
    }

    // Verifica capacidade
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM grupo_passageiros
        WHERE grupo_id = $1 AND tenant_id = $2 AND (data->>'quarto_id') = $3`,
      [grupo_id, tenantId, quarto_id],
    );
    const ocupacaoAtual = countRows[0]?.n || 0;
    if (ocupacaoAtual >= qRows[0].capacidade) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: `Quarto cheio (${ocupacaoAtual}/${qRows[0].capacidade})` }, { status: 400 });
    }

    // Aloca: atualiza passageiro.data.quarto_id
    const dataNova: PassageiroData = { ...passageiroData, quarto_id };
    await client.query(
      `UPDATE grupo_passageiros SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(dataNova), passageiroId, tenantId],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, passageiro_id: passageiroId, quarto_id });
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}

// DELETE /api/gestao-grupos/[grupo_id]/quartos/[quarto_id]/alocar?passageiro_id=X
// Desaloca o passageiro do quarto.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; quarto_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const url = new URL(req.url);
  const passageiroId = url.searchParams.get('passageiro_id') || '';
  if (!passageiroId) return NextResponse.json({ error: 'passageiro_id é obrigatório' }, { status: 400 });

  const { rows } = await pool.query(
    `SELECT data FROM grupo_passageiros WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [passageiroId, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Passageiro não encontrado' }, { status: 404 });

  const dataNova: PassageiroData = { ...(rows[0].data as PassageiroData), quarto_id: '' };
  await pool.query(
    `UPDATE grupo_passageiros SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(dataNova), passageiroId, tenantId],
  );

  return NextResponse.json({ ok: true });
}
