/**
 * Conta previsão padrão da agência (06/11/2026, E7): a conta bancária onde se
 * espera pagar ou receber quando o título não diz qual. Guardada em
 * agencia.data.conta_previsao_padrao. Usada pelo fluxo de caixa por conta e
 * como sugestão no lançamento. Sem padrão, tudo funciona como antes.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { contaBancariaAtiva } from './contas-bancarias-regras';
import { gravarChaveDaAgencia } from './encargos-servidor';
import { empresaComConfigPropria, lerChavesDaEmpresa } from './empresas-config';

export const CHAVE_CONTA_PREVISAO = 'conta_previsao_padrao';

export class ErroContaPrevisao extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** Por empresa (E7, frente D): a da empresa e, sem escolha própria, a da agência. */
export async function lerContaPrevisaoPadrao(exec: ExecutorSQL, tenantId: string, empresaId?: string | null): Promise<string | null> {
  if (empresaComConfigPropria(empresaId)) {
    const v = (await lerChavesDaEmpresa(exec, tenantId, empresaId, [CHAVE_CONTA_PREVISAO]))[CHAVE_CONTA_PREVISAO];
    const id = typeof v === 'string' ? v.trim() : '';
    return id || null;
  }
  const { rows } = await exec.query(
    `SELECT data->>'${CHAVE_CONTA_PREVISAO}' AS c FROM agencia WHERE tenant_id = $1
      ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  const id = String(rows[0]?.c ?? '').trim();
  return id || null;
}

/**
 * A conta previsão de cada empresa que escolheu a própria (E7, frente D),
 * para o fluxo de caixa: { empresa_id: conta }. Banco sem a tabela: {}.
 */
export async function lerContasPrevisaoPorEmpresa(exec: ExecutorSQL, tenantId: string): Promise<Record<string, string>> {
  const { rows: ok } = await exec.query(`SELECT to_regclass('public.empresa_configuracoes') IS NOT NULL AS ok`);
  if (ok[0]?.ok !== true) return {};
  const { rows } = await exec.query(
    `SELECT empresa_id, data->>'${CHAVE_CONTA_PREVISAO}' AS c FROM empresa_configuracoes
      WHERE tenant_id = $1 AND secao = 'financeiro' AND COALESCE(data->>'${CHAVE_CONTA_PREVISAO}', '') <> ''`,
    [tenantId],
  );
  const saida: Record<string, string> = {};
  for (const r of rows) saida[String(r.empresa_id)] = String(r.c);
  return saida;
}

/** Grava a padrão (ou tira, com null/''). Só aceita conta ativa desta agência. */
export async function gravarContaPrevisaoPadrao(
  exec: ExecutorSQL, tenantId: string, valor: unknown, empresaId?: string | null,
): Promise<string | null> {
  const id = typeof valor === 'string' ? valor.trim().slice(0, 120) : '';
  if (valor !== null && valor !== undefined && typeof valor !== 'string') {
    throw new ErroContaPrevisao('Conta inválida.');
  }
  if (id) {
    const { rows } = await exec.query(`SELECT data FROM contas_bancarias WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!rows[0]) throw new ErroContaPrevisao('Esta conta bancária não existe nesta agência.', 404);
    if (!contaBancariaAtiva(rows[0].data as { ativo?: unknown })) {
      throw new ErroContaPrevisao('Esta conta bancária está desativada. Escolha uma conta ativa.');
    }
  }
  await gravarChaveDaAgencia(exec, tenantId, CHAVE_CONTA_PREVISAO, id || null, empresaId);
  return id || null;
}
