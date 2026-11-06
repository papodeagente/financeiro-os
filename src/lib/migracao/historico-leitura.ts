/**
 * Mudança v2 (E7, 06/11/2026): leitura dos registros trazidos do sistema
 * anterior (faturas, notas emitidas, comissões já pagas). Só consulta: nada
 * aqui cobra, emite ou paga. Dinheiro sai em reais.
 */
import type { ExecutorSQL } from '../caixa-atomico';

export type TipoDoRegistro = 'faturas' | 'notas' | 'comissoes_pagas';
export const TIPOS_DO_REGISTRO: TipoDoRegistro[] = ['faturas', 'notas', 'comissoes_pagas'];

export interface RegistroAnterior {
  id: string;
  tipo: TipoDoRegistro;
  data: string | null;
  valor: number;
  pessoa: string;
  numero: string;
  venda_id: string;
  dados: Record<string, unknown>;
  arquivo: string;
  linha: number | null;
}

const txt = (v: unknown) => (v == null ? '' : String(v));
const POR_PAGINA = 100;

export async function listarHistorico(
  exec: ExecutorSQL, tenantId: string, f: { tipo?: string; busca?: string; pagina?: number },
): Promise<{ registros: RegistroAnterior[]; total: number; pagina: number; por_pagina: number; contagem: Record<TipoDoRegistro, number> }> {
  const contagem: Record<TipoDoRegistro, number> = { faturas: 0, notas: 0, comissoes_pagas: 0 };
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.migracao_historico') IS NOT NULL AS ok`);
  if (!tem[0]?.ok) return { registros: [], total: 0, pagina: 1, por_pagina: POR_PAGINA, contagem };
  const { rows: cont } = await exec.query(`SELECT tipo, COUNT(*)::int AS n FROM migracao_historico WHERE tenant_id = $1 GROUP BY tipo`, [tenantId]);
  for (const r of cont) if (TIPOS_DO_REGISTRO.includes(txt(r.tipo) as TipoDoRegistro)) contagem[txt(r.tipo) as TipoDoRegistro] = Number(r.n);
  const tipo = TIPOS_DO_REGISTRO.includes(f.tipo as TipoDoRegistro) ? (f.tipo as TipoDoRegistro) : 'faturas';
  const args: unknown[] = [tenantId, tipo];
  let filtro = '';
  if (f.busca?.trim()) {
    args.push(`%${f.busca.trim().replace(/[%_\\]/g, '')}%`);
    filtro = ` AND (pessoa ILIKE $3 OR numero ILIKE $3 OR dados::text ILIKE $3)`;
  }
  const pagina = Math.max(1, Math.floor(Number(f.pagina) || 1));
  const { rows: tot } = await exec.query(`SELECT COUNT(*)::int AS n FROM migracao_historico WHERE tenant_id = $1 AND tipo = $2${filtro}`, args);
  const { rows } = await exec.query(
    `SELECT id, tipo, data::text AS data, valor_centavos, pessoa, numero, venda_id, dados, origem FROM migracao_historico
      WHERE tenant_id = $1 AND tipo = $2${filtro} ORDER BY data DESC NULLS LAST, numero LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
    args,
  );
  return {
    registros: rows.map(r => {
      const o = (r.origem ?? {}) as Record<string, unknown>;
      return {
        id: txt(r.id), tipo: txt(r.tipo) as TipoDoRegistro, data: r.data ? txt(r.data).slice(0, 10) : null, valor: Number(r.valor_centavos) / 100,
        pessoa: txt(r.pessoa), numero: txt(r.numero), venda_id: txt(r.venda_id), dados: (r.dados ?? {}) as Record<string, unknown>,
        arquivo: txt(o.arquivo), linha: o.linha == null ? null : Number(o.linha),
      };
    }),
    total: Number(tot[0]?.n ?? 0), pagina, por_pagina: POR_PAGINA, contagem,
  };
}
