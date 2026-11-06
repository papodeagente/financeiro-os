/**
 * Categorias padrão das contas geradas (06/11/2026, E7): leitura e gravação
 * no cadastro da agência. Ver categorias-padrao-titulos.ts.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { gravarChaveDaAgencia } from './encargos-servidor';
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
 */
export async function lerCategoriasDosTitulos(exec: ExecutorSQL, tenantId: string): Promise<CategoriasDosTitulos> {
  // Dentro de transação, um ponto de volta: a leitura que falha não envenena
  // a transação de quem chamou. Fora de transação, o SAVEPOINT nem existe.
  let comPonto = false;
  try { await exec.query('SAVEPOINT categorias_dos_titulos'); comPonto = true; } catch { comPonto = false; }
  try {
    const { rows } = await exec.query(
      `SELECT data->'${CHAVE_DA_AGENCIA}' AS c FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
      [tenantId],
    );
    if (comPonto) await exec.query('RELEASE SAVEPOINT categorias_dos_titulos');
    return limparCategoriasDosTitulos(rows[0]?.c);
  } catch {
    if (comPonto) { try { await exec.query('ROLLBACK TO SAVEPOINT categorias_dos_titulos'); } catch { /* conexão perdida */ } }
    return {};
  }
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
export async function salvarCategoriasDosTitulos(exec: ExecutorSQL, tenantId: string, pedido: unknown): Promise<CategoriasDosTitulos> {
  const escolha = limparCategoriasDosTitulos(pedido);
  const problema = problemaNaEscolha(escolha, await planoDaAgencia(exec, tenantId));
  if (problema) throw new ErroCategoriasDosTitulos(problema);
  await gravarChaveDaAgencia(exec, tenantId, CHAVE_DA_AGENCIA, escolha);
  return escolha;
}
