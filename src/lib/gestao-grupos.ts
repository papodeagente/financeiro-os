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

export interface GestaoGrupoData {
  observacoes: string;
  config_vagas: ConfigVagas;
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
    const data: GestaoGrupoData = { observacoes: '', config_vagas: { ...DEFAULT_CONFIG } };
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
