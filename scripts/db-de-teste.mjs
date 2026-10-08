/**
 * Substituto de src/lib/db.ts nos testes (ver db-de-teste-hook.mjs).
 * O pool precisa estar em globalThis.__POOL_DE_TESTE__ antes do primeiro
 * import de qualquer módulo que use o banco.
 */
const pool = globalThis.__POOL_DE_TESTE__ ?? null;
export default pool;
export async function initDB() {}
