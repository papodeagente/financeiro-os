/**
 * Campos personalizados dos títulos no servidor (E7, frente D, 06/11/2026).
 * A regra pura mora em ./campos-personalizados.ts.
 *
 * - lerCamposDosTitulos: as definições da empresa (sem escolha própria, as da
 *   agência; sem empresa ou a principal, exatamente as de sempre).
 * - empresaProvavelDoTitulo: em que empresa o título vai cair (a dele, ou a
 *   que o gatilho da G2 daria), para valer a configuração daquela empresa.
 * - recusaDosObrigatorios: o campo obrigatório que ficou vazio, ou null.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { CHAVE_DOS_CAMPOS, normalizarDefinicoes, validarObrigatorios, type CampoPersonalizado, type TabelaDoTitulo } from './campos-personalizados';
import { empresaComConfigPropria, lerChavesDaEmpresa } from './empresas-config';
import { EMPRESA_PRINCIPAL_ID } from './empresas';

export async function lerCamposDosTitulos(exec: ExecutorSQL, tenantId: string, empresaId?: string | null): Promise<CampoPersonalizado[]> {
  if (empresaComConfigPropria(empresaId)) {
    const v = (await lerChavesDaEmpresa(exec, tenantId, empresaId, [CHAVE_DOS_CAMPOS]))[CHAVE_DOS_CAMPOS];
    return normalizarDefinicoes(v ?? []);
  }
  const { rows } = await exec.query(
    `SELECT data->'${CHAVE_DOS_CAMPOS}' AS c FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return normalizarDefinicoes(rows[0]?.c ?? []);
}

/**
 * A empresa do título: a gravada nele (`empresa_id`) ou a que o gatilho da G2
 * daria (venda, cartão, conta bancária, seletor, principal). Banco sem as
 * funções da G2: a principal. Nunca dá erro (to_regproc não falha).
 */
export async function empresaProvavelDoTitulo(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, dados: Record<string, unknown>,
): Promise<string> {
  const propria = typeof dados.empresa_id === 'string' ? dados.empresa_id.trim() : '';
  if (propria) return propria;
  const { rows: f } = await exec.query(`SELECT to_regproc('fin_empresa_derivada') IS NOT NULL AS ok`);
  if (f[0]?.ok !== true) return EMPRESA_PRINCIPAL_ID;
  const { rows } = await exec.query(`SELECT fin_empresa_derivada($1, $2, $3::jsonb) AS e`, [tabela, tenantId, JSON.stringify(dados)]);
  const e = typeof rows[0]?.e === 'string' ? rows[0].e : '';
  return e || EMPRESA_PRINCIPAL_ID;
}

/** O obrigatório vazio do título, pelas definições da empresa dele; null quando está tudo preenchido. */
export async function recusaDosObrigatorios(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, dados: Record<string, unknown>,
): Promise<string | null> {
  const empresa = await empresaProvavelDoTitulo(exec, tenantId, tabela, dados);
  const defs = await lerCamposDosTitulos(exec, tenantId, empresa);
  if (!defs.some(d => d.obrigatorio && d.ativo !== false)) return null;
  return validarObrigatorios(defs, tabela, dados.campos_personalizados as Record<string, unknown> | null | undefined);
}
