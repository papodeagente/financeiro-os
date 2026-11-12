/**
 * Substituto de src/lib/auth.ts nos testes que chamam ROTAS (ver
 * sessao-de-teste-hook.mjs). A sessão é a que o teste pendurar em
 * globalThis.__SESSAO_DE_TESTE__ (null = sem login).
 */
export const SESSAO_SEGUNDOS = 12 * 60 * 60;
export const COOKIE_NAME = 'entur-session';
export const SESSAO_LEMBRADA_SEGUNDOS = 15 * 24 * 60 * 60;
export function duracaoDaSessao(p) { return p?.lembrar === true ? SESSAO_LEMBRADA_SEGUNDOS : SESSAO_SEGUNDOS; }
export async function getSession() {
  const s = globalThis.__SESSAO_DE_TESTE__ ?? null;
  // A sessão de teste entra como quem passou pelo código do aplicativo
  // (verificação em duas etapas, E7): pagar não pede o código. O teste que
  // quer a pessoa sem o código pendura a sessão com `sf: false`.
  if (s && typeof s === 'object' && s.sf === undefined) s.sf = true;
  return s;
}
// Emite um "token" de teste e guarda o que seria a sessão nova, para o teste
// conferir (ex.: a sessão trocada depois de ativar o segundo fator).
export async function createSession(payload) {
  globalThis.__SESSAO_CRIADA__ = payload;
  return 'token-de-teste';
}
export async function verifySession() { return null; }
export async function hashPassword() { throw new Error('hashPassword não existe no teste'); }
export async function verifyPassword() { return false; }
