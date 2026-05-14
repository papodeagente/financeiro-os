import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import { createPassageiroData, registrarEvento, type PassageiroData, type ReservaData } from '@/lib/gestao-grupos';

interface PassageiroRow {
  id: string;
  grupo_id: string;
  reserva_id: string;
  nome_completo: string;
  data: PassageiroData;
  created_at: string;
  updated_at: string;
}

// GET /api/gestao-grupos/[grupo_id]/passageiros?reserva_id=&busca=&doc_pendente=1
// Lista todos os passageiros do grupo (de todas as reservas). Quando uma
// reserva tem nome_passageiro legado (campo da reserva) e nenhum
// passageiro detalhado ainda, retorna um placeholder com o id da reserva
// como id virtual + flag `_legado: true` — permite UI mostrar tudo unificado.
export async function GET(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json([]);
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const url = new URL(req.url);
  const reservaId = url.searchParams.get('reserva_id') || '';
  const busca = (url.searchParams.get('busca') || '').toLowerCase().trim();
  const docPendente = url.searchParams.get('doc_pendente') === '1';

  // 1. Passageiros cadastrados
  const wheres = ['p.grupo_id = $1', 'p.tenant_id = $2'];
  const params_: unknown[] = [grupo_id, tenantId];
  if (reservaId) { params_.push(reservaId); wheres.push(`p.reserva_id = $${params_.length}`); }

  const { rows } = await pool.query(
    `SELECT p.id, p.grupo_id, p.reserva_id, p.nome_completo, p.data,
            p.created_at, p.updated_at,
            r.cliente_id, r.status AS reserva_status, r.data AS reserva_data
       FROM grupo_passageiros p
       LEFT JOIN grupo_reservas r
         ON r.id = p.reserva_id AND r.tenant_id = p.tenant_id
      WHERE ${wheres.join(' AND ')}
      ORDER BY p.created_at DESC`,
    params_,
  );

  type Result = {
    id: string;
    grupo_id: string;
    reserva_id: string;
    nome_completo: string;
    reserva_status?: string;
    reserva_label?: string;
    _legado?: boolean;
    created_at?: string;
    updated_at?: string;
  } & Partial<PassageiroData>;

  let resultado: Result[] = (rows as Array<PassageiroRow & { reserva_status?: string; reserva_data?: ReservaData }>)
    .map(r => ({
      id: r.id,
      grupo_id: r.grupo_id,
      reserva_id: r.reserva_id,
      nome_completo: r.nome_completo,
      reserva_status: r.reserva_status,
      reserva_label: r.reserva_data?.tipo_acomodacao ? `Apto ${r.reserva_data.tipo_acomodacao}` : '',
      ...(r.data || {}),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

  // 2. Reservas legado — quando reserva tem nome_passageiro mas nenhum
  //    grupo_passageiros vinculado. Adiciona placeholder pra UI mostrar.
  if (!reservaId) {
    const idsComPax = new Set(resultado.map(p => p.reserva_id));
    const { rows: legadoRows } = await pool.query(
      `SELECT id, data, status FROM grupo_reservas
        WHERE grupo_id = $1 AND tenant_id = $2 AND status != 'cancelado'`,
      [grupo_id, tenantId],
    );
    for (const r of legadoRows as Array<{ id: string; data: ReservaData; status: string }>) {
      if (idsComPax.has(r.id)) continue;
      if (!r.data?.nome_passageiro) continue;
      resultado.push({
        id: `legado:${r.id}`,
        grupo_id,
        reserva_id: r.id,
        nome_completo: r.data.nome_passageiro,
        reserva_status: r.status,
        reserva_label: r.data.tipo_acomodacao ? `Apto ${r.data.tipo_acomodacao}` : '',
        _legado: true,
        tipo: 'ADT',
      });
    }
  }

  // Filtros opcionais
  if (busca) {
    resultado = resultado.filter(p => {
      const hay = [
        p.nome_completo, p.cpf, p.passaporte, p.email, p.telefone, p.whatsapp,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(busca);
    });
  }
  if (docPendente) {
    resultado = resultado.filter(p => !p.cpf && !p.passaporte);
  }

  return NextResponse.json(resultado);
}

// POST /api/gestao-grupos/[grupo_id]/passageiros
// Body: { reserva_id, nome_completo, ...campos de PassageiroData }
// Cria passageiro novo vinculado a uma reserva existente do grupo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const body = await req.json();

  const reservaId = String(body.reserva_id || '');
  const nomeCompleto = String(body.nome_completo || '').trim();
  if (!reservaId) return NextResponse.json({ error: 'reserva_id é obrigatório' }, { status: 400 });
  if (!nomeCompleto) return NextResponse.json({ error: 'Nome completo é obrigatório' }, { status: 400 });

  // Verifica que a reserva existe e pertence ao grupo
  const { rows: rRows } = await pool.query(
    `SELECT id FROM grupo_reservas WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [reservaId, grupo_id, tenantId],
  );
  if (rRows.length === 0) {
    return NextResponse.json({ error: 'Reserva não encontrada neste grupo' }, { status: 400 });
  }

  const id = generateId();
  const dataJson: PassageiroData = createPassageiroData(nomeCompleto, {
    tipo: body.tipo === 'CHD' || body.tipo === 'INF' ? body.tipo : 'ADT',
    data_nascimento: body.data_nascimento || '',
    genero: body.genero || '',
    nacionalidade: body.nacionalidade || '',
    cpf: body.cpf || '',
    rg: body.rg || '',
    rg_orgao_emissor: body.rg_orgao_emissor || '',
    passaporte: body.passaporte || '',
    passaporte_vencimento: body.passaporte_vencimento || '',
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
    tipo_acomodacao: body.tipo_acomodacao || '',
    is_responsavel_financeiro: !!body.is_responsavel_financeiro,
    observacoes_internas: body.observacoes_internas || '',
  });

  await pool.query(
    `INSERT INTO grupo_passageiros (id, grupo_id, reserva_id, nome_completo, data, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [id, grupo_id, reservaId, nomeCompleto, JSON.stringify(dataJson), tenantId],
  );

  await registrarEvento(pool, {
    grupo_id, tenant_id: tenantId, tipo: 'passageiro_adicionado',
    descricao: `Passageiro adicionado: ${nomeCompleto} (${dataJson.tipo})`,
    passageiro_id: id, reserva_id: reservaId,
    entidade_id: id, entidade_label: nomeCompleto,
  });

  return NextResponse.json({ id, grupo_id, reserva_id: reservaId, nome_completo: nomeCompleto, ...dataJson });
}
