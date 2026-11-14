/**
 * Recibo emitido e a trava da venda (E7, 06/11/2026).
 *
 * O recibo da venda é montado na hora (recibo-da-venda.ts). Quando a agência
 * abre o recibo para imprimir ou mandar, ele passa a ser um documento que o
 * cliente pode ter na mão: fica registrado aqui (número, versão, valor e
 * pagador). A partir daí:
 *
 *   · editar o VALOR da venda ou QUEM PAGA pede confirmação (a rota responde
 *     409 `VENDA_COM_RECIBO` na primeira tentativa, com os recibos); com a
 *     confirmação, a venda grava, o histórico da venda registra a mudança e
 *     os recibos emitidos ficam marcados como substituídos;
 *   · o próximo recibo sai com versão nova (RV-123.2) e diz qual substitui.
 *
 * Abrir de novo o mesmo recibo, sem mudança, devolve o mesmo número.
 *
 * Testes: scripts/test-recibo-emitido.ts (puro) e
 * scripts/test-sql-recibo-emitido.mjs (rotas com PGlite).
 */
import { createHash } from 'node:crypto';
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { chaveDoPagante } from './recibo-por-pagante';
import { totaisDaVenda, type Venda } from './venda-modelo';

export const RECIBOS_EMITIDOS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS recibos_emitidos (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    origem TEXT NOT NULL DEFAULT 'venda',
    origem_id TEXT NOT NULL,
    pagante TEXT NOT NULL DEFAULT '',
    versao INTEGER NOT NULL,
    numero TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    pagador_nome TEXT NOT NULL DEFAULT '',
    assinatura TEXT NOT NULL,
    emitido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    emitido_por TEXT NOT NULL DEFAULT '',
    substituido_em TIMESTAMPTZ,
    substituido_motivo TEXT,
    PRIMARY KEY (tenant_id, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_recibo_emitido_valendo
    ON recibos_emitidos(tenant_id, origem, origem_id, pagante) WHERE substituido_em IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_recibo_emitido_versao
    ON recibos_emitidos(tenant_id, origem, origem_id, pagante, versao);
`;

export interface ReciboEmitido {
  numero: string;
  versao: number;
  pagante: string;
  pagador_nome: string;
  valor_centavos: number;
  emitido_em: string;
  emitido_por: string;
}

// ─── Regras puras ──────────────────────────────────────────────────────────

/** "RV-123" na 1ª versão; "RV-123.2" depois. */
export function numeroDaVersao(base: string, versao: number): string {
  return versao > 1 ? `${base}.${versao}` : base;
}

/** O que identifica o conteúdo do recibo (mudou = versão nova). */
export function assinaturaDoRecibo(r: { valor: number; pagador: { nome: string; documento: string }; recebimentos?: ReadonlyArray<{ valor: number; data: string }> }): string {
  return createHash('sha256')
    .update(JSON.stringify([Math.round(r.valor * 100), r.pagador.nome, r.pagador.documento, (r.recebimentos ?? []).map(x => [Math.round(x.valor * 100), x.data])]))
    .digest('hex').slice(0, 24);
}

/** Quem paga a venda: o pagante de cada pagamento ou, sem pagante, o cliente. */
export function pagantesDaVenda(v: Pick<Venda, 'cliente' | 'pagamentos'>): string[] {
  const s = new Set<string>();
  for (const p of v.pagamentos) {
    const quem = p.pagante && (p.pagante.id || p.pagante.nome) ? p.pagante : v.cliente;
    s.add(chaveDoPagante(quem?.id, quem?.nome));
  }
  if (!v.pagamentos.length) s.add(chaveDoPagante(v.cliente?.id, v.cliente?.nome));
  return [...s].sort();
}

export interface MudancaQueAfetaORecibo {
  valor?: { antes_centavos: number; depois_centavos: number };
  pagantes?: { antes: string[]; depois: string[] };
}

/** O que muda no recibo se a venda gravar assim (null = nada que o recibo mostre). */
export function mudancaQueAfetaORecibo(antes: Pick<Venda, 'produtos' | 'pagamentos' | 'cliente'>, depois: Pick<Venda, 'produtos' | 'pagamentos' | 'cliente'>): MudancaQueAfetaORecibo | null {
  const m: MudancaQueAfetaORecibo = {};
  const va = totaisDaVenda(antes).valor_cliente;
  const vd = totaisDaVenda(depois).valor_cliente;
  if (va !== vd) m.valor = { antes_centavos: va, depois_centavos: vd };
  const pa = pagantesDaVenda(antes);
  const pd = pagantesDaVenda(depois);
  if (pa.join('|') !== pd.join('|')) m.pagantes = { antes: pa, depois: pd };
  return m.valor || m.pagantes ? m : null;
}

/** A frase do histórico e do diálogo. */
export function resumoDaMudanca(m: MudancaQueAfetaORecibo): string {
  const partes: string[] = [];
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
  if (m.valor) partes.push(`valor de ${brl(m.valor.antes_centavos)} para ${brl(m.valor.depois_centavos)}`);
  if (m.pagantes) partes.push('quem paga mudou');
  return partes.join('; ');
}

// ─── Banco ─────────────────────────────────────────────────────────────────

const lerLinha = (r: Record<string, unknown>): ReciboEmitido => ({
  numero: String(r.numero), versao: Number(r.versao), pagante: String(r.pagante ?? ''), pagador_nome: String(r.pagador_nome ?? ''),
  valor_centavos: Number(r.valor_centavos ?? 0), emitido_em: String(r.emitido_em ?? ''), emitido_por: String(r.emitido_por ?? ''),
});

/** Os recibos valendo (não substituídos) da venda. */
export async function recibosValendoDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<ReciboEmitido[]> {
  // Banco sem a tabela (antes do initDB): nenhum recibo emitido, a edição segue como sempre.
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.recibos_emitidos') IS NOT NULL AS ok`);
  if (tem[0]?.ok !== true) return [];
  const { rows } = await exec.query(
    `SELECT numero, versao, pagante, pagador_nome, valor_centavos, emitido_em::text AS emitido_em, emitido_por
       FROM recibos_emitidos WHERE tenant_id = $1 AND origem = 'venda' AND origem_id = $2 AND substituido_em IS NULL
      ORDER BY pagante, versao`,
    [tenantId, vendaId],
  );
  return rows.map(lerLinha);
}

/**
 * Registra o recibo aberto para imprimir/mandar. Mesmo conteúdo: o mesmo
 * número. Conteúdo diferente (ou o anterior substituído pela edição da
 * venda): versão nova, e o anterior fica marcado. Devolve o número que vale
 * e, quando há, o número que ele substitui.
 */
export async function registrarReciboDaVenda(
  exec: ExecutorSQL, tenantId: string, vendaId: string,
  r: { numero_base: string; pagante: string; valor: number; pagador: { nome: string; documento: string }; recebimentos?: ReadonlyArray<{ valor: number; data: string }> },
  usuario: string,
): Promise<{ numero: string; versao: number; substitui: string | null }> {
  const assinatura = assinaturaDoRecibo(r);
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`recibo:${tenantId}:${vendaId}:${r.pagante}`]);
  const { rows } = await exec.query(
    `SELECT numero, versao, assinatura, substituido_em IS NULL AS valendo FROM recibos_emitidos
      WHERE tenant_id = $1 AND origem = 'venda' AND origem_id = $2 AND pagante = $3 ORDER BY versao DESC`,
    [tenantId, vendaId, r.pagante],
  );
  const valendo = rows.find(x => x.valendo === true);
  const anterior = valendo ?? rows[0] ?? null;
  if (valendo && valendo.assinatura === assinatura) {
    return { numero: String(valendo.numero), versao: Number(valendo.versao), substitui: null };
  }
  if (valendo) {
    await exec.query(
      `UPDATE recibos_emitidos SET substituido_em = NOW(), substituido_motivo = 'Recibo com valores novos'
        WHERE tenant_id = $1 AND origem = 'venda' AND origem_id = $2 AND pagante = $3 AND substituido_em IS NULL`,
      [tenantId, vendaId, r.pagante],
    );
  }
  const versao = rows.length ? Number(rows[0].versao) + 1 : 1;
  const numero = numeroDaVersao(r.numero_base, versao);
  await exec.query(
    `INSERT INTO recibos_emitidos (id, tenant_id, origem, origem_id, pagante, versao, numero, valor_centavos, pagador_nome, assinatura, emitido_por)
     VALUES ($1, $2, 'venda', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [generateId(), tenantId, vendaId, r.pagante, versao, numero, Math.round(r.valor * 100), r.pagador.nome, assinatura, usuario],
  );
  return { numero, versao, substitui: anterior ? String(anterior.numero) : null };
}

/** Depois da edição confirmada: os recibos valendo passam a "substituídos" (o próximo sai com versão nova). */
export async function substituirRecibosDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, motivo: string): Promise<number> {
  const r = await exec.query(
    `UPDATE recibos_emitidos SET substituido_em = NOW(), substituido_motivo = $3
      WHERE tenant_id = $1 AND origem = 'venda' AND origem_id = $2 AND substituido_em IS NULL`,
    [tenantId, vendaId, motivo.slice(0, 300)],
  );
  return r.rowCount ?? 0;
}
