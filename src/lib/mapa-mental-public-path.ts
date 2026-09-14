/**
 * Mantém anônimas somente a página de leitura e a API pública do mapa.
 * A ação `/copiar` não corresponde a nenhuma dessas formas e continua
 * protegida pelo middleware.
 */
export function isPublicMindMapShareRequest(pathname: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  return /^\/api\/mapas-mentais\/compartilhados\/[A-Za-z0-9_-]{43}$/.test(pathname)
    || /^\/mapas-mentais\/publico\/[A-Za-z0-9_-]{43}$/.test(pathname);
}

export function isMindMapImportPath(pathname: string): boolean {
  return /^\/planejamento\/mapas-mentais\/importar\/[A-Za-z0-9_-]{43}$/.test(pathname);
}
