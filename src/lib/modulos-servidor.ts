/**
 * Versão e módulos por agência no SERVIDOR (13/11/2026).
 *
 * Esconder o menu não protege nada: toda rota e tarefa de um módulo confere
 * aqui. Leitura com cache de 30 s por processo (molde de sessao-viva.ts),
 * esvaziado quando o Super Admin grava.
 */
import pool from './db';
import type { ExecutorSQL } from './caixa-atomico';
import {
  SEM_MODULOS, liberadosParaTodas, modulosDosDados, moduloLigado,
  type ModuloId, type ModulosDaConta,
} from './modulos';

const VALIDADE_MS = 30_000;
const cache = new Map<string, { em: number; valor: ModulosDaConta }>();
let liberadosCache: { em: number; valor: ModuloId[] } | null = null;

export function esquecerModulos(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId); else cache.clear();
  liberadosCache = null;
}

/** Os módulos liberados para todas (saas_config 'modulos_liberados'), com o mesmo cache. */
export async function liberadosDaPlataforma(exec: ExecutorSQL | null = pool as unknown as ExecutorSQL | null): Promise<ModuloId[]> {
  return exec ? lerLiberados(exec) : [];
}

async function lerLiberados(exec: ExecutorSQL): Promise<ModuloId[]> {
  if (liberadosCache && Date.now() - liberadosCache.em < VALIDADE_MS) return liberadosCache.valor;
  const { rows } = await exec.query(`SELECT data FROM saas_config WHERE key = 'modulos_liberados' LIMIT 1`)
    .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const valor = liberadosParaTodas(rows[0]?.data);
  liberadosCache = { em: Date.now(), valor };
  return valor;
}

export async function modulosDaConta(tenantId: string, exec: ExecutorSQL | null = pool as unknown as ExecutorSQL | null): Promise<ModulosDaConta> {
  if (!exec || !tenantId) return SEM_MODULOS;
  const guardado = cache.get(tenantId);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.valor;
  const [{ rows }, liberados] = await Promise.all([
    exec.query(`SELECT data FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]).catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
    lerLiberados(exec),
  ]);
  const valor = modulosDosDados(rows[0]?.data, liberados);
  cache.set(tenantId, { em: Date.now(), valor });
  return valor;
}

export async function temModulo(tenantId: string, id: ModuloId, exec?: ExecutorSQL | null): Promise<boolean> {
  return moduloLigado(await modulosDaConta(tenantId, exec), id);
}

/**
 * null quando o módulo está ligado; senão a resposta que a rota devolve.
 * 404, e não 403: para a agência sem o módulo, a página simplesmente não existe.
 */
export async function exigirModulo(tenantId: string, id: ModuloId, exec?: ExecutorSQL | null): Promise<{ status: number; erro: string } | null> {
  return (await temModulo(tenantId, id, exec)) ? null : { status: 404, erro: 'Recurso indisponível para esta conta.' };
}

/** As agências com o módulo ligado (para o agendador e a fila). */
export async function agenciasComModulo(exec: ExecutorSQL, id: ModuloId): Promise<Set<string>> {
  const liberados = await lerLiberados(exec);
  const { rows } = await exec.query(`SELECT id, data FROM tenants`).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const saida = new Set<string>();
  for (const r of rows) if (moduloLigado(modulosDosDados(r.data, liberados), id)) saida.add(String(r.id));
  return saida;
}
