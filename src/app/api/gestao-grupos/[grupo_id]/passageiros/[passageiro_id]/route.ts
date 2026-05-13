import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import { createPassageiroData, type PassageiroData, type ReservaData } from '@/lib/gestao-grupos';

// PUT /api/gestao-grupos/[grupo_id]/passageiros/[passageiro_id]
// Atualiza campos do passageiro. Aceita também ids virtuais "legado:RESERVA_ID":
// nesse caso, materializa o passageiro legado em registro real e atualiza.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; passageiro_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, passageiro_id } = await params;
  const body = await req.json();

  // Caso especial: id virtual "legado:RESERVA_ID" — cria passageiro
  // detalhado a partir do nome_passageiro da reserva (migração suave).
  if (passageiro_id.startsWith('legado:')) {
    const reservaId = passageiro_id.replace(/^legado:/, '');
    const { rows: rRows } = await pool.query(
      `SELECT id, data FROM grupo_reservas WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
      [reservaId, grupo_id, tenantId],
    );
    if (rRows.length === 0) return NextResponse.json({ error: 'Reserva legado não encontrada' }, { status: 404 });
    const reservaData = rRows[0].data as ReservaData;
    const nomeLegado = reservaData.nome_passageiro || '';
    const nomeFinal = String(body.nome_completo || nomeLegado).trim();
    if (!nomeFinal) return NextResponse.json({ error: 'Nome completo é obrigatório' }, { status: 400 });

    const newId = generateId();
    const data: PassageiroData = createPassageiroData(nomeFinal, {
      tipo: body.tipo === 'CHD' || body.tipo === 'INF' ? body.tipo : 'ADT',
      data_nascimento: body.data_nascimento || '',
      genero: body.genero || '',
      nacionalidade: body.nacionalidade || '',
      cpf: body.cpf || '',
      rg: body.rg || '',
      rg_orgao_emissor: body.rg_orgao_emissor || '',
      passaporte: body.passaporte || '',
      passaporte_vencimento: body.passaporte_vencimento || reservaData.passaporte_vencimento || '',
      passaporte_pais_emissao: body.passaporte_pais_emissao || '',
      email: body.email || '',
      telefone: body.telefone || '',
      whatsapp: body.whatsapp || '',
      contato_emergencia_nome: body.contato_emergencia_nome || '',
      contato_emergencia_telefone: body.contato_emergencia_telefone || '',
      contato_emergencia_relacao: body.contato_emergencia_relacao || '',
      restricoes_alimentares: body.restricoes_alimentares || '',
      alergias: body.alergias || '',
      necessidades_especiais: body.necessidades_especiais || '',
      medicamentos_continuos: body.medicamentos_continuos || '',
      local_embarque: body.local_embarque || '',
      assento: body.assento || '',
      tipo_acomodacao: body.tipo_acomodacao || reservaData.tipo_acomodacao || '',
      is_responsavel_financeiro: body.is_responsavel_financeiro !== undefined ? !!body.is_responsavel_financeiro : true,
      observacoes_internas: body.observacoes_internas || '',
    });
    await pool.query(
      `INSERT INTO grupo_passageiros (id, grupo_id, reserva_id, nome_completo, data, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [newId, grupo_id, reservaId, nomeFinal, JSON.stringify(data), tenantId],
    );
    return NextResponse.json({ id: newId, grupo_id, reserva_id: reservaId, nome_completo: nomeFinal, ...data, _materializado: true });
  }

  // Edição normal
  const { rows } = await pool.query(
    `SELECT id, reserva_id, nome_completo, data FROM grupo_passageiros
      WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [passageiro_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Passageiro não encontrado' }, { status: 404 });
  const atual = rows[0].data as PassageiroData;
  const nomeFinal = body.nome_completo !== undefined
    ? String(body.nome_completo).trim()
    : rows[0].nome_completo;
  if (!nomeFinal) return NextResponse.json({ error: 'Nome completo é obrigatório' }, { status: 400 });

  // Mescla campos preservando defaults
  const dataNova: PassageiroData = {
    ...atual,
    tipo: body.tipo === 'CHD' || body.tipo === 'INF' || body.tipo === 'ADT' ? body.tipo : atual.tipo,
    data_nascimento: body.data_nascimento ?? atual.data_nascimento,
    genero: body.genero ?? atual.genero,
    nacionalidade: body.nacionalidade ?? atual.nacionalidade,
    cpf: body.cpf ?? atual.cpf,
    rg: body.rg ?? atual.rg,
    rg_orgao_emissor: body.rg_orgao_emissor ?? atual.rg_orgao_emissor,
    passaporte: body.passaporte ?? atual.passaporte,
    passaporte_vencimento: body.passaporte_vencimento ?? atual.passaporte_vencimento,
    passaporte_pais_emissao: body.passaporte_pais_emissao ?? atual.passaporte_pais_emissao,
    email: body.email ?? atual.email,
    telefone: body.telefone ?? atual.telefone,
    whatsapp: body.whatsapp ?? atual.whatsapp,
    contato_emergencia_nome: body.contato_emergencia_nome ?? atual.contato_emergencia_nome,
    contato_emergencia_telefone: body.contato_emergencia_telefone ?? atual.contato_emergencia_telefone,
    contato_emergencia_relacao: body.contato_emergencia_relacao ?? atual.contato_emergencia_relacao,
    restricoes_alimentares: body.restricoes_alimentares ?? atual.restricoes_alimentares,
    alergias: body.alergias ?? atual.alergias,
    necessidades_especiais: body.necessidades_especiais ?? atual.necessidades_especiais,
    medicamentos_continuos: body.medicamentos_continuos ?? atual.medicamentos_continuos,
    local_embarque: body.local_embarque ?? atual.local_embarque,
    assento: body.assento ?? atual.assento,
    tipo_acomodacao: body.tipo_acomodacao ?? atual.tipo_acomodacao,
    is_responsavel_financeiro: body.is_responsavel_financeiro !== undefined ? !!body.is_responsavel_financeiro : atual.is_responsavel_financeiro,
    observacoes_internas: body.observacoes_internas ?? atual.observacoes_internas,
  };

  await pool.query(
    `UPDATE grupo_passageiros SET nome_completo = $1, data = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4`,
    [nomeFinal, JSON.stringify(dataNova), passageiro_id, tenantId],
  );

  return NextResponse.json({ id: passageiro_id, grupo_id, reserva_id: rows[0].reserva_id, nome_completo: nomeFinal, ...dataNova });
}

// DELETE /api/gestao-grupos/[grupo_id]/passageiros/[passageiro_id]
// Remove passageiro permanentemente. NÃO afeta a reserva nem contas
// financeiras já geradas (reserva continua existindo). Para passageiros
// legado (id "legado:...") retorna no-op (não há registro pra apagar).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; passageiro_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, passageiro_id } = await params;

  if (passageiro_id.startsWith('legado:')) {
    return NextResponse.json({ ok: true, _legado: true });
  }

  await pool.query(
    `DELETE FROM grupo_passageiros WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [passageiro_id, grupo_id, tenantId],
  );
  return NextResponse.json({ ok: true });
}
