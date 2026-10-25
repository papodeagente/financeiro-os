import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import pool, { initDB } from './db';

export const TIPOS_SITES = new Set([
  'reserva.criada', 'reserva.pendente', 'reserva.confirmada', 'reserva.recusada',
  'reserva.remarcada', 'reserva.cancelada', 'reserva.alterada',
  'pagamento.recebido', 'pagamento.falhou', 'saldo.pago', 'taxa.ajustada',
  'reembolso.efetuado', 'reembolso.falhou', 'repasse.recebido',
  'disputa.aberta', 'disputa.encerrada', 'custo.registrado',
  'acerto.fechado', 'acerto.pago', 'teste.ping',
]);

export interface EnvelopeSites {
  id: string;
  tipo: string;
  versaoDoEsquema: number;
  criadoEm: string;
  empresaId: number;
  agregado: { tipo: string; id: string; versao: number };
  dados: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verificarAssinaturaSites(corpo: string, cabecalho: string, segredo: string, agora = Date.now()): boolean {
  const m = /^t=(\d{10}),v1=([0-9a-f]{64})$/i.exec(cabecalho);
  if (!m || !segredo) return false;
  const instante = Number(m[1]) * 1000;
  if (!Number.isSafeInteger(instante) || Math.abs(agora - instante) > 300_000) return false;
  const esperado = createHmac('sha256', segredo).update(`${m[1]}.${corpo}`).digest();
  const recebido = Buffer.from(m[2], 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export function lerEnvelopeSites(valor: unknown, empresaId: number): EnvelopeSites | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const e = valor as Partial<EnvelopeSites>;
  if (typeof e.id !== 'string' || !UUID.test(e.id) || typeof e.tipo !== 'string' || !TIPOS_SITES.has(e.tipo)) return null;
  if (e.versaoDoEsquema !== 1 || e.empresaId !== empresaId || typeof e.criadoEm !== 'string' || !Number.isFinite(Date.parse(e.criadoEm))) return null;
  if (!e.agregado || typeof e.agregado.tipo !== 'string' || typeof e.agregado.id !== 'string' || !Number.isSafeInteger(e.agregado.versao) || e.agregado.versao < 0) return null;
  if (!e.dados || typeof e.dados !== 'object' || Array.isArray(e.dados) || e.dados.teste === true) return null;
  return e as EnvelopeSites;
}

export async function configSites(tenantId: string) {
  if (!pool) throw new Error('Banco de dados indisponível');
  await initDB();
  const { rows } = await pool.query<{ company_id: number; segredo: string; ativo: boolean }>(
    'SELECT company_id, segredo, ativo FROM sites_config WHERE tenant_id = $1', [tenantId],
  );
  return rows[0] ?? null;
}

export async function salvarConfigSites(tenantId: string, companyId: number, segredo?: string, ativo = true) {
  if (!pool) throw new Error('Banco de dados indisponível');
  await initDB();
  if (!Number.isSafeInteger(companyId) || companyId < 1) throw new Error('ID da empresa no Sites inválido');
  const atual = await configSites(tenantId);
  const chave = segredo?.trim() || atual?.segredo || '';
  if (!/^whsec_[A-Za-z0-9_-]{40,}$/.test(chave) && chave.length < 32) throw new Error('Informe o segredo do webhook do Sites');
  await pool.query(
    `INSERT INTO sites_config (tenant_id, company_id, segredo, ativo)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE SET company_id = EXCLUDED.company_id,
       segredo = EXCLUDED.segredo, ativo = EXCLUDED.ativo, updated_at = NOW()`,
    [tenantId, companyId, chave, ativo],
  );
}

export async function receberEventoSites(tenantId: string, envelope: EnvelopeSites, corpo: string) {
  if (!pool) throw new Error('Banco de dados indisponível');
  const hash = createHash('sha256').update(corpo).digest('hex');
  const dados = envelope.dados;
  const pedidoCodigo = typeof dados.pedidoCodigo === 'string' ? dados.pedidoCodigo.slice(0, 100) : null;
  const pedidoId = dados.pedidoId == null ? null : String(dados.pedidoId).slice(0, 100);
  const reservaId = dados.reservaId == null ? null : String(dados.reservaId).slice(0, 100);
  const { rowCount } = await pool.query(
    `INSERT INTO sites_eventos
       (tenant_id, id, company_id, tipo, pedido_codigo, pedido_id, reserva_id,
        agregado_tipo, agregado_id, agregado_versao, criado_em, corpo_sha256, dados)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [tenantId, envelope.id, envelope.empresaId, envelope.tipo, pedidoCodigo, pedidoId, reservaId,
      envelope.agregado.tipo.slice(0, 100), envelope.agregado.id.slice(0, 100), envelope.agregado.versao,
      envelope.criadoEm, hash, JSON.stringify(dados)],
  );
  if (rowCount) return { duplicado: false };
  const { rows } = await pool.query<{ corpo_sha256: string }>(
    'SELECT corpo_sha256 FROM sites_eventos WHERE tenant_id = $1 AND id = $2', [tenantId, envelope.id],
  );
  if (rows[0]?.corpo_sha256 !== hash) throw new Error('ID de evento reutilizado com conteúdo diferente');
  return { duplicado: true };
}

export function novoSegredoSites() { return `whsec_${randomBytes(32).toString('base64url')}`; }
