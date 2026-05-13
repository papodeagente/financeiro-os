import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import {
  recalcularVagasPeriodo,
  calcReservaFinanceiro,
  type ReservaData,
  type ReservaStatus,
  type PeriodoVagasData,
  type GestaoGrupoData,
  type ContaReceberMinima,
} from '@/lib/gestao-grupos';

// GET /api/gestao-grupos/[grupo_id]/reservas
// Query params: periodo_id, status, busca (nome do passageiro)
// Faz LEFT JOIN com clientes pra pegar nome do cliente.
export async function GET(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json([]);
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const url = new URL(req.url);
  const periodoId = url.searchParams.get('periodo_id') || '';
  const status = url.searchParams.get('status') || '';
  const busca = (url.searchParams.get('busca') || '').toLowerCase().trim();

  const wheres: string[] = ['r.grupo_id = $1', 'r.tenant_id = $2'];
  const params_: unknown[] = [grupo_id, tenantId];
  if (periodoId) { params_.push(periodoId); wheres.push(`r.periodo_id = $${params_.length}`); }
  if (status) { params_.push(status); wheres.push(`r.status = $${params_.length}`); }

  const { rows } = await pool.query(
    `SELECT
       r.id, r.periodo_id, r.cliente_id, r.status, r.data, r.created_at, r.updated_at,
       c.data AS cliente_data,
       pv.data AS periodo_data
     FROM grupo_reservas r
     LEFT JOIN clientes c ON c.id = r.cliente_id AND c.tenant_id = r.tenant_id
     LEFT JOIN grupo_periodos_vagas pv ON pv.id = r.periodo_id AND pv.tenant_id = r.tenant_id
     WHERE ${wheres.join(' AND ')}
     ORDER BY r.created_at DESC`,
    params_,
  );

  // Carrega TODAS as contas_receber das vendas vinculadas às reservas
  // confirmadas, em uma única query agrupada — evita N+1.
  const vendaIds = (rows as Array<{ data: ReservaData; status: string }>)
    .map(r => (r.status === 'confirmado' && r.data?.venda_id) ? r.data.venda_id : null)
    .filter((v): v is string => !!v);

  const contasPorVenda: Record<string, ContaReceberMinima[]> = {};
  if (vendaIds.length > 0) {
    const { rows: crRows } = await pool.query(
      `SELECT venda_id, data FROM contas_receber
        WHERE tenant_id = $1 AND venda_id = ANY($2::text[])`,
      [tenantId, vendaIds],
    );
    for (const cr of crRows) {
      const vId = cr.venda_id as string;
      if (!contasPorVenda[vId]) contasPorVenda[vId] = [];
      contasPorVenda[vId].push({ data: cr.data });
    }
  }

  type Cliente = { nome_completo?: string; nome_fantasia?: string; razao_social?: string; nome?: string; tipo?: string };
  const reservas = rows
    .map(r => {
      const c = (r.cliente_data || {}) as Cliente;
      const clienteNome = c.tipo === 'PJ'
        ? (c.nome_fantasia || c.razao_social || '')
        : (c.nome_completo || c.nome || '');
      const periodo = (r.periodo_data || {}) as PeriodoVagasData;
      const reservaData = r.data as ReservaData;
      const vendaId = reservaData.venda_id || '';
      const contas = vendaId ? (contasPorVenda[vendaId] || []) : [];
      const financeiro = calcReservaFinanceiro(contas, r.status);
      return {
        id: r.id,
        grupo_id,
        periodo_id: r.periodo_id,
        periodo_label: periodo.label || '',
        cliente_id: r.cliente_id,
        cliente_nome: clienteNome,
        status: r.status as ReservaStatus,
        ...reservaData,
        financeiro,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    })
    .filter(r => !busca || (r.nome_passageiro || '').toLowerCase().includes(busca) || r.cliente_nome.toLowerCase().includes(busca));

  return NextResponse.json(reservas);
}

// POST /api/gestao-grupos/[grupo_id]/reservas
// Body: { periodo_id, cliente_id, nome_passageiro, tipo_acomodacao,
//         valor_cobrado, parcelas, observacoes, documentos_ok,
//         passaporte_vencimento, status? }
// Validações: vagas_disponiveis > 0 OU lista_espera permitida + cliente existe.
export async function POST(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const body = await req.json();

  const periodoId = String(body.periodo_id || '');
  const clienteId = String(body.cliente_id || '');
  if (!periodoId || !clienteId) {
    return NextResponse.json({ error: 'periodo_id e cliente_id são obrigatórios' }, { status: 400 });
  }

  // Verifica cliente
  const { rows: cli } = await pool.query(`SELECT id FROM clientes WHERE id = $1 AND tenant_id = $2`, [clienteId, tenantId]);
  if (cli.length === 0) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 400 });

  // Verifica período + vagas disponíveis
  const { rows: pRows } = await pool.query(
    `SELECT id, data FROM grupo_periodos_vagas WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [periodoId, grupo_id, tenantId],
  );
  if (pRows.length === 0) return NextResponse.json({ error: 'Período não encontrado' }, { status: 400 });
  const periodoData = pRows[0].data as PeriodoVagasData;

  // Consulta config pra saber se lista de espera é permitida
  const { rows: gRows } = await pool.query(
    `SELECT data FROM gestao_grupos WHERE grupo_id = $1 AND tenant_id = $2 LIMIT 1`,
    [grupo_id, tenantId],
  );
  const config = (gRows[0]?.data as GestaoGrupoData | undefined)?.config_vagas;
  const permiteListaEspera = !!config?.permitir_lista_espera;

  let statusFinal: ReservaStatus;
  if ((body.status as string) === 'lista_espera') {
    if (!permiteListaEspera) return NextResponse.json({ error: 'Lista de espera não está habilitada para este grupo' }, { status: 400 });
    statusFinal = 'lista_espera';
  } else if (periodoData.vagas_disponiveis <= 0) {
    if (permiteListaEspera) {
      statusFinal = 'lista_espera'; // sem vaga + lista habilitada → vai pra lista
    } else {
      return NextResponse.json({ error: 'Não há vagas disponíveis neste período' }, { status: 400 });
    }
  } else {
    statusFinal = (body.status as ReservaStatus) || 'reservado';
  }

  const reservaId = generateId();
  const data: ReservaData = {
    nome_passageiro: String(body.nome_passageiro || ''),
    tipo_acomodacao: String(body.tipo_acomodacao || 'DBL').toUpperCase(),
    valor_cobrado: Number(body.valor_cobrado) || 0,
    parcelas: Math.max(1, Math.floor(Number(body.parcelas) || 1)),
    observacoes: String(body.observacoes || ''),
    documentos_ok: !!body.documentos_ok,
    passaporte_vencimento: String(body.passaporte_vencimento || ''),
    venda_id: null,
  };

  await pool.query(
    `INSERT INTO grupo_reservas (id, grupo_id, periodo_id, cliente_id, status, data, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [reservaId, grupo_id, periodoId, clienteId, statusFinal, JSON.stringify(data), tenantId],
  );

  const periodoAtualizado = await recalcularVagasPeriodo(pool, periodoId, tenantId);

  return NextResponse.json({
    id: reservaId,
    grupo_id,
    periodo_id: periodoId,
    cliente_id: clienteId,
    status: statusFinal,
    ...data,
    periodo: periodoAtualizado,
  });
}
