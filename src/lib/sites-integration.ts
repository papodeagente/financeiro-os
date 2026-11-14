import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import pool, { initDB } from './db';
import { cifrar, type Envelope } from './cofre';
import { projetarMovimentoSites, projetarReservaSites, TIPOS_FINANCEIROS_SITES } from './sites-ledger';

export const TIPOS_SITES = new Set([
  'reserva.criada', 'reserva.pendente', 'reserva.confirmada', 'reserva.recusada',
  'reserva.remarcada', 'reserva.cancelada', 'reserva.alterada',
  'pagamento.recebido', 'pagamento.falhou', 'saldo.pago', 'taxa.ajustada',
  'reembolso.emitido', 'reembolso.efetuado', 'reembolso.falhou', 'repasse.recebido',
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
  if (e.versaoDoEsquema !== 1 || e.empresaId !== empresaId || !Number.isSafeInteger(e.empresaId) || e.empresaId < 1 || typeof e.criadoEm !== 'string' || !Number.isFinite(Date.parse(e.criadoEm))) return null;
  if (!e.agregado || typeof e.agregado.tipo !== 'string' || !e.agregado.tipo || e.agregado.tipo.length > 100
    || typeof e.agregado.id !== 'string' || !e.agregado.id || e.agregado.id.length > 100
    || !Number.isSafeInteger(e.agregado.versao) || e.agregado.versao < 0 || e.agregado.versao > 2_147_483_647) return null;
  if (!e.dados || typeof e.dados !== 'object' || Array.isArray(e.dados) || e.dados.teste === true) return null;
  if (e.tipo.startsWith('reserva.') && e.agregado.tipo !== 'reserva' && e.dados.reservaId == null) return null;
  const envelope = e as EnvelopeSites;
  // Um evento financeiro incompleto não pode ser arquivado como recebido:
  // isso faria a reconciliação ficar verde sem valor/chave natural para o
  // livro. O Sites retenta 422 depois de corrigido, usando o mesmo UUID.
  if (TIPOS_FINANCEIROS_SITES.has(envelope.tipo) && !projetarMovimentoSites(envelope)) return null;
  return envelope;
}

export async function configSites(tenantId: string) {
  if (!pool) throw new Error('Banco de dados indisponível');
  await initDB();
  const { rows } = await pool.query<{ company_id: number; segredo: Envelope; ativo: boolean }>(
    'SELECT company_id, segredo, ativo FROM sites_config WHERE tenant_id = $1', [tenantId],
  );
  return rows[0] ?? null;
}

export async function salvarConfigSites(tenantId: string, companyId: number, segredo?: string, ativo = true) {
  if (!pool) throw new Error('Banco de dados indisponível');
  await initDB();
  if (!Number.isSafeInteger(companyId) || companyId < 1) throw new Error('ID da empresa no Sites inválido');
  const chave = segredo?.trim() || '';
  if (chave && !/^whsec_[A-Za-z0-9_-]{40,}$/.test(chave)) throw new Error('Segredo do webhook do Sites inválido');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Fecha a corrida entre dois tenants tentando reivindicar a mesma
    // empresa do Sites antes de o índice único decidir por um deles.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sites-company:${companyId}`]);
    const { rows } = await client.query<{ company_id: number; segredo: Envelope }>(
      'SELECT company_id, segredo FROM sites_config WHERE tenant_id=$1 FOR UPDATE', [tenantId],
    );
    const atual = rows[0];
    if (!chave && (!atual?.segredo || atual.company_id !== companyId)) {
      throw new Error('Informe o novo segredo ao trocar a empresa do Sites');
    }
    if (atual && atual.company_id !== companyId) {
      const { rowCount: temHistorico } = await client.query(
        'SELECT 1 FROM sites_eventos WHERE tenant_id=$1 LIMIT 1', [tenantId],
      );
      if (temHistorico) {
        throw new Error('Esta integração já recebeu eventos. A troca de empresa exige migração assistida para não misturar históricos');
      }
    }
    const { rows: outro } = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM sites_config WHERE company_id=$1 AND tenant_id<>$2 AND ativo LIMIT 1', [companyId, tenantId],
    );
    if (outro[0]) throw new Error('Esta empresa do Sites já está pareada com outra empresa no Financeiro');
    const cifrado = chave ? cifrar(chave) : atual!.segredo;
    await client.query(
      `INSERT INTO sites_config (tenant_id, company_id, segredo, ativo)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (tenant_id) DO UPDATE SET company_id = EXCLUDED.company_id,
         segredo = EXCLUDED.segredo, ativo = EXCLUDED.ativo, updated_at = NOW()`,
      [tenantId, companyId, JSON.stringify(cifrado), ativo],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
}

export async function receberEventoSites(tenantId: string, envelope: EnvelopeSites, corpo: string) {
  if (!pool) throw new Error('Banco de dados indisponível');
  await initDB();
  const hash = createHash('sha256').update(corpo).digest('hex');
  const dados = envelope.dados;
  const pedidoCodigo = typeof dados.pedidoCodigo === 'string' ? dados.pedidoCodigo.slice(0, 100) : null;
  const pedidoBruto = dados.pedidoId ?? (envelope.agregado.tipo === 'pedido' ? envelope.agregado.id : null);
  const reservaBruta = dados.reservaId ?? (envelope.agregado.tipo === 'reserva' ? envelope.agregado.id : null);
  const pedidoId = pedidoBruto == null ? null : String(pedidoBruto).slice(0, 100);
  const reservaId = reservaBruta == null ? null : String(reservaBruta).slice(0, 100);
  const reserva = projetarReservaSites(envelope);
  const movimento = projetarMovimentoSites(envelope);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa o primeiro evento com uma eventual troca de pareamento. Sem
    // esta checagem, um request já assinado pela empresa antiga poderia entrar
    // depois de a configuração passar a apontar para outra empresa.
    const { rows: configs } = await client.query<{ company_id: number; ativo: boolean }>(
      'SELECT company_id, ativo FROM sites_config WHERE tenant_id=$1 FOR SHARE', [tenantId],
    );
    if (!configs[0]?.ativo || configs[0].company_id !== envelope.empresaId) {
      throw new Error('Pareamento do Sites mudou durante o recebimento');
    }
    const { rowCount } = await client.query(
      `INSERT INTO sites_eventos
         (tenant_id, id, company_id, tipo, pedido_codigo, pedido_id, reserva_id,
          agregado_tipo, agregado_id, agregado_versao, criado_em, corpo_sha256, dados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [tenantId, envelope.id, envelope.empresaId, envelope.tipo, pedidoCodigo, pedidoId, reservaId,
        envelope.agregado.tipo.slice(0, 100), envelope.agregado.id.slice(0, 100), envelope.agregado.versao,
        envelope.criadoEm, hash, JSON.stringify(dados)],
    );
    const duplicado = !rowCount;
    if (duplicado) {
      const { rows } = await client.query<{ corpo_sha256: string; projetado_em: string | null }>(
        'SELECT corpo_sha256, projetado_em::text FROM sites_eventos WHERE tenant_id = $1 AND id = $2', [tenantId, envelope.id],
      );
      if (rows[0]?.corpo_sha256 !== hash) throw new Error('ID de evento reutilizado com conteúdo diferente');
      // Eventos arquivados antes da criação das projeções são reparáveis com
      // o mesmo replay do Sites. O UUID/hash continua idempotente: só falta
      // materializar, sem inserir outra cópia do evento bruto.
      if (rows[0]?.projetado_em || (!reserva && !movimento)) {
        await client.query('COMMIT');
        return { duplicado: true, projetado: Boolean(rows[0]?.projetado_em) };
      }
    }

    if (reserva) await client.query(
      `INSERT INTO sites_reservas
         (tenant_id, reserva_id, pedido_id, pedido_codigo, numero, versao,
          situacao, total_centavos, moeda, servico_id, inicio, fim,
          ocorrido_em, evento_id, dados)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13,$14,$15::jsonb)
       ON CONFLICT (tenant_id, reserva_id) DO UPDATE SET
         pedido_id = COALESCE(EXCLUDED.pedido_id, sites_reservas.pedido_id),
         pedido_codigo = COALESCE(EXCLUDED.pedido_codigo, sites_reservas.pedido_codigo),
         numero = COALESCE(EXCLUDED.numero, sites_reservas.numero),
         versao = EXCLUDED.versao, situacao = EXCLUDED.situacao,
         total_centavos = COALESCE(EXCLUDED.total_centavos, sites_reservas.total_centavos),
         moeda = COALESCE(EXCLUDED.moeda, sites_reservas.moeda),
         servico_id = COALESCE(EXCLUDED.servico_id, sites_reservas.servico_id),
         inicio = COALESCE(EXCLUDED.inicio, sites_reservas.inicio),
         fim = COALESCE(EXCLUDED.fim, sites_reservas.fim),
         ocorrido_em = EXCLUDED.ocorrido_em, evento_id = EXCLUDED.evento_id,
         dados = EXCLUDED.dados, atualizado_em = NOW()
       WHERE EXCLUDED.versao > sites_reservas.versao
          OR (EXCLUDED.versao = sites_reservas.versao AND EXCLUDED.ocorrido_em >= sites_reservas.ocorrido_em)`,
      [tenantId, reserva.reservaId, reserva.pedidoId, reserva.pedidoCodigo, reserva.numero,
        reserva.versao, reserva.situacao, reserva.totalCentavos, reserva.moeda,
        reserva.servicoId, reserva.inicio, reserva.fim, reserva.ocorridoEm,
        reserva.eventoId, JSON.stringify(reserva.dados)],
    );

    if (movimento) await client.query(
      `INSERT INTO sites_movimentos
         (tenant_id, chave_natural, evento_id, company_id, tipo, categoria,
          referencia, pedido_id, pedido_codigo, reserva_id, agregado_versao, valor_centavos,
          taxa_centavos, liquido_centavos, moeda, estado, efetivo, ocorrido_em, dados)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
       ON CONFLICT (tenant_id, chave_natural) DO UPDATE SET
         evento_id = EXCLUDED.evento_id,
         company_id = EXCLUDED.company_id,
         tipo = EXCLUDED.tipo,
         categoria = EXCLUDED.categoria,
         referencia = EXCLUDED.referencia,
         pedido_id = COALESCE(EXCLUDED.pedido_id, sites_movimentos.pedido_id),
         pedido_codigo = COALESCE(EXCLUDED.pedido_codigo, sites_movimentos.pedido_codigo),
         reserva_id = COALESCE(EXCLUDED.reserva_id, sites_movimentos.reserva_id),
         agregado_versao = EXCLUDED.agregado_versao,
         valor_centavos = EXCLUDED.valor_centavos,
         taxa_centavos = EXCLUDED.taxa_centavos,
         liquido_centavos = EXCLUDED.liquido_centavos,
         moeda = COALESCE(EXCLUDED.moeda, sites_movimentos.moeda),
         estado = EXCLUDED.estado, efetivo = EXCLUDED.efetivo,
         ocorrido_em = EXCLUDED.ocorrido_em, dados = EXCLUDED.dados,
         recebido_em = NOW()
       WHERE EXCLUDED.agregado_versao > sites_movimentos.agregado_versao
          OR (EXCLUDED.agregado_versao = sites_movimentos.agregado_versao
              AND EXCLUDED.ocorrido_em >= sites_movimentos.ocorrido_em)`,
      [tenantId, movimento.chaveNatural, movimento.eventoId, envelope.empresaId,
        movimento.tipo, movimento.categoria, movimento.referencia,
        movimento.pedidoId, movimento.pedidoCodigo, movimento.reservaId,
        envelope.agregado.versao,
        movimento.valorCentavos, movimento.taxaCentavos, movimento.liquidoCentavos,
        movimento.moeda, movimento.estado, movimento.efetivo,
        movimento.ocorridoEm, JSON.stringify(movimento.dados)],
    );
    if (reserva || movimento) await client.query(
      'UPDATE sites_eventos SET projetado_em=NOW() WHERE tenant_id=$1 AND id=$2',
      [tenantId, envelope.id],
    );
    await client.query('COMMIT');
    return { duplicado, projetado: Boolean(reserva || movimento) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
}

export interface ReconciliacaoSites {
  configurado: boolean;
  eventos: number;
  reservas: number;
  movimentos: number;
  eventosFinanceirosSemMovimento: number;
  eventosDeReservaSemRetrato: number;
  pedidosSemCodigo: number;
  ultimoRecebidoEm: string | null;
  emDia: boolean;
}

/**
 * Confere o inbox e as duas projeções. Serve para o diagnóstico diário e
 * para provar que um 2xx do receiver não apenas arquivou o JSON.
 */
export async function reconciliarSites(tenantId: string): Promise<ReconciliacaoSites> {
  if (!pool) throw new Error('Banco de dados indisponível');
  await initDB();
  const financeiros = [...TIPOS_FINANCEIROS_SITES];
  const { rows } = await pool.query<{
    configurado: boolean;
    eventos: number; reservas: number; movimentos: number;
    financeiros_sem: number; reservas_sem: number; pedidos_sem_codigo: number;
    ultimo: string | null;
  }>(`SELECT
      EXISTS (SELECT 1 FROM sites_config WHERE tenant_id=$1 AND ativo) AS configurado,
      (SELECT count(*)::int FROM sites_eventos WHERE tenant_id=$1) AS eventos,
      (SELECT count(*)::int FROM sites_reservas WHERE tenant_id=$1) AS reservas,
      (SELECT count(*)::int FROM sites_movimentos WHERE tenant_id=$1) AS movimentos,
      (SELECT count(*)::int FROM sites_eventos e
        WHERE e.tenant_id=$1 AND e.tipo=ANY($2::text[])
          AND e.projetado_em IS NULL) AS financeiros_sem,
      (SELECT count(*)::int FROM sites_eventos e
        WHERE e.tenant_id=$1 AND e.tipo LIKE 'reserva.%' AND e.reserva_id IS NOT NULL
          AND e.projetado_em IS NULL) AS reservas_sem,
      (SELECT count(*)::int FROM sites_eventos
        WHERE tenant_id=$1 AND (tipo LIKE 'reserva.%' OR tipo=ANY($2::text[]))
          AND pedido_id IS NOT NULL AND pedido_codigo IS NULL) AS pedidos_sem_codigo,
      (SELECT max(recebido_em)::text FROM sites_eventos WHERE tenant_id=$1) AS ultimo`,
    [tenantId, financeiros]);
  const r = rows[0] ?? { configurado: false, eventos: 0, reservas: 0, movimentos: 0, financeiros_sem: 0, reservas_sem: 0, pedidos_sem_codigo: 0, ultimo: null };
  return {
    configurado: r.configurado,
    eventos: r.eventos, reservas: r.reservas, movimentos: r.movimentos,
    eventosFinanceirosSemMovimento: r.financeiros_sem,
    eventosDeReservaSemRetrato: r.reservas_sem,
    pedidosSemCodigo: r.pedidos_sem_codigo,
    ultimoRecebidoEm: r.ultimo,
    // Sem conexão ou sem sequer o ping inicial não existe evidência para um
    // selo verde. "Em dia" significa que algo foi recebido e todo evento
    // materializável tem sua projeção, não apenas que a tabela está vazia.
    emDia: r.configurado && r.eventos > 0
      && r.financeiros_sem === 0 && r.reservas_sem === 0 && r.pedidos_sem_codigo === 0,
  };
}

