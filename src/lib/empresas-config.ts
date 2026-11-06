/**
 * Configurações por empresa (06/11/2026, E7 G2), a parte que a baixa, a
 * cobrança, a venda e as notas leem. Sem permissões e sem pool: recebe o
 * executor de quem chama (pode ser a transação dele).
 *
 * A principal continua lendo e gravando onde sempre (agencia.data); as outras
 * empresas guardam em `empresa_configuracoes` só o que mudaram e, no resto,
 * seguem a principal.
 */
import { EMPRESA_PRINCIPAL_ID, type SecaoPorEmpresa } from './empresas';

export interface ExecutorDeConfig {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}
type ExecutorEmpresas = ExecutorDeConfig;

export class ErroEmpresa extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const str = (v: unknown) => (v == null ? '' : String(v));

// to_regclass nunca falha: um banco antigo (ou o teste que não montou a
// tabela) não envenena a transação de quem chamou.
let tabelaPronta = false;
async function tabelaExiste(exec: ExecutorEmpresas): Promise<boolean> {
  if (tabelaPronta) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.empresa_configuracoes') IS NOT NULL AS ok`);
  tabelaPronta = rows[0]?.ok === true;
  return tabelaPronta;
}

/** Em que seção cada chave de agencia.data mora (o que vale por empresa). */
export const SECAO_DA_CHAVE: Record<string, SecaoPorEmpresa> = {
  politica_cobranca: 'financeiro',
  categorias_encargos: 'financeiro',
  // As três da G1 (E7, frente D, 06/11/2026): também por empresa.
  conta_previsao_padrao: 'financeiro',
  categorias_dos_titulos: 'financeiro',
  campos_personalizados_titulos: 'financeiro',
  cobranca: 'cobranca',
  venda_config: 'vendas',
};

export const CHAVES_DA_SECAO: Record<Exclude<SecaoPorEmpresa, 'notas'>, string[]> = {
  financeiro: ['politica_cobranca', 'categorias_encargos', 'conta_previsao_padrao', 'categorias_dos_titulos', 'campos_personalizados_titulos'],
  cobranca: ['cobranca'],
  vendas: ['venda_config'],
};

/** É uma empresa que guarda configuração própria (qualquer uma menos a principal)? */
export function empresaComConfigPropria(empresaId: string | null | undefined): empresaId is string {
  return typeof empresaId === 'string' && empresaId !== '' && empresaId !== EMPRESA_PRINCIPAL_ID;
}

/**
 * Valores das `chaves` para a empresa: o que ela gravou e, no resto, o da
 * agência (a principal). Para a principal, é exatamente o agencia.data.
 */
export async function lerChavesDaEmpresa(
  exec: ExecutorEmpresas, tenantId: string, empresaId: string | null | undefined, chaves: readonly string[],
): Promise<Record<string, unknown>> {
  const { rows } = await exec.query(
    `SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId]);
  const ag = (rows[0]?.data ?? {}) as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  for (const k of chaves) saida[k] = ag[k] ?? null;
  if (!empresaComConfigPropria(empresaId) || !(await tabelaExiste(exec))) return saida;
  const secoes = [...new Set(chaves.map(k => SECAO_DA_CHAVE[k]).filter(Boolean))];
  if (secoes.length === 0) return saida;
  const { rows: proprias } = await exec.query(
    `SELECT data FROM empresa_configuracoes WHERE tenant_id = $1 AND empresa_id = $2 AND secao = ANY($3::text[])`,
    [tenantId, empresaId, secoes],
  );
  for (const r of proprias) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    for (const k of chaves) if (k in d) saida[k] = d[k];
  }
  return saida;
}

/** Grava uma chave na configuração própria da empresa (não toca a agência). */
export async function gravarChaveDaEmpresa(
  exec: ExecutorEmpresas, tenantId: string, empresaId: string, chave: string, valor: unknown,
): Promise<void> {
  const secao = SECAO_DA_CHAVE[chave];
  if (!secao) throw new ErroEmpresa(`A configuração "${chave}" vale para a agência inteira.`);
  await exec.query(
    `INSERT INTO empresa_configuracoes (tenant_id, empresa_id, secao, data)
     VALUES ($1, $2, $3, jsonb_build_object($4::text, $5::jsonb))
     ON CONFLICT (tenant_id, empresa_id, secao) DO UPDATE
       SET data = empresa_configuracoes.data || jsonb_build_object($4::text, $5::jsonb), updated_at = NOW()`,
    [tenantId, empresaId, secao, chave, JSON.stringify(valor ?? null)],
  );
}

/** A empresa tem configuração própria nesta seção (ou segue a principal)? */
export async function temConfigPropria(
  exec: ExecutorEmpresas, tenantId: string, empresaId: string, secao: SecaoPorEmpresa,
): Promise<{ propria: boolean; copiada_de: string }> {
  if (!empresaComConfigPropria(empresaId)) return { propria: true, copiada_de: '' };
  const { rows } = await exec.query(
    `SELECT copiada_de FROM empresa_configuracoes WHERE tenant_id = $1 AND empresa_id = $2 AND secao = $3`,
    [tenantId, empresaId, secao]);
  return { propria: rows.length > 0, copiada_de: str(rows[0]?.copiada_de) };
}

