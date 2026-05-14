import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import {
  createQuartoData,
  registrarEvento,
  TIPO_ACOMODACAO_LABEL,
  type QuartoData,
  type TipoAcomodacaoQuarto,
  type PassageiroData,
} from '@/lib/gestao-grupos';

const TIPOS_VALIDOS: TipoAcomodacaoQuarto[] = Object.keys(TIPO_ACOMODACAO_LABEL) as TipoAcomodacaoQuarto[];

// GET /api/gestao-grupos/[grupo_id]/quartos
//
// Lista os quartos do grupo com seus ocupantes (resolvidos via JOIN
// com grupo_passageiros pelo campo data->>quarto_id). Inclui também
// a lista de passageiros SEM quarto (bag) pra UI de alocação.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ quartos: [], sem_quarto: [] });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;

  const [qRes, pRes] = await Promise.all([
    pool.query(
      `SELECT id, numero, tipo_acomodacao, capacidade, data, created_at
         FROM grupo_quartos
        WHERE grupo_id = $1 AND tenant_id = $2
        ORDER BY numero ASC`,
      [grupo_id, tenantId],
    ),
    pool.query(
      `SELECT p.id, p.reserva_id, p.nome_completo, p.data, r.status AS reserva_status
         FROM grupo_passageiros p
         LEFT JOIN grupo_reservas r ON r.id = p.reserva_id AND r.tenant_id = p.tenant_id
        WHERE p.grupo_id = $1 AND p.tenant_id = $2
        ORDER BY p.nome_completo ASC`,
      [grupo_id, tenantId],
    ),
  ]);

  interface PassageiroRow {
    id: string;
    reserva_id: string;
    nome_completo: string;
    data: PassageiroData;
    reserva_status: string;
  }

  const passageiros = (pRes.rows as PassageiroRow[]);

  // Mapa quarto_id → passageiros
  const ocupantesPorQuarto: Record<string, Array<{ id: string; nome_completo: string; tipo: string; reserva_id: string }>> = {};
  const semQuarto: typeof ocupantesPorQuarto[string] = [];
  for (const p of passageiros) {
    // Ignora passageiros de reservas canceladas
    if (p.reserva_status === 'cancelado') continue;
    const qid = p.data?.quarto_id;
    const item = {
      id: p.id,
      nome_completo: p.nome_completo,
      tipo: p.data?.tipo || 'ADT',
      reserva_id: p.reserva_id,
    };
    if (qid) {
      if (!ocupantesPorQuarto[qid]) ocupantesPorQuarto[qid] = [];
      ocupantesPorQuarto[qid].push(item);
    } else {
      semQuarto.push(item);
    }
  }

  const quartos = qRes.rows.map(q => {
    const ocupantes = ocupantesPorQuarto[q.id] || [];
    return {
      id: q.id,
      numero: q.numero,
      tipo_acomodacao: q.tipo_acomodacao as TipoAcomodacaoQuarto,
      capacidade: q.capacidade as number,
      ocupantes,
      ocupacao_atual: ocupantes.length,
      vagas_restantes: Math.max(q.capacidade - ocupantes.length, 0),
      excesso: ocupantes.length > q.capacidade,
      completo: ocupantes.length === q.capacidade,
      ...((q.data || {}) as QuartoData),
      created_at: q.created_at,
    };
  });

  // Stats agregados
  const stats = {
    quartos_total: quartos.length,
    quartos_completos: quartos.filter(q => q.completo).length,
    quartos_disponiveis: quartos.filter(q => !q.bloqueado && q.vagas_restantes > 0).length,
    quartos_bloqueados: quartos.filter(q => q.bloqueado).length,
    quartos_com_excesso: quartos.filter(q => q.excesso).length,
    capacidade_total: quartos.reduce((s, q) => s + q.capacidade, 0),
    ocupacao_total: quartos.reduce((s, q) => s + q.ocupacao_atual, 0),
    passageiros_sem_quarto: semQuarto.length,
  };

  return NextResponse.json({ quartos, sem_quarto: semQuarto, stats });
}

// POST /api/gestao-grupos/[grupo_id]/quartos
// Body: { numero, tipo_acomodacao, capacidade?, hotel_nome?, observacoes? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const body = await req.json();

  const numero = String(body.numero || '').trim();
  if (!numero) return NextResponse.json({ error: 'Número/nome do quarto é obrigatório' }, { status: 400 });

  const tipo: TipoAcomodacaoQuarto = TIPOS_VALIDOS.includes(body.tipo_acomodacao)
    ? body.tipo_acomodacao
    : 'DBL_CASAL';
  const capacidadeDefault = TIPO_ACOMODACAO_LABEL[tipo].capacidadeDefault;
  const capacidade = Math.max(1, Math.floor(Number(body.capacidade) || capacidadeDefault));

  const id = generateId();
  const data: QuartoData = {
    ...createQuartoData(),
    hotel_nome: body.hotel_nome || '',
    observacoes: body.observacoes || '',
  };

  await pool.query(
    `INSERT INTO grupo_quartos (id, grupo_id, numero, tipo_acomodacao, capacidade, data, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [id, grupo_id, numero, tipo, capacidade, JSON.stringify(data), tenantId],
  );

  await registrarEvento(pool, {
    grupo_id, tenant_id: tenantId, tipo: 'quarto_criado',
    descricao: `Quarto ${numero} criado (${TIPO_ACOMODACAO_LABEL[tipo].label}, capacidade ${capacidade})`,
    entidade_id: id, entidade_label: numero,
  });

  return NextResponse.json({ id, grupo_id, numero, tipo_acomodacao: tipo, capacidade, ...data });
}
