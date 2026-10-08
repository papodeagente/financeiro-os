/**
 * Substituto de 'next/headers' nos testes (ver db-de-teste-hook.mjs).
 *
 * Fora do Next não existe requisição, e `cookies()` quebraria. Aqui o cookie
 * de sessão é o que o teste pendurou em `globalThis.__COOKIE_DE_TESTE__` (um
 * JWT de verdade, assinado por `createSession` com o JWT_SECRET do teste):
 * a sessão, o tenant e as permissões passam pelo código de produção. Sem o
 * cookie, não há sessão, como numa requisição anônima.
 */
export async function cookies() {
  return {
    get(nome) {
      const valor = globalThis.__COOKIE_DE_TESTE__;
      return nome === 'entur-session' && valor ? { name: nome, value: valor } : undefined;
    },
  };
}
export async function headers() {
  return new Headers();
}
