/**
 * Campos personalizados na planilha da lista Contas a Pagar/Receber
 * (06/11/2026, E7). As definições ficam no cadastro da agência
 * (Configurações › Financeiro › Campos personalizados); aqui só se lê, sem
 * confiar no formato. Falha na leitura = planilha sem os campos, nunca erro.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { camposDaConfig, type CampoDaLista } from './contas-pagar-receber';

/** Chaves do cadastro da agência onde as definições podem estar. */
const CHAVES = ['campos_personalizados_titulos', 'campos_personalizados'] as const;

export async function camposParaExportar(exec: ExecutorSQL, tenantId: string): Promise<CampoDaLista[]> {
  try {
    const { rows } = await exec.query(
      `SELECT ${CHAVES.map((c, i) => `data->'${c}' AS c${i}`).join(', ')}
         FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
      [tenantId],
    );
    const r = rows[0];
    if (!r) return [];
    for (let i = 0; i < CHAVES.length; i++) {
      const campos = camposDaConfig(r[`c${i}`]);
      if (campos.length) return campos;
    }
    return [];
  } catch {
    return [];
  }
}
