/**
 * Portal do cliente no servidor (05/11/2026): o link por cliente (criar,
 * ver, revogar) e a leitura pública `lerPortal(token)`.
 *
 * As tabelas `cobrancas` e a do token do portal são do esquema da PARTE A
 * (COBRANCA_SCHEMA_SQL, docs/programa/e3-contratos.md). Esta parte não as
 * cria: escreve SQL sobre os nomes e colunas abaixo. Na integração, conferir
 * se o esquema da parte A tem exatamente isto (ou ajustar só as constantes
 * TABELA_* e as consultas deste arquivo). O formato que esta parte assume
 * está, inteiro, em `ESQUEMA_ASSUMIDO_DO_PORTAL` (o teste usa ele).
 *
 * Segurança do link:
 *   · o token é 32 bytes aleatórios (base64url); no banco fica só o SHA-256
 *     (quem lê o banco não abre o portal de ninguém) e, se o cofre estiver
 *     ligado, a cópia cifrada para a agência poder copiar o link de novo;
 *   · um link ATIVO por cliente: gerar outro revoga o anterior;
 *   · revogado, vencido, de cliente apagado ou inexistente: a mesma resposta
 *     (404), sem dizer qual foi;
 *   · a leitura filtra SEMPRE por agência E cliente do link.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { ExecutorSQL } from '../caixa-atomico';
import { cifrar, cofreDisponivel, decifrar } from '../cofre';
import { documentoDoCliente, contaReceberDoTenant, lerRecibo } from './recibo-servidor';
import {
  documentoMascarado, montarPortal, tokenComFormatoValido,
  type CobrancaParaPortal, type EncargosDoPortal, type NotaParaPortal, type PortalPublico,
} from './portal-regras';
import { encargosDaCobranca, lerConfigCobranca } from './config';
import type { ResultadoDoRecibo } from './recibo';

export const TABELA_LINKS = 'cobranca_portal_links';
export const TABELA_COBRANCAS = 'cobrancas';

/**
 * O que esta parte assume do esquema da parte A (só as colunas usadas aqui).
 * Idempotente; o teste com PGlite cria as tabelas com isto.
 */
export const ESQUEMA_ASSUMIDO_DO_PORTAL = `
  CREATE TABLE IF NOT EXISTS ${TABELA_COBRANCAS} (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    titulo_id TEXT NOT NULL,            -- contas_receber.id
    provedor TEXT NOT NULL,
    tipo TEXT NOT NULL,                 -- boleto | pix | boleto_pix | link | carne
    status TEXT NOT NULL,               -- emitindo | aberta | vencida | paga | cancelada | estornada | falhou
    valor_centavos BIGINT NOT NULL,
    vencimento DATE NOT NULL,
    linha_digitavel TEXT,
    codigo_barras TEXT,
    pix_copia_cola TEXT,
    url_boleto TEXT,
    url_fatura TEXT,
    carne_id TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE TABLE IF NOT EXISTS ${TABELA_LINKS} (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    cliente_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    token_cifrado JSONB,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    criado_por TEXT,
    revogado_em TIMESTAMPTZ,
    expira_em TIMESTAMPTZ,
    ultimo_acesso_em TIMESTAMPTZ,
    acessos INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_${TABELA_LINKS}_hash ON ${TABELA_LINKS}(token_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_${TABELA_LINKS}_ativo ON ${TABELA_LINKS}(tenant_id, cliente_id) WHERE revogado_em IS NULL;
`;

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function novoToken(): string {
  return randomBytes(32).toString('base64url');
}

export function caminhoDoPortal(token: string): string {
  return `/c/${token}`;
}

// ─── Link do portal (tela da agência) ──────────────────────────────────────

export interface EstadoDoLink {
  ativo: boolean;
  /** Endereço relativo (/c/…); a tela completa com o domínio. */
  caminho: string | null;
  criado_em: string | null;
  ultimo_acesso_em: string | null;
  acessos: number;
}

const SEM_LINK: EstadoDoLink = { ativo: false, caminho: null, criado_em: null, ultimo_acesso_em: null, acessos: 0 };

export async function clienteDaAgencia(exec: ExecutorSQL, tenantId: string, clienteId: string): Promise<boolean> {
  const { rows } = await exec.query('SELECT 1 FROM clientes WHERE tenant_id = $1 AND id = $2', [tenantId, clienteId]);
  return rows.length > 0;
}

export async function estadoDoLink(exec: ExecutorSQL, tenantId: string, clienteId: string): Promise<EstadoDoLink> {
  const { rows } = await exec.query(
    `SELECT token_cifrado, criado_em::text AS criado, ultimo_acesso_em::text AS acesso, acessos
       FROM ${TABELA_LINKS}
      WHERE tenant_id = $1 AND cliente_id = $2 AND revogado_em IS NULL AND (expira_em IS NULL OR expira_em > NOW())
      ORDER BY criado_em DESC LIMIT 1`,
    [tenantId, clienteId],
  );
  if (!rows.length) return SEM_LINK;
  const r = rows[0];
  let caminho: string | null = null;
  if (r.token_cifrado && cofreDisponivel()) {
    try { caminho = caminhoDoPortal(decifrar(r.token_cifrado)); } catch { caminho = null; }
  }
  return { ativo: true, caminho, criado_em: String(r.criado ?? '') || null, ultimo_acesso_em: (r.acesso as string | null) ?? null, acessos: Number(r.acessos ?? 0) };
}

/** Cria o link do cliente; o anterior (se houver) para de abrir. Chamar dentro de transação. */
export async function criarLink(exec: ExecutorSQL, tenantId: string, clienteId: string, usuario: string | null): Promise<EstadoDoLink> {
  await exec.query(
    `UPDATE ${TABELA_LINKS} SET revogado_em = NOW() WHERE tenant_id = $1 AND cliente_id = $2 AND revogado_em IS NULL`,
    [tenantId, clienteId],
  );
  const token = novoToken();
  const cifrado = cofreDisponivel() ? JSON.stringify(cifrar(token)) : null;
  const id = `pl-${randomBytes(9).toString('base64url')}`;
  const { rows } = await exec.query(
    `INSERT INTO ${TABELA_LINKS} (id, tenant_id, cliente_id, token_hash, token_cifrado, criado_por)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING criado_em::text AS criado`,
    [id, tenantId, clienteId, hashDoToken(token), cifrado, usuario],
  );
  return { ativo: true, caminho: caminhoDoPortal(token), criado_em: String(rows[0]?.criado ?? ''), ultimo_acesso_em: null, acessos: 0 };
}

export async function revogarLink(exec: ExecutorSQL, tenantId: string, clienteId: string): Promise<number> {
  const r = await exec.query(
    `UPDATE ${TABELA_LINKS} SET revogado_em = NOW() WHERE tenant_id = $1 AND cliente_id = $2 AND revogado_em IS NULL`,
    [tenantId, clienteId],
  );
  return r.rowCount ?? 0;
}

// ─── Leitura pública ───────────────────────────────────────────────────────

export interface LinkAtivo { id: string; tenant_id: string; cliente_id: string }

/** O link ativo do token, ou null (formato errado, inexistente, revogado, vencido). */
export async function acharLink(exec: ExecutorSQL, token: unknown): Promise<LinkAtivo | null> {
  if (!tokenComFormatoValido(token)) return null;
  const { rows } = await exec.query(
    `SELECT l.id, l.tenant_id, l.cliente_id
       FROM ${TABELA_LINKS} l
       JOIN clientes c ON c.tenant_id = l.tenant_id AND c.id = l.cliente_id
      WHERE l.token_hash = $1 AND l.revogado_em IS NULL AND (l.expira_em IS NULL OR l.expira_em > NOW())
      LIMIT 1`,
    [hashDoToken(token)],
  );
  if (!rows.length) return null;
  return { id: String(rows[0].id), tenant_id: String(rows[0].tenant_id), cliente_id: String(rows[0].cliente_id) };
}

/** Conta a visita (último acesso e quantas). Nunca derruba a leitura. */
export async function marcarAcesso(exec: ExecutorSQL, link: LinkAtivo): Promise<void> {
  await exec.query(
    `UPDATE ${TABELA_LINKS} SET ultimo_acesso_em = NOW(), acessos = acessos + 1 WHERE tenant_id = $1 AND id = $2`,
    [link.tenant_id, link.id],
  ).catch(() => undefined);
}

/** Pagas aparecem por 24 meses; até 100 em aberto e 50 pagas. */
const CONTAS_DO_CLIENTE = `
  SELECT t.id, COALESCE(NULLIF(t.data->>'status', ''), t.status, '') AS st, t.data
    FROM contas_receber t
   WHERE t.tenant_id = $1
     AND COALESCE(NULLIF(t.cliente_id, ''), t.data->>'cliente_id', '') = $2
     AND COALESCE(t.data->>'origem', '') <> 'COMISSAO_FORNECEDOR'
     AND COALESCE(NULLIF(t.data->>'status', ''), t.status, '') <> 'CANCELADO'
     AND NOT (COALESCE(t.data->>'origem', '') = 'FATURA' AND COALESCE(t.data->>'fatura_situacao', '') = 'ABERTA')`;

export async function lerPortal(exec: ExecutorSQL, link: LinkAtivo, hoje: string): Promise<PortalPublico> {
  const { tenant_id: tenant, cliente_id: cliente } = link;
  const [ag, cli, abertas, pagas] = await Promise.all([
    exec.query('SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1', [tenant]),
    exec.query('SELECT nome, data FROM clientes WHERE tenant_id = $1 AND id = $2', [tenant, cliente]),
    exec.query(
      `${CONTAS_DO_CLIENTE} AND COALESCE(NULLIF(t.data->>'status', ''), t.status, '') <> 'RECEBIDO'
        ORDER BY t.data->>'data_vencimento' ASC NULLS LAST, t.id LIMIT 100`,
      [tenant, cliente],
    ),
    exec.query(
      `${CONTAS_DO_CLIENTE} AND COALESCE(NULLIF(t.data->>'status', ''), t.status, '') = 'RECEBIDO'
         AND COALESCE(NULLIF(t.data->>'data_recebimento', ''), '9999') >= to_char((NOW() - INTERVAL '24 months') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
        ORDER BY t.data->>'data_recebimento' DESC NULLS LAST, t.id LIMIT 50`,
      [tenant, cliente],
    ),
  ]);
  const contas = [...abertas.rows, ...pagas.rows].map(r => ({ id: String(r.id), status: String(r.st), data: (r.data ?? {}) as Record<string, unknown> }));
  const ids = contas.map(c => c.id);
  const cobs = ids.length
    ? (await exec.query(
      `SELECT titulo_id, tipo, status, valor_centavos, vencimento::text AS vencimento,
              linha_digitavel, pix_copia_cola, url_boleto, url_fatura
         FROM ${TABELA_COBRANCAS}
        WHERE tenant_id = $1 AND titulo_id = ANY($2::text[])
        ORDER BY criado_em DESC, id DESC`,
      [tenant, ids],
    )).rows as unknown as CobrancaParaPortal[]
    : [];
  const clienteRow = cli.rows[0] ?? {};
  const doc = await documentoDoCliente(exec, tenant, cliente);
  return montarPortal({
    agencia: (ag.rows[0]?.data ?? null) as Record<string, unknown> | null,
    cliente: { nome: String(clienteRow.nome || (clienteRow.data as Record<string, unknown> | undefined)?.nome || ''), documento: doc },
    contas,
    cobrancas: cobs,
    hoje,
    notas: await notasDoCliente(exec, link),
    encargos: await encargosDoPortal(exec, tenant),
  });
}

/** Juros e multa da política da agência, para a 2ª via pedida pelo cliente (E7). */
export async function encargosDoPortal(exec: ExecutorSQL, tenantId: string): Promise<EncargosDoPortal | null> {
  const { config, politica } = await lerConfigCobranca(exec, tenantId);
  const e = encargosDaCobranca(config, politica);
  if (!e) return null;
  return { juros_am_pct: Number(e.juros_am_pct) || 0, multa_pct: Number(e.multa_pct) || 0, tolerancia_dias: Number(e.tolerancia_dias) || 0 };
}

/**
 * Notas fiscais do cliente do link (E7): as da MESMA agência e do MESMO
 * cliente, dos últimos 24 meses, até 50. O recorte do que sai é de
 * `notasDoPortal` (só autorizada; nunca a do fornecedor/representante).
 */
export async function notasDoCliente(exec: ExecutorSQL, link: LinkAtivo): Promise<NotaParaPortal[]> {
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.notas_fiscais') IS NOT NULL AS ok`);
  if (!tem[0]?.ok) return [];
  const { rows } = await exec.query(
    `SELECT id, status, data FROM notas_fiscais
      WHERE tenant_id = $1 AND COALESCE(NULLIF(cliente_id, ''), data->>'cliente_id', '') = $2
        AND status = 'AUTORIZADA' AND created_at >= NOW() - INTERVAL '24 months'
      ORDER BY created_at DESC, id DESC LIMIT 50`,
    [link.tenant_id, link.cliente_id],
  );
  return rows.map(r => ({ id: String(r.id), status: String(r.status ?? ''), data: (r.data ?? {}) as Record<string, unknown> }));
}

/**
 * A nota do portal para baixar o arquivo: da MESMA agência e do MESMO
 * cliente do link, autorizada e emitida para ele. Senão, null (404).
 */
export async function notaDoPortal(exec: ExecutorSQL, link: LinkAtivo, notaId: string): Promise<Record<string, unknown> | null> {
  if (typeof notaId !== 'string' || !notaId || notaId.length > 100) return null;
  const notas = await exec.query(
    `SELECT id, status, data FROM notas_fiscais
      WHERE tenant_id = $1 AND id = $2 AND COALESCE(NULLIF(cliente_id, ''), data->>'cliente_id', '') = $3 LIMIT 1`,
    [link.tenant_id, notaId, link.cliente_id],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const r = notas.rows[0];
  if (!r) return null;
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (String(r.status ?? '').toUpperCase() !== 'AUTORIZADA') return null;
  if (d.destino === 'FORNECEDOR' || d.destino === 'REPRESENTANTE') return null;
  return { ...d, status: 'AUTORIZADA' };
}

/**
 * Recibo de uma conta paga, pelo portal. A conta precisa ser da MESMA
 * agência e do MESMO cliente do link; senão, null (a rota responde 404).
 */
export async function lerReciboDoPortal(exec: ExecutorSQL, link: LinkAtivo, contaId: string, hoje: string): Promise<ResultadoDoRecibo | null> {
  if (typeof contaId !== 'string' || !contaId || contaId.length > 100) return null;
  const conta = await contaReceberDoTenant(exec, link.tenant_id, contaId);
  if (!conta || conta.cliente_id !== link.cliente_id) return null;
  if (String(conta.data.origem ?? '') === 'COMISSAO_FORNECEDOR') return null;
  return lerRecibo(exec, link.tenant_id, conta, { hoje, documento: documentoMascarado });
}
