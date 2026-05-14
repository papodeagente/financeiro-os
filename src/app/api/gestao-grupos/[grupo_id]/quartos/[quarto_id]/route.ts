import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import {
  TIPO_ACOMODACAO_LABEL,
  type QuartoData,
  type TipoAcomodacaoQuarto,
  type PassageiroData,
} from '@/lib/gestao-grupos';

const TIPOS_VALIDOS: TipoAcomodacaoQuarto[] = Object.keys(TIPO_ACOMODACAO_LABEL) as TipoAcomodacaoQuarto[];

// PUT /api/gestao-grupos/[grupo_id]/quartos/[quarto_id]
// Atualiza dados do quarto: número, tipo, capacidade, bloqueio, observações.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; quarto_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, quarto_id } = await params;
  const body = await req.json();

  const { rows } = await pool.query(
    `SELECT id, numero, tipo_acomodacao, capacidade, data
       FROM grupo_quartos WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [quarto_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Quarto não encontrado' }, { status: 404 });
  const atual = rows[0];
  const dataAtual = atual.data as QuartoData;

  const numero = body.numero !== undefined ? String(body.numero).trim() : atual.numero;
  if (!numero) return NextResponse.json({ error: 'Número/nome do quarto é obrigatório' }, { status: 400 });

  const tipoNovo: TipoAcomodacaoQuarto = TIPOS_VALIDOS.includes(body.tipo_acomodacao)
    ? body.tipo_acomodacao
    : atual.tipo_acomodacao;

  const capacidadeNova = body.capacidade !== undefined
    ? Math.max(1, Math.floor(Number(body.capacidade) || atual.capacidade))
    : atual.capacidade;

  // Bloqueio com motivo
  const bloqueado = body.bloqueado !== undefined ? !!body.bloqueado : dataAtual.bloqueado;
  const motivoBloqueio = body.motivo_bloqueio !== undefined ? String(body.motivo_bloqueio) : (dataAtual.motivo_bloqueio || '');
  if (bloqueado && !motivoBloqueio.trim()) {
    return NextResponse.json({ error: 'Motivo é obrigatório ao bloquear quarto' }, { status: 400 });
  }

  const dataNova: QuartoData = {
    ...dataAtual,
    hotel_nome: body.hotel_nome !== undefined ? body.hotel_nome : dataAtual.hotel_nome,
    bloqueado,
    motivo_bloqueio: bloqueado ? motivoBloqueio : '',
    observacoes: body.observacoes !== undefined ? body.observacoes : dataAtual.observacoes,
  };

  await pool.query(
    `UPDATE grupo_quartos SET numero = $1, tipo_acomodacao = $2, capacidade = $3, data = $4, updated_at = NOW()
      WHERE id = $5 AND tenant_id = $6`,
    [numero, tipoNovo, capacidadeNova, JSON.stringify(dataNova), quarto_id, tenantId],
  );

  return NextResponse.json({ id: quarto_id, grupo_id, numero, tipo_acomodacao: tipoNovo, capacidade: capacidadeNova, ...dataNova });
}

// DELETE /api/gestao-grupos/[grupo_id]/quartos/[quarto_id]
// Remove o quarto. Desocupa todos os passageiros que estavam alocados.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; quarto_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, quarto_id } = await params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Desaloca passageiros (limpa quarto_id no JSONB)
    const { rows: paxRows } = await client.query(
      `SELECT id, data FROM grupo_passageiros
        WHERE grupo_id = $1 AND tenant_id = $2 AND (data->>'quarto_id') = $3`,
      [grupo_id, tenantId, quarto_id],
    );
    for (const p of paxRows) {
      const d = { ...(p.data as PassageiroData), quarto_id: '' };
      await client.query(
        `UPDATE grupo_passageiros SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
        [JSON.stringify(d), p.id, tenantId],
      );
    }

    await client.query(
      `DELETE FROM grupo_quartos WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
      [quarto_id, grupo_id, tenantId],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, passageiros_desalocados: paxRows.length });
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
