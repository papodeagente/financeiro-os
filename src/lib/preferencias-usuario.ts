/**
 * Preferências da pessoa, guardadas no servidor (06/11/2026, E7): as colunas
 * escolhidas numa lista, por exemplo. Valem em qualquer computador em que a
 * pessoa entrar. Por agência e por usuário: ninguém lê nem grava a de outro.
 *
 * Controle (fora do gatilho de auditoria): escolher coluna não é fato
 * financeiro.
 */
import type { ExecutorSQL } from './caixa-atomico';

export const PREFERENCIAS_USUARIO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS preferencias_usuario (
    tenant_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    chave TEXT NOT NULL,
    valor JSONB NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, usuario_id, chave)
  );
`;

/** Chaves aceitas: letras minúsculas, números, ponto, hífen, sublinhado e dois-pontos. */
const CHAVE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/;
/** Uma preferência é pequena: lista de colunas, ordem, filtro. */
export const PREFERENCIA_MAX_BYTES = 8_192;

export class PreferenciaInvalida extends Error {}

export function lerChave(v: unknown): string {
  const chave = typeof v === 'string' ? v.trim() : '';
  if (!CHAVE.test(chave)) throw new PreferenciaInvalida('Preferência inválida.');
  return chave;
}

/** Confere o valor (JSON pequeno) e devolve o texto a gravar. */
export function lerValor(v: unknown): string {
  if (v === undefined) throw new PreferenciaInvalida('Informe o valor da preferência.');
  const texto = JSON.stringify(v);
  if (texto === undefined) throw new PreferenciaInvalida('Valor inválido.');
  if (Buffer.byteLength(texto, 'utf8') > PREFERENCIA_MAX_BYTES) throw new PreferenciaInvalida('Preferência grande demais.');
  return texto;
}

export async function lerPreferencia(exec: ExecutorSQL, tenantId: string, usuarioId: string, chave: string): Promise<unknown | null> {
  const { rows } = await exec.query(
    `SELECT valor FROM preferencias_usuario WHERE tenant_id = $1 AND usuario_id = $2 AND chave = $3`,
    [tenantId, usuarioId, chave],
  );
  return rows[0] ? rows[0].valor : null;
}

export async function gravarPreferencia(exec: ExecutorSQL, tenantId: string, usuarioId: string, chave: string, valorJson: string): Promise<void> {
  await exec.query(
    `INSERT INTO preferencias_usuario (tenant_id, usuario_id, chave, valor, atualizado_em)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (tenant_id, usuario_id, chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW()`,
    [tenantId, usuarioId, chave, valorJson],
  );
}
