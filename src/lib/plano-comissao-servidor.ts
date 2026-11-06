import type { ExecutorSQL } from './caixa-atomico';
import pool from './db';
import { perfilDaConta } from './perfil-da-conta';
import { validarBaseDoPlano } from './plano-comissao';

/** Validação autoritativa usada tanto na criação quanto na edição do plano. */
export async function conferirPlanoComissaoNoServidor(
  tenantId: string,
  item: Record<string, unknown>,
): Promise<string | null> {
  const perfil = await perfilDaConta(tenantId, pool as unknown as ExecutorSQL | null);
  return validarBaseDoPlano(item.base_calculo, perfil);
}
