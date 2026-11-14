/**
 * Categorias padrão das contas geradas (06/11/2026, E7): leitura e gravação
 * no cadastro da agência. Ver categorias-padrao-titulos.ts.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { gravarChaveDaAgencia } from './encargos-servidor';
import { empresaComConfigPropria, lerChavesDaEmpresa } from './empresas-config';
import {
  CHAVE_DA_AGENCIA, limparCategoriasDosTitulos, problemaNaEscolha,
  type CategoriaDoPlano, type CategoriasDosTitulos,
} from './categorias-padrao-titulos';

export class ErroCategoriasDosTitulos extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/**
 * O que a agência escolheu. Nunca derruba quem cria a conta: sem cadastro,
 * sem a chave ou com erro de leitura, devolve {} e a conta nasce como antes.
 *
 * Por empresa (E7, frente D): com `empresaId` de uma empresa além da
 * principal, vale o que ela gravou e, sem escolha própria, o da agência.
 * Sem empresa (ou a principal), exatamente o de sempre.
 */
export async function lerCategoriasDosTitulos(exec: ExecutorSQL, tenantId: string, empresaId?: string | null): Promise<CategoriasDosTitulos> {
  // Dentro de transação, um ponto de volta: a leitura que falha não envenena
  // a transação de quem chamou. Fora de transação, o SAVEPOINT nem existe.
  let comPonto = false;
  try { await exec.query('SAVEPOINT categorias_dos_titulos'); comPonto = true; } catch { comPonto = false; }
  try {
    let valor: unknown;
    if (empresaComConfigPropria(empresaId)) {
      valor = (await lerChavesDaEmpresa(exec, tenantId, empresaId, [CHAVE_DA_AGENCIA]))[CHAVE_DA_AGENCIA];
    } else {
      const { rows } = await exec.query(
        `SELECT data->'${CHAVE_DA_AGENCIA}' AS c FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
        [tenantId],
      );
      valor = rows[0]?.c;
    }
    if (comPonto) await exec.query('RELEASE SAVEPOINT categorias_dos_titulos');
    return limparCategoriasDosTitulos(valor);
  } catch {
    if (comPonto) { try { await exec.query('ROLLBACK TO SAVEPOINT categorias_dos_titulos'); } catch { /* conexão perdida */ } }
    return {};
  }
}

/**
 * A empresa de uma venda (E7, frente D), para a conta gerada por ela ler a
 * configuração daquela empresa. Sem venda, sem empresa ou banco antigo: null
 * (a configuração de sempre). Nunca dá erro.
 */
export async function empresaDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: unknown): Promise<string | null> {
  const id = typeof vendaId === 'string' ? vendaId.trim() : '';
  if (!id) return null;
  const { rows: ok } = await exec.query(`SELECT to_regclass('public.vendas_crm') IS NOT NULL AS ok`);
  if (ok[0]?.ok !== true) return null;
  const { rows } = await exec.query(`SELECT data->>'empresa_id' AS e FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  const e = typeof rows[0]?.e === 'string' ? rows[0].e.trim() : '';
  return e || null;
}

/** A empresa comum a todos os registros (ou null quando misturam empresas ou não dizem). */
export function empresaComum(dados: ReadonlyArray<Record<string, unknown>>): string | null {
  const todas = new Set(dados.map(d => (typeof d.empresa_id === 'string' ? d.empresa_id.trim() : '')));
  if (todas.size !== 1) return null;
  const unica = [...todas][0];
  return unica || null;
}

async function planoDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<CategoriaDoPlano[]> {
  const { rows } = await exec.query(`SELECT id, tipo, data FROM plano_contas WHERE tenant_id = $1`, [tenantId]);
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id), nome: String(d.nome ?? ''), tipo: String(d.tipo ?? r.tipo ?? '').toUpperCase(), ativo: d.ativo !== false,
    };
  });
}

/** Grava a escolha da tela. Cada categoria precisa ser desta agência, ativa e do tipo certo. */
export async function salvarCategoriasDosTitulos(
  exec: ExecutorSQL, tenantId: string, pedido: unknown, empresaId?: string | null,
): Promise<CategoriasDosTitulos> {
  const escolha = limparCategoriasDosTitulos(pedido);
  const problema = problemaNaEscolha(escolha, await planoDaAgencia(exec, tenantId));
  if (problema) throw new ErroCategoriasDosTitulos(problema);
  await gravarChaveDaAgencia(exec, tenantId, CHAVE_DA_AGENCIA, escolha, empresaId);
  return escolha;
}
