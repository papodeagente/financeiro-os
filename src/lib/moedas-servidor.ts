/**
 * Cadastro de moedas da agência no servidor (E7, frente D, 06/11/2026).
 * A regra pura mora em ./moedas.ts.
 *
 * - MOEDAS_SCHEMA_SQL: tabela `moedas_da_agencia` (auditada: é cadastro).
 * - lerCatalogoDaAgencia(): as do sistema mais as da agência. Agência sem a
 *   tabela (banco antigo, testes que não a criam) recebe só as do sistema,
 *   sem consulta que falhe (conferido com to_regclass, que nunca dá erro e não
 *   envenena a transação).
 * - codigosPtaxDasAgencias(): moedas que alguma agência cadastrou e que a
 *   PTAX publica, para a consulta global de 15 min buscar junto.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { MOEDAS, MOEDAS_ESTRANGEIRAS, MOEDAS_PTAX_DISPONIVEIS, type CatalogoDeMoedas } from './cambio';
import { catalogoCompleto, validarMoedaDaAgencia, type MoedaDaAgencia } from './moedas';

export const MOEDAS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS moedas_da_agencia (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    nome TEXT NOT NULL,
    simbolo TEXT NOT NULL,
    casas INTEGER NOT NULL DEFAULT 2 CHECK (casas BETWEEN 0 AND 3),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );
`;

export class ErroMoeda extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

async function tabelaExiste(exec: ExecutorSQL): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass('public.moedas_da_agencia') IS NOT NULL AS ok`);
  return rows[0]?.ok === true;
}

export async function listarMoedasDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<MoedaDaAgencia[]> {
  if (!(await tabelaExiste(exec))) return [];
  const { rows } = await exec.query(
    `SELECT id, nome, simbolo, casas, ativo FROM moedas_da_agencia WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
  return rows.map(r => ({
    codigo: String(r.id), nome: String(r.nome), simbolo: String(r.simbolo),
    casas: Number(r.casas), ativo: r.ativo !== false,
  }));
}

/** O catálogo da agência (sempre com as oito do sistema). */
export async function lerCatalogoDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<CatalogoDeMoedas> {
  const daAgencia = await listarMoedasDaAgencia(exec, tenantId);
  return daAgencia.length ? catalogoCompleto(daAgencia) : MOEDAS;
}

export async function salvarMoedaDaAgencia(
  exec: ExecutorSQL, tenantId: string, entrada: Record<string, unknown>, codigoEmEdicao?: string,
): Promise<MoedaDaAgencia> {
  if (!(await tabelaExiste(exec))) throw new ErroMoeda('Cadastro de moedas indisponível.', 503);
  const existentes = await listarMoedasDaAgencia(exec, tenantId);
  if (codigoEmEdicao && !existentes.some(m => m.codigo === codigoEmEdicao)) {
    throw new ErroMoeda('Esta moeda não está cadastrada nesta agência.', 404);
  }
  const r = validarMoedaDaAgencia(entrada, existentes, codigoEmEdicao);
  if (!r.ok) throw new ErroMoeda(r.erro);
  const m = r.moeda;
  await exec.query(
    `INSERT INTO moedas_da_agencia (tenant_id, id, nome, simbolo, casas, ativo)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, id) DO UPDATE SET nome = EXCLUDED.nome, simbolo = EXCLUDED.simbolo,
       casas = EXCLUDED.casas, ativo = EXCLUDED.ativo, atualizado_em = NOW()`,
    [tenantId, m.codigo, m.nome, m.simbolo, m.casas, m.ativo],
  );
  return m;
}

/**
 * Moedas além das oito que alguma agência cadastrou e que a PTAX publica
 * (DKK, NOK, SEK). A consulta global inclui estas; as que a PTAX não publica
 * ficam de fora (câmbio digitado), sem consulta que falharia toda hora.
 */
export async function codigosPtaxDasAgencias(exec: ExecutorSQL): Promise<string[]> {
  if (!(await tabelaExiste(exec))) return [];
  const extras = MOEDAS_PTAX_DISPONIVEIS.filter(c => !MOEDAS_ESTRANGEIRAS.includes(c));
  if (!extras.length) return [];
  const { rows } = await exec.query(
    `SELECT DISTINCT id FROM moedas_da_agencia WHERE ativo AND id = ANY($1::text[]) ORDER BY id`,
    [extras],
  );
  return rows.map(r => String(r.id));
}

export { conferirMoedaDoCadastro } from './moedas';
