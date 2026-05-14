// Gestão de grupos — helpers compartilhados entre o trigger automático
// (POST /api/grupos) e as rotas /api/gestao-grupos/*.
//
// Estrutura da feature:
//   - gestao_grupos: 1 registro por grupo (config + status)
//   - grupo_periodos_vagas: N registros por grupo (1 por período da viagem)
//   - grupo_reservas: passageiros com vaga reservada/confirmada
//   - grupo_materiais: arquivos, links, documentos do grupo
//
// Contadores de vagas são CALCULADOS a partir das reservas — nunca editados
// manualmente. Use recalcularVagasPeriodo() após qualquer mudança de reserva.

import type { Pool } from 'pg';
import { generateId } from './utils';
import type { GrupoViagem } from './types';

export interface ConfigVagas {
  controle_por_periodo: boolean;
  permitir_lista_espera: boolean;
  alerta_vagas_restantes: number;
}

export type KanbanStage = 'novo' | 'formalizacao' | 'vendas' | 'fechado' | 'embarque' | 'finalizado';

export const KANBAN_STAGES: Array<{ key: KanbanStage; label: string; color: string; fill: string }> = [
  { key: 'novo',         label: 'Novo Grupo',    color: '#64748B', fill: '#F1F5F9' },
  { key: 'formalizacao', label: 'Formalização',  color: '#F59E0B', fill: '#FFFBEB' },
  { key: 'vendas',       label: 'Vendas',        color: '#2563EB', fill: '#EFF6FF' },
  { key: 'fechado',      label: 'Fechado',       color: '#10B981', fill: '#ECFDF5' },
  { key: 'embarque',     label: 'Embarque',      color: '#6366F1', fill: '#EEF2FF' },
  { key: 'finalizado',   label: 'Finalizado',    color: '#475569', fill: '#E2E8F0' },
];

export interface GestaoGrupoData {
  observacoes: string;
  config_vagas: ConfigVagas;
  kanban_stage?: KanbanStage;
}

export interface PeriodoVagasData {
  label: string;
  data_inicio: string | null;
  data_fim: string | null;
  destino?: string;
  vagas_total: number;
  vagas_reservadas: number;
  vagas_confirmadas: number;
  vagas_disponiveis: number;
}

export interface ReservaData {
  nome_passageiro: string;
  tipo_acomodacao: string; // DBL/SGL/TPL/QDP
  valor_cobrado: number;
  parcelas: number;
  observacoes: string;
  documentos_ok: boolean;
  passaporte_vencimento: string;
  venda_id: string | null;
  motivo_cancelamento?: string;
}

export type ReservaStatus = 'reservado' | 'confirmado' | 'cancelado' | 'lista_espera';

export interface MaterialData {
  url: string;
  tamanho_bytes: number | null;
  extensao: string | null;
  descricao: string;
  visivel_para_passageiro: boolean;
  enviado_para: string[];
}

export type MaterialTipo = 'arquivo' | 'link' | 'roteiro' | 'contrato' | 'voucher' | 'outro';

// ============================================================
// PASSAGEIROS (Fase B)
// ============================================================
// Entidade dedicada por reserva. Cada reserva pode ter N passageiros.
// O responsável financeiro continua sendo o cliente da reserva (campo
// cliente_id em grupo_reservas). Os passageiros são as pessoas que
// efetivamente viajam — podem ser diferentes do contratante (ex: pai
// compra para a família inteira).

export type PassageiroTipo = 'ADT' | 'CHD' | 'INF';
export type PassageiroGenero = 'M' | 'F' | 'OUTRO' | '';

export interface PassageiroData {
  // ---- Identificação básica
  data_nascimento: string;           // YYYY-MM-DD
  tipo: PassageiroTipo;              // ADT/CHD/INF (segue convenção VendaCRM)
  genero?: PassageiroGenero;
  nacionalidade?: string;

  // ---- Documentos
  cpf?: string;
  rg?: string;
  rg_orgao_emissor?: string;
  passaporte?: string;
  passaporte_vencimento?: string;
  passaporte_pais_emissao?: string;

  // ---- Contato
  email?: string;
  telefone?: string;
  whatsapp?: string;

  // ---- Emergência
  contato_emergencia_nome?: string;
  contato_emergencia_telefone?: string;
  contato_emergencia_relacao?: string;

  // ---- Saúde
  restricoes_alimentares?: string;
  alergias?: string;
  necessidades_especiais?: string;
  medicamentos_continuos?: string;

  // ---- Operação
  local_embarque?: string;
  assento?: string;
  tipo_acomodacao?: string;          // SGL/DBL/TPL/QDP
  quarto_id?: string;                // FK pra grupo_quartos (Fase E)

  // ---- Flags
  is_responsavel_financeiro?: boolean;  // marca o passageiro que também é contratante

  observacoes_internas?: string;
}

// ============================================================
// STATUS FINANCEIRO DERIVADO (Fase C)
// ============================================================
// Calcula o status financeiro de uma reserva a partir das contas_receber
// vinculadas à venda confirmada. Não é persistido — sempre computado on
// the fly. Espelha a saúde real do pagamento sem duplicar fonte de verdade.

export type StatusFinanceiroReserva = 'pago' | 'parcial' | 'pendente' | 'vencida' | 'n/a';

export interface ContaReceberMinima {
  data: {
    valor_final?: number;
    data_vencimento?: string;     // YYYY-MM-DD
    data_recebimento?: string | null;
    valor_recebido?: number | null;
    status?: string;              // 'PENDENTE' | 'RECEBIDO' | 'ATRASADO' | 'CANCELADO' | 'PARCIAL'
    parcela_numero?: number;
    total_parcelas?: number;
  };
}

export interface FinanceiroReserva {
  status: StatusFinanceiroReserva;
  total_previsto: number;
  total_recebido: number;
  total_vencido: number;
  total_pendente: number;
  qtd_parcelas: number;
  qtd_pagas: number;
  qtd_vencidas: number;
  proxima_parcela: { data_vencimento: string; valor_final: number; parcela_numero: number } | null;
}

export function calcReservaFinanceiro(
  contas: ContaReceberMinima[],
  reservaStatus: string,
): FinanceiroReserva {
  // Reserva ainda não confirmada: sem cobrança gerada — n/a
  if (reservaStatus !== 'confirmado' || contas.length === 0) {
    return {
      status: 'n/a',
      total_previsto: 0,
      total_recebido: 0,
      total_vencido: 0,
      total_pendente: 0,
      qtd_parcelas: contas.length,
      qtd_pagas: 0,
      qtd_vencidas: 0,
      proxima_parcela: null,
    };
  }

  const hoje = new Date().toISOString().split('T')[0];
  let totalPrev = 0;
  let totalReceb = 0;
  let totalVenc = 0;
  let totalPend = 0;
  let qtdPagas = 0;
  let qtdVencidas = 0;

  // Próxima parcela: a mais antiga ainda não paga
  let proxima: FinanceiroReserva['proxima_parcela'] = null;

  for (const c of contas) {
    const d = c.data;
    if (d.status === 'CANCELADO') continue;
    const valor = d.valor_final || 0;
    totalPrev += valor;

    const isPago = d.status === 'RECEBIDO' || (d.valor_recebido && d.valor_recebido >= valor);
    if (isPago) {
      qtdPagas++;
      totalReceb += d.valor_recebido || valor;
    } else {
      const venc = d.data_vencimento || '';
      const vencida = venc && venc < hoje;
      if (vencida) {
        qtdVencidas++;
        totalVenc += valor;
      } else {
        totalPend += valor;
      }
      // Mantém a mais antiga não-paga como próxima
      if (!proxima || (venc && (!proxima.data_vencimento || venc < proxima.data_vencimento))) {
        proxima = {
          data_vencimento: venc,
          valor_final: valor,
          parcela_numero: d.parcela_numero || 0,
        };
      }
    }
  }

  // Resolve status agregado
  let status: StatusFinanceiroReserva;
  if (qtdPagas === contas.length) status = 'pago';
  else if (qtdVencidas > 0) status = 'vencida';
  else if (qtdPagas > 0) status = 'parcial';
  else status = 'pendente';

  return {
    status,
    total_previsto: totalPrev,
    total_recebido: totalReceb,
    total_vencido: totalVenc,
    total_pendente: totalPend,
    qtd_parcelas: contas.length,
    qtd_pagas: qtdPagas,
    qtd_vencidas: qtdVencidas,
    proxima_parcela: proxima,
  };
}

export function createPassageiroData(nome: string, opts?: Partial<PassageiroData>): PassageiroData {
  return {
    data_nascimento: '',
    tipo: 'ADT',
    genero: '',
    cpf: '',
    rg: '',
    passaporte: '',
    passaporte_vencimento: '',
    email: '',
    telefone: '',
    whatsapp: '',
    contato_emergencia_nome: '',
    contato_emergencia_telefone: '',
    contato_emergencia_relacao: '',
    restricoes_alimentares: '',
    alergias: '',
    necessidades_especiais: '',
    medicamentos_continuos: '',
    local_embarque: '',
    assento: '',
    tipo_acomodacao: '',
    observacoes_internas: '',
    is_responsavel_financeiro: false,
    ...opts,
  };
}

const DEFAULT_CONFIG: ConfigVagas = {
  controle_por_periodo: true,
  permitir_lista_espera: false,
  alerta_vagas_restantes: 5,
};

function fmtData(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function labelPeriodo(i: number, p: { check_in: string | null; check_out: string | null; destino?: string }): string {
  const partes: string[] = [`Saída ${i + 1}`];
  if (p.check_in) partes.push(fmtData(p.check_in));
  if (p.destino) partes.push(`— ${p.destino}`);
  return partes.join(' ').replace(' — ', ' · ');
}

// Cria gestao_grupos + grupo_periodos_vagas (1 por período) se ainda não
// existirem. Idempotente: pode ser chamada N vezes pro mesmo grupo. Quando
// novos períodos são adicionados ao grupo depois, esta função cria apenas
// os faltantes (sem zerar os já existentes).
export async function ensureGestaoGrupo(
  pool: Pool,
  grupo: GrupoViagem,
  tenantId: string,
): Promise<void> {
  // 1. Cria/garante registro de gestao_grupos
  const existsRes = await pool.query(
    `SELECT id FROM gestao_grupos WHERE grupo_id = $1 AND tenant_id = $2 LIMIT 1`,
    [grupo.id, tenantId],
  );
  if (existsRes.rows.length === 0) {
    const data: GestaoGrupoData = { observacoes: '', config_vagas: { ...DEFAULT_CONFIG }, kanban_stage: 'novo' };
    await pool.query(
      `INSERT INTO gestao_grupos (id, grupo_id, status, data, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'ativo', $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [generateId(), grupo.id, JSON.stringify(data), tenantId],
    );
  }

  // 2. Sincroniza períodos. Se grupo não tem períodos, cria 1 placeholder.
  const periodos = grupo.periodos && grupo.periodos.length > 0
    ? grupo.periodos
    : [{ check_in: null, check_out: null, destino: '', hotel: '' }];

  const vagasTotal = grupo.params?.qtd_max_pax ?? 0;

  const { rows: existentes } = await pool.query(
    `SELECT periodo_index FROM grupo_periodos_vagas WHERE grupo_id = $1 AND tenant_id = $2`,
    [grupo.id, tenantId],
  );
  const indicesExistentes = new Set(existentes.map(r => r.periodo_index as number));

  for (let i = 0; i < periodos.length; i++) {
    if (indicesExistentes.has(i)) continue; // já existe, não duplica
    const p = periodos[i];
    const data: PeriodoVagasData = {
      label: labelPeriodo(i, p),
      data_inicio: p.check_in,
      data_fim: p.check_out,
      destino: p.destino || '',
      vagas_total: vagasTotal,
      vagas_reservadas: 0,
      vagas_confirmadas: 0,
      vagas_disponiveis: vagasTotal,
    };
    await pool.query(
      `INSERT INTO grupo_periodos_vagas (id, grupo_id, periodo_index, data, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (grupo_id, periodo_index) DO NOTHING`,
      [generateId(), grupo.id, i, JSON.stringify(data), tenantId],
    );
  }
}

// Recalcula vagas_reservadas/confirmadas/disponiveis de um período a partir
// das reservas ativas (não canceladas). Chamar após criar/atualizar/cancelar
// uma reserva.
export async function recalcularVagasPeriodo(
  pool: Pool,
  periodoId: string,
  tenantId: string,
): Promise<PeriodoVagasData | null> {
  const { rows: pRows } = await pool.query(
    `SELECT id, data FROM grupo_periodos_vagas WHERE id = $1 AND tenant_id = $2`,
    [periodoId, tenantId],
  );
  if (pRows.length === 0) return null;
  const data = pRows[0].data as PeriodoVagasData;

  const { rows: counts } = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM grupo_reservas
     WHERE periodo_id = $1 AND tenant_id = $2 GROUP BY status`,
    [periodoId, tenantId],
  );
  const map: Record<string, number> = {};
  for (const r of counts) map[r.status] = r.n;
  const reservadas = (map['reservado'] || 0) + (map['lista_espera'] || 0);
  const confirmadas = map['confirmado'] || 0;
  const disponiveis = Math.max(data.vagas_total - reservadas - confirmadas, 0);

  const atualizado: PeriodoVagasData = {
    ...data,
    vagas_reservadas: reservadas,
    vagas_confirmadas: confirmadas,
    vagas_disponiveis: disponiveis,
  };
  await pool.query(
    `UPDATE grupo_periodos_vagas SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(atualizado), periodoId, tenantId],
  );
  return atualizado;
}
