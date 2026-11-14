/**
 * Link público da proposta: token próprio, aleatório, independente do id.
 *
 * Auditoria 04/11/2026:
 *  - FIN-13: o link era o id interno da proposta (timestamp + Math.random),
 *    que valia para sempre, inclusive em rascunho, e a resposta devolvia o
 *    registro inteiro.
 *  - FIN2-06: o registro inteiro levava os contatos de outros interessados
 *    (leads), o IP/telefone/e-mail de quem aceitou e os comentários.
 *
 * Como fica:
 *  - Cada proposta ganha um token de 256 bits (base64url, 43 caracteres).
 *    O banco busca pelo HASH do token (`token_publico_hash`). O endereço
 *    completo fica em `link_publico_url`, porque a agência precisa copiar o
 *    link de novo a qualquer hora; essa coluna só é lida por quem está logado
 *    na agência dona.
 *  - Trocar o link (`renovarLinkPublico`) invalida o anterior na hora.
 *  - O token vence em PROPOSTA_LINK_DIAS (padrão 365) dias.
 *  - Links antigos pelo id continuam abrindo por 180 dias a partir da
 *    publicação desta mudança (`link_por_id_ate`), só para propostas que já
 *    existiam: não se quebra o link já mandado a cliente. Proposta nova nunca
 *    abre pelo id.
 *  - A resposta pública é um recorte (`paraPublico`): só o que a página
 *    desenha, sem leads, contatos do aceite, comentários, visualizações,
 *    custos ou margens.
 *
 * Não existe etapa explícita de "publicar" no produto (a agência copia o link
 * do rascunho e manda pelo WhatsApp), então rascunho com link continua
 * abrindo. Criar essa etapa é decisão de produto, registrada no relatório.
 */
import { createHash, randomBytes } from 'node:crypto';
import { getDefaultPublicBase } from './proposta-link';

export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const PROPOSTA_LINK_SCHEMA_SQL = `
ALTER TABLE propostas ADD COLUMN IF NOT EXISTS token_publico_hash TEXT;
ALTER TABLE propostas ADD COLUMN IF NOT EXISTS link_publico_url TEXT;
ALTER TABLE propostas ADD COLUMN IF NOT EXISTS token_expira_em TIMESTAMPTZ;
ALTER TABLE propostas ADD COLUMN IF NOT EXISTS link_por_id_ate TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_propostas_token_publico
  ON propostas (token_publico_hash) WHERE token_publico_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS marcos_de_migracao (
  chave TEXT PRIMARY KEY,
  em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM marcos_de_migracao WHERE chave = 'propostas_link_por_token') THEN
    UPDATE propostas SET link_por_id_ate = NOW() + INTERVAL '180 days'
     WHERE token_publico_hash IS NULL AND link_por_id_ate IS NULL;
    INSERT INTO marcos_de_migracao (chave) VALUES ('propostas_link_por_token') ON CONFLICT DO NOTHING;
  END IF;
END $$;
`;

const FORMATO_SLUG = /^[\w-]{10,200}$/;

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function novoToken(): string {
  return randomBytes(32).toString('base64url');
}

function diasDoLink(): number {
  const n = Number(process.env.PROPOSTA_LINK_DIAS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 365;
}

export function urlDoToken(token: string, base?: string): string {
  return `${(base || getDefaultPublicBase()).replace(/\/+$/, '')}/p/${token}`;
}

/**
 * Garante que a proposta tem token e devolve o link. Idempotente: proposta
 * que já tem token devolve o mesmo link. Null quando a proposta não existe
 * nesta agência.
 */
export async function garantirLinkPublico(db: Consulta, tenantId: string, propostaId: string, base?: string): Promise<string | null> {
  const token = novoToken();
  const url = urlDoToken(token, base);
  const { rows } = await db.query(
    `UPDATE propostas
        SET token_publico_hash = $3, link_publico_url = $4,
            token_expira_em = NOW() + ($5::int * INTERVAL '1 day')
      WHERE id = $1 AND tenant_id = $2 AND token_publico_hash IS NULL
      RETURNING link_publico_url`,
    [propostaId, tenantId, hashDoToken(token), url, diasDoLink()],
  );
  if (rows.length > 0) return String(rows[0].link_publico_url);
  const { rows: atual } = await db.query(
    `SELECT link_publico_url FROM propostas WHERE id = $1 AND tenant_id = $2`,
    [propostaId, tenantId],
  );
  if (atual.length === 0) return null;
  return (atual[0].link_publico_url as string | null) ?? null;
}

/** Troca o link: o anterior (e o acesso pelo id) deixa de abrir na hora. */
export async function renovarLinkPublico(db: Consulta, tenantId: string, propostaId: string, base?: string): Promise<string | null> {
  const token = novoToken();
  const url = urlDoToken(token, base);
  const { rows } = await db.query(
    `UPDATE propostas
        SET token_publico_hash = $3, link_publico_url = $4,
            token_expira_em = NOW() + ($5::int * INTERVAL '1 day'),
            link_por_id_ate = NULL
      WHERE id = $1 AND tenant_id = $2
      RETURNING link_publico_url`,
    [propostaId, tenantId, hashDoToken(token), url, diasDoLink()],
  );
  return rows.length > 0 ? String(rows[0].link_publico_url) : null;
}

/** Dá token às propostas que ainda não têm (as anteriores a esta mudança). */
export async function garantirLinksPendentes(db: Consulta, base?: string, lote = 500): Promise<number> {
  const { rows } = await db.query(
    `SELECT id, tenant_id FROM propostas WHERE token_publico_hash IS NULL LIMIT $1`,
    [lote],
  );
  let feitos = 0;
  for (const r of rows) {
    if (await garantirLinkPublico(db, String(r.tenant_id ?? ''), String(r.id), base)) feitos++;
  }
  return feitos;
}

/** Junta o link da coluna ao registro, para as telas da agência. */
export function comLink<T extends Record<string, unknown>>(data: T, url: unknown): T {
  return typeof url === 'string' && url ? { ...data, link_publico: url } : data;
}

export interface PropostaResolvida {
  id: string;
  tenantId: string;
  data: Record<string, unknown>;
  linkPublico: string | null;
}

/**
 * Acha a proposta pelo endereço público: token (pelo hash) ou, só para as
 * propostas antigas e dentro do prazo, pelo id.
 */
export async function resolverPropostaPublica(db: Consulta, slug: string): Promise<PropostaResolvida | null> {
  if (!FORMATO_SLUG.test(slug)) return null;
  const { rows } = await db.query(
    `SELECT id, tenant_id, data, link_publico_url FROM propostas
      WHERE token_publico_hash = $1 AND (token_expira_em IS NULL OR token_expira_em > NOW())
      LIMIT 1`,
    [hashDoToken(slug)],
  );
  const r = rows[0] ?? (await db.query(
    `SELECT id, tenant_id, data, link_publico_url FROM propostas
      WHERE id = $1 AND link_por_id_ate IS NOT NULL AND link_por_id_ate > NOW()
      LIMIT 1`,
    [slug],
  )).rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id ?? ''),
    data: (r.data ?? {}) as Record<string, unknown>,
    linkPublico: (r.link_publico_url as string | null) ?? null,
  };
}

/** Campos do topo que a página pública desenha. Todo o resto fica de fora. */
const CAMPOS_PUBLICOS = [
  'numero', 'versao', 'idioma', 'visual', 'viagem', 'cabecalho', 'secoes',
  'rodape', 'status', 'cliente_nome', 'criado_em', 'atualizado_em',
] as const;

/** Chaves internas que nunca saem, em qualquer nível (custo, margem...). */
const CHAVE_INTERNA = /^(valor_custo|custo|custo_(?!beneficio).*|.*_custo|margem.*|markup.*|comissao.*|.*_intern[oa]s?|observacoes_internas|notas_internas|fornecedor_id|crm_.*)$/i;

function semInternos(v: unknown, profundidade = 0): unknown {
  if (profundidade > 20) return null;
  if (Array.isArray(v)) return v.map(x => semInternos(x, profundidade + 1));
  if (v && typeof v === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (CHAVE_INTERNA.test(k)) continue;
      saida[k] = semInternos(x, profundidade + 1);
    }
    return saida;
  }
  return v;
}

/**
 * Recorte público da proposta. `slug` vira o id da resposta: a página só
 * usa o id para saber que a proposta veio, e o id interno não precisa sair.
 * Do aceite, sai só o nome e a data (a página mostra "aceita por X em Y").
 */
export function paraPublico(data: Record<string, unknown>, slug: string): Record<string, unknown> {
  const saida: Record<string, unknown> = { id: slug };
  for (const campo of CAMPOS_PUBLICOS) {
    if (campo in data) saida[campo] = semInternos(data[campo]);
  }
  const aceite = data.aceite as Record<string, unknown> | null | undefined;
  saida.aceite = aceite && typeof aceite === 'object'
    ? { nome_aceite: String(aceite.nome_aceite ?? ''), data_aceite: String(aceite.data_aceite ?? '') }
    : null;
  return saida;
}

/** Listas que o visitante faz crescer: teto para não inflar o registro sem fim. */
export const TETO_EVENTOS_PUBLICOS = 500;

/**
 * Acrescenta um item a uma lista do JSON da proposta, num UPDATE só
 * (FIN2-07). Ler o registro, mexer e regravar inteiro deixava duas ações
 * públicas simultâneas apagarem uma a outra: uma visualização que terminasse
 * depois do aceite regravava a proposta sem o aceite.
 * Devolve false quando a lista já está no teto.
 */
export async function acrescentarEventoPublico(
  db: Consulta,
  propostaId: string,
  lista: 'visualizacoes' | 'feedbacks' | 'leads',
  item: Record<string, unknown>,
): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE propostas
        SET data = jsonb_set(
                     jsonb_set(data, ARRAY[$2::text],
                       (CASE WHEN jsonb_typeof(data->$2) = 'array' THEN data->$2 ELSE '[]'::jsonb END) || jsonb_build_array($3::jsonb),
                       true),
                     '{atualizado_em}', to_jsonb($4::text), true),
            updated_at = NOW()
      WHERE id = $1
        AND (jsonb_typeof(data->$2) IS DISTINCT FROM 'array' OR jsonb_array_length(data->$2) < $5)
      RETURNING id`,
    [propostaId, lista, JSON.stringify(item), new Date().toISOString(), TETO_EVENTOS_PUBLICOS],
  );
  return rows.length > 0;
}

/** ENVIADO vira VISUALIZADO; nenhum outro status muda (nunca rebaixa ACEITO). */
export async function marcarVisualizada(db: Consulta, propostaId: string): Promise<void> {
  await db.query(
    `UPDATE propostas
        SET data = jsonb_set(data, '{status}', '"VISUALIZADO"', true), status = 'VISUALIZADO', updated_at = NOW()
      WHERE id = $1 AND COALESCE(data->>'status', '') = 'ENVIADO'`,
    [propostaId],
  );
}

/** Status em que a proposta não aceita mais aceite. */
const SEM_ACEITE = ['ACEITO', 'RECUSADO', 'EXPIRADO', 'CONVERTIDO'];

/**
 * Aceite como troca condicional (FIN2-07): só grava se a proposta ainda não
 * foi aceita. Um segundo aceite não sobrescreve o nome, o IP e a data do
 * primeiro. Devolve true quando este aceite foi o que valeu.
 */
export async function registrarAceite(db: Consulta, propostaId: string, aceite: Record<string, unknown>): Promise<boolean> {
  const agora = new Date().toISOString();
  const { rows } = await db.query(
    `UPDATE propostas
        SET data = data || jsonb_build_object('status', 'ACEITO', 'aceite', $2::jsonb, 'atualizado_em', $3::text),
            status = 'ACEITO', updated_at = NOW()
      WHERE id = $1 AND COALESCE(data->>'status', '') <> ALL ($4::text[])
      RETURNING id`,
    [propostaId, JSON.stringify(aceite), agora, SEM_ACEITE],
  );
  return rows.length > 0;
}
