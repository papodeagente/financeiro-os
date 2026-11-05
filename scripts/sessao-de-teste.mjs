/**
 * Substituto de src/lib/auth.ts nos testes que chamam ROTAS (ver
 * sessao-de-teste-hook.mjs). A sessão é a que o teste pendurar em
 * globalThis.__SESSAO_DE_TESTE__ (null = sem login).
 */
export const SESSAO_SEGUNDOS = 12 * 60 * 60;
export const COOKIE_NAME = 'entur-session';
export async function getSession() {
  return globalThis.__SESSAO_DE_TESTE__ ?? null;
}
export async function createSession() { throw new Error('createSession não existe no teste'); }
export async function verifySession() { return null; }
export async function hashPassword() { throw new Error('hashPassword não existe no teste'); }
export async function verifyPassword() { return false; }
