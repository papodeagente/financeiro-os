/**
 * Consulta dos relatórios "Por categoria", "Por centro de custo" e "Por
 * rateio" (05/11/2026). O banco recorta pela agência, pelo tipo e pelo
 * período na data escolhida; o resto (rateio, árvore de centros, repasse,
 * pesquisa) é aplicado aqui pelas regras puras, e o navegador recebe só a
 * página pedida e os totais do recorte inteiro.
 */
import type { ExecutorSQL } from './caixa-atomico';
import {
  agruparLinhas,
  montarLinhas,
  ordenarLinhas,
  paginar,
  regimeDosFiltros,
  totalizar,
  type ContaDoRelatorio,
  type ContextoRelatorio,
  type FiltrosLancamentos,
  type GrupoDoRelatorio,
  type LinhaLancamento,
  type TotaisDoRelatorio,
} from './lancamentos-por-dimensao';

/** Teto de contas lidas por consulta. Acima disso, a resposta avisa. */
export const LIMITE_DE_CONTAS = 20_000;

const str = (v: unknown) => (v == null ? '' : String(v));

/** Expressão SQL da data-base na conta (texto AAAA-MM-DD). */
function sqlDaData(dataDe: FiltrosLancamentos['data_de'], lado: 'pagar' | 'receber'): string {
  const mov = lado === 'pagar' ? `data->>'data_pagamento'` : `data->>'data_recebimento'`;
  switch (dataDe) {
    case 'EMISSAO': return `left(COALESCE(NULLIF(data->>'data_emissao', ''), data->>'data_vencimento'), 10)`;
    case 'VENCIMENTO': return `left(data->>'data_vencimento', 10)`;
    default: return `left(${mov}, 10)`;
  }
}

async function contasDoPeriodo(
  exec: ExecutorSQL,
  tenantId: string,
  f: FiltrosLancamentos,
): Promise<{ contas: ContaDoRelatorio[]; truncado: boolean }> {
  const lados: Array<{ lado: 'pagar' | 'receber'; tabela: string }> = [];
  if (f.tipo !== 'RECEITA') lados.push({ lado: 'pagar', tabela: 'contas_pagar' });
  if (f.tipo !== 'DESPESA') lados.push({ lado: 'receber', tabela: 'contas_receber' });
  const contas: ContaDoRelatorio[] = [];
  let truncado = false;
  for (const { lado, tabela } of lados) {
    const restante = LIMITE_DE_CONTAS - contas.length;
    if (restante <= 0) { truncado = true; break; }
    const { rows } = await exec.query(
      `SELECT id, data FROM ${tabela}
        WHERE tenant_id = $1 AND ${sqlDaData(f.data_de, lado)} BETWEEN $2 AND $3
        ORDER BY ${sqlDaData(f.data_de, lado)}, id
        LIMIT $4`,
      [tenantId, f.de, f.ate, restante + 1],
    );
    if (rows.length > restante) { truncado = true; rows.length = restante; }
    for (const r of rows) contas.push({ id: str(r.id), lado, data: (r.data ?? {}) as Record<string, unknown> });
  }
  return { contas, truncado };
}

async function contexto(exec: ExecutorSQL, tenantId: string, contas: readonly ContaDoRelatorio[]): Promise<ContextoRelatorio> {
  const [cats, centros, bancos] = await Promise.all([
    exec.query(`SELECT id, codigo, tipo, data FROM plano_contas WHERE tenant_id = $1`, [tenantId]),
    exec.query(`SELECT id, nome, data FROM centros_custo WHERE tenant_id = $1`, [tenantId]),
    exec.query(`SELECT id, nome, data FROM contas_bancarias WHERE tenant_id = $1`, [tenantId]),
  ]);
  const idsVenda = [...new Set(contas.map(c => str(c.data.venda_id) || str(c.data.origem_venda_id)).filter(Boolean))];
  const vendas = idsVenda.length
    ? await exec.query(`SELECT id, data->>'numero' AS numero FROM vendas_crm WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, idsVenda])
    : { rows: [] as Record<string, unknown>[] };
  const d = (r: Record<string, unknown>) => (r.data ?? {}) as Record<string, unknown>;
  return {
    categorias: cats.rows.map(r => ({
      id: str(r.id),
      codigo: str(r.codigo) || str(d(r).codigo),
      nome: str(d(r).nome),
      tipo: str(d(r).tipo) || str(r.tipo),
      categoria_pai_id: str(d(r).categoria_pai_id) || null,
      repasse: d(r).repasse === true,
    })),
    centros: centros.rows.map(r => ({
      id: str(r.id),
      nome: str(r.nome) || str(d(r).nome),
      codigo: str(d(r).codigo),
      centro_pai_id: str(d(r).centro_pai_id) || null,
    })),
    contasBancarias: new Map(bancos.rows.map(r => [str(r.id), str(r.nome) || str(d(r).nome)])),
    vendas: new Map(vendas.rows.map(r => [str(r.id), str(r.numero)])),
  };
}

export interface RespostaLancamentos {
  regime: 'caixa' | 'competencia';
  linhas: LinhaLancamento[];
  pagina: number;
  paginas: number;
  por_pagina: number;
  totais: TotaisDoRelatorio;
  grupos: GrupoDoRelatorio[];
  truncado: boolean;
}

/** Todas as linhas do recorte, já ordenadas (planilha e página usam esta). */
export async function linhasDoRelatorio(
  exec: ExecutorSQL,
  tenantId: string,
  f: FiltrosLancamentos,
  hoje: string,
  empresas: readonly string[] | null = null,
): Promise<{ linhas: LinhaLancamento[]; truncado: boolean }> {
  if (!tenantId) throw new Error('Agência não identificada');
  const { contas, truncado } = await contasDoPeriodo(exec, tenantId, f);
  const ctx = { ...(await contexto(exec, tenantId, contas)), empresas };
  return { linhas: ordenarLinhas(montarLinhas(contas, ctx, f, hoje), f), truncado };
}

export async function consultarLancamentos(
  exec: ExecutorSQL,
  tenantId: string,
  f: FiltrosLancamentos,
  hoje: string,
  empresas: readonly string[] | null = null,
): Promise<RespostaLancamentos> {
  const { linhas, truncado } = await linhasDoRelatorio(exec, tenantId, f, hoje, empresas);
  const pagina = paginar(linhas, f.pagina, f.por_pagina);
  return {
    regime: regimeDosFiltros(f),
    linhas: pagina.itens,
    pagina: pagina.pagina,
    paginas: pagina.paginas,
    por_pagina: f.por_pagina,
    totais: totalizar(linhas),
    grupos: agruparLinhas(linhas, f),
    truncado,
  };
}
