import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { sanitizeMap, type MapaMentalData, type MindNode, type Theme } from './mapa-mental';

export const MAPAS_MENTAIS_COMPARTILHAMENTO_SCHEMA_SQL = String.raw`
  CREATE TABLE IF NOT EXISTS mapas_mentais_compartilhamento_segredos (
    version SMALLINT PRIMARY KEY,
    secret_value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mapas_mentais_comp_secret_valido
      CHECK (secret_value ~ '^[0-9a-f]{64}$')
  );

  INSERT INTO mapas_mentais_compartilhamento_segredos (version, secret_value)
  VALUES (
    1,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  )
  ON CONFLICT (version) DO NOTHING;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_mapas_mentais_id_tenant
    ON mapas_mentais (id, tenant_id);

  CREATE TABLE IF NOT EXISTS mapas_mentais_compartilhamentos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    mapa_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    secret_version SMALLINT NOT NULL DEFAULT 1,
    allow_copy BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT mapas_mentais_comp_token_hash_valido
      CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT mapas_mentais_comp_secret_fk
      FOREIGN KEY (secret_version)
      REFERENCES mapas_mentais_compartilhamento_segredos (version),
    CONSTRAINT mapas_mentais_comp_mapa_tenant_fk
      FOREIGN KEY (mapa_id, tenant_id)
      REFERENCES mapas_mentais (id, tenant_id)
      ON DELETE CASCADE
  );

  ALTER TABLE mapas_mentais_compartilhamentos
    ADD COLUMN IF NOT EXISTS secret_version SMALLINT NOT NULL DEFAULT 1;

  DO $migration$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'mapas_mentais_comp_secret_fk'
        AND conrelid = 'mapas_mentais_compartilhamentos'::regclass
    ) THEN
      ALTER TABLE mapas_mentais_compartilhamentos
        ADD CONSTRAINT mapas_mentais_comp_secret_fk
        FOREIGN KEY (secret_version)
        REFERENCES mapas_mentais_compartilhamento_segredos (version);
    END IF;
  END;
  $migration$;

  CREATE INDEX IF NOT EXISTS idx_mapas_mentais_comp_tenant_mapa
    ON mapas_mentais_compartilhamentos (tenant_id, mapa_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_mapas_mentais_comp_ativo
    ON mapas_mentais_compartilhamentos (tenant_id, mapa_id)
    WHERE revoked_at IS NULL;
`;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const IDS_RESERVADOS = new Set(['__proto__', 'prototype', 'constructor']);
const THEMES = new Set<Theme>([
  'minimal', 'classic', 'rainbow', 'mono', 'ocean', 'sunset', 'forest',
  'pastel', 'vibrante', 'escuro', 'sepia',
]);
const LAYOUTS = new Set<MapaMentalData['layout']>(['map', 'logical', 'right']);
const MAX_MAP_BYTES = 5_000_000;
const MAX_NODES = 5_000;
export const MAPA_MENTAL_SHARE_SECRET_VERSION = 1;

type JsonObject = Record<string, unknown>;

function objeto(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function texto(value: unknown, limite: number): string {
  return typeof value === 'string' ? value.slice(0, limite) : '';
}

function numeroFinito(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function urlSegura(value: unknown, permitirContato = false): string {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!url || url.length > 2_048 || /[\\\u0000-\u001f\u007f]/.test(url)) return '';
  if (url.startsWith('/')) return url.startsWith('//') ? '' : url;

  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return '';
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    if (permitirContato && (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:')) return url;
  } catch {
    return '';
  }
  return '';
}

function listaLinks(value: unknown): { label: string; url: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links = value.slice(0, 100).flatMap(item => {
    const raw = objeto(item);
    const url = urlSegura(raw?.url, true);
    if (!raw || !url) return [];
    return [{ label: texto(raw.label, 500), url }];
  });
  return links.length > 0 ? links : undefined;
}

function listaAnexos(value: unknown): { name: string; url: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const anexos = value.slice(0, 100).flatMap(item => {
    const raw = objeto(item);
    const url = urlSegura(raw?.url);
    if (!raw || !url) return [];
    return [{ name: texto(raw.name, 500), url }];
  });
  return anexos.length > 0 ? anexos : undefined;
}

function normalizarNode(chave: string, value: unknown): MindNode | null {
  const raw = objeto(value);
  if (!raw || !idMapaMentalValido(chave)) return null;

  const parentId = raw.parentId === null
    ? null
    : (idMapaMentalValido(raw.parentId) ? raw.parentId : null);
  const ordemRaw = numeroFinito(raw.ordem);
  const node: MindNode = {
    id: chave,
    text: texto(raw.text, 5_000),
    parentId,
    ordem: ordemRaw === null ? 0 : Math.max(0, Math.floor(ordemRaw)),
  };

  if (raw.side === 'left' || raw.side === 'right') node.side = raw.side;
  if (
    typeof raw.color === 'string'
    && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw.color)
  ) node.color = raw.color;
  if (typeof raw.icon === 'string' && raw.icon.length <= 32) node.icon = raw.icon;
  if (typeof raw.notes === 'string') node.notes = raw.notes.slice(0, 100_000);
  if (typeof raw.collapsed === 'boolean') node.collapsed = raw.collapsed;

  const image = objeto(raw.image);
  const imageUrl = urlSegura(image?.url);
  if (image && imageUrl) node.image = { url: imageUrl, alt: texto(image.alt, 1_000) || undefined };

  const links = listaLinks(raw.links);
  if (links) node.links = links;
  const attachments = listaAnexos(raw.attachments);
  if (attachments) node.attachments = attachments;

  const style = objeto(raw.style);
  if (style) {
    const shape = style.shape === 'rounded' || style.shape === 'pill' || style.shape === 'rect'
      ? style.shape
      : undefined;
    const bold = typeof style.bold === 'boolean' ? style.bold : undefined;
    if (shape !== undefined || bold !== undefined) node.style = { shape, bold };
  }

  return node;
}

export function idMapaMentalValido(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id) && !IDS_RESERVADOS.has(id);
}

/**
 * Deriva um bearer token estável a partir do UUID aleatório e de um segredo
 * persistente/versionado no banco. Assim o ID visto na auditoria não revela o
 * link, e trocar a chave usada pelas sessões não invalida compartilhamentos.
 */
export function gerarTokenCompartilhamento(
  compartilhamentoId: string,
  secret: string,
): { token: string; tokenHash: string } {
  if (!idMapaMentalValido(compartilhamentoId)) {
    throw new Error('Identificador de compartilhamento inválido.');
  }
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    throw new Error('Segredo de compartilhamento inválido.');
  }
  const token = createHmac('sha256', secret)
    .update(`entur-os-fin:mapa-mental-share:v1:${compartilhamentoId}`)
    .digest('base64url');
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') };
}

/** Rejeita tokens fora do formato antes de tocar no banco. */
export function hashTokenCompartilhamento(token: unknown): string | null {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}

/** Confirma que o token foi derivado para a linha encontrada pelo seu hash. */
export function tokenPertenceAoCompartilhamento(
  token: string,
  compartilhamentoId: string,
  secret: string,
): boolean {
  if (!TOKEN_PATTERN.test(token) || !idMapaMentalValido(compartilhamentoId)) return false;
  const esperado = gerarTokenCompartilhamento(compartilhamentoId, secret).token;
  return timingSafeEqual(Buffer.from(token), Buffer.from(esperado));
}

export function novoIdMapaMental(): string {
  return randomUUID();
}

/**
 * Bloqueia mutações disparadas por outra origem. Clientes não-browser podem
 * omitir Origin/Sec-Fetch-Site; navegadores modernos sempre enviam ao menos
 * um desses sinais em POSTs cross-site.
 */
export function origemMutacaoPermitida(req: Request, canonicalBaseUrl?: string): boolean {
  const fetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false;

  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol)) return false;
    const allowed = new Set<string>([new URL(req.url).origin]);
    if (canonicalBaseUrl) allowed.add(new URL(canonicalBaseUrl).origin);

    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    if (forwardedHost) {
      const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
        || new URL(req.url).protocol.replace(':', '');
      if (forwardedProto === 'http' || forwardedProto === 'https') {
        allowed.add(`${forwardedProto}://${forwardedHost}`);
      }
    }
    return allowed.has(parsedOrigin.origin);
  } catch {
    return false;
  }
}

export function requisicaoJson(req: Request): boolean {
  return req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * Cria a projeção pública do JSONB. Somente campos do contrato do editor são
 * copiados; metadados inesperados e URLs com protocolos ativos são descartados.
 */
export function prepararMapaCompartilhado(
  value: unknown,
  idAutoritativo: string,
  nomeAutoritativo: string,
): MapaMentalData | null {
  const raw = objeto(value);
  if (!raw || !idMapaMentalValido(idAutoritativo)) return null;

  let serializado = '';
  try {
    serializado = JSON.stringify(raw);
  } catch {
    return null;
  }
  if (Buffer.byteLength(serializado, 'utf8') > MAX_MAP_BYTES) return null;

  const rootId = texto(raw.rootId, 200);
  const rawNodes = objeto(raw.nodes);
  if (!idMapaMentalValido(rootId) || !rawNodes) return null;
  const entries = Object.entries(rawNodes);
  if (entries.length === 0 || entries.length > MAX_NODES) return null;

  const nodes = Object.create(null) as Record<string, MindNode>;
  for (const [chave, valueNode] of entries) {
    const node = normalizarNode(chave, valueNode);
    if (node) nodes[chave] = node;
  }
  if (!nodes[rootId]) return null;

  const theme = typeof raw.theme === 'string' && THEMES.has(raw.theme as Theme)
    ? raw.theme as Theme
    : 'minimal';
  const layout = typeof raw.layout === 'string' && LAYOUTS.has(raw.layout as MapaMentalData['layout'])
    ? raw.layout as MapaMentalData['layout']
    : 'map';

  const viewRaw = objeto(raw.view);
  const zoom = numeroFinito(viewRaw?.zoom);
  const x = numeroFinito(viewRaw?.x);
  const y = numeroFinito(viewRaw?.y);
  const view = {
    ...(zoom === null ? {} : { zoom: Math.min(4, Math.max(0.05, zoom)) }),
    ...(x === null ? {} : { x: Math.min(1_000_000, Math.max(-1_000_000, x)) }),
    ...(y === null ? {} : { y: Math.min(1_000_000, Math.max(-1_000_000, y)) }),
  };

  return sanitizeMap({
    id: idAutoritativo,
    nome: texto(nomeAutoritativo, 500).trim() || texto(raw.nome, 500).trim() || 'Sem título',
    rootId,
    nodes,
    theme,
    layout,
    view,
  });
}

export function duplicarMapaCompartilhado(
  value: unknown,
  sourceId: string,
  sourceName: string,
  novoId: string,
): MapaMentalData | null {
  const source = prepararMapaCompartilhado(value, sourceId, sourceName);
  if (!source || !idMapaMentalValido(novoId)) return null;
  const nomeBase = source.nome.trim() || 'Sem título';
  const nome = `${nomeBase.slice(0, 490)} (cópia)`;
  return { ...source, id: novoId, nome };
}
