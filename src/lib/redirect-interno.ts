import { isMindMapImportPath } from './mapa-mental-public-path';

/**
 * Aceita somente caminhos locais do próprio app para retornos pós-login.
 * A URL é normalizada antes do uso para impedir `//host`, barras invertidas,
 * protocolos e caracteres de controle de virarem redirecionamento externo.
 */
export function redirectInternoSeguro(
  value: unknown,
  fallback = '/dashboard',
): string {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fallback;

  try {
    const base = new URL('https://app.entur.invalid');
    const parsed = new URL(value, base);
    if (
      parsed.origin !== base.origin
      || !parsed.pathname.startsWith('/')
      || parsed.pathname.startsWith('//')
      || parsed.pathname === '/login'
    ) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/** O login só preserva retorno para o fluxo de importação que o originou. */
export function redirectImportacaoMapaSeguro(
  value: unknown,
  fallback = '/dashboard',
): string {
  const local = redirectInternoSeguro(value, '');
  if (!local) return fallback;
  try {
    const parsed = new URL(local, 'https://app.entur.invalid');
    return isMindMapImportPath(parsed.pathname) ? local : fallback;
  } catch {
    return fallback;
  }
}
