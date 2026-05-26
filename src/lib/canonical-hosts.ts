// Helpers para identificar hosts canônicos da aplicação. Mantido sem
// dependência de DB pra ser importável no middleware (edge runtime).

const STATIC_CANONICAL = new Set<string>([
  'fin.enturos.com',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

function envCanonicalSet(): Set<string> {
  const extras = [
    process.env.COOLIFY_FQDN?.toLowerCase(),
    ...(process.env.CANONICAL_HOSTS?.split(',').map(s => s.trim().toLowerCase()) || []),
  ].filter(Boolean) as string[];
  return new Set([...STATIC_CANONICAL, ...extras]);
}

// host vem do header (já normalizado pra lowercase, sem porta).
export function isCanonicalHost(host: string): boolean {
  if (!host) return false;
  return envCanonicalSet().has(host);
}

// Normaliza header de host: aceita "Host" ou "X-Forwarded-Host",
// remove porta, lowercase.
export function extractHost(req: { headers: Headers | { get(name: string): string | null } }): string {
  const h = req.headers as { get(name: string): string | null };
  const raw = h.get('x-forwarded-host') || h.get('host') || '';
  return raw.split(',')[0].trim().split(':')[0].toLowerCase();
}

// Base canônica para redirecionar — lida com Coolify COOLIFY_URL que
// pode vir como lista separada por vírgula.
export function getCanonicalBaseUrl(): string {
  const canonicals = envCanonicalSet();
  const candidates = [
    process.env.PUBLIC_APP_URL,
    ...(process.env.COOLIFY_URL?.split(',') || []),
  ]
    .map(v => v?.trim())
    .filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const u = new URL(raw);
      if (canonicals.has(u.hostname.toLowerCase())) {
        return `${u.protocol}//${u.host}`;
      }
    } catch { /* skip invalid URL */ }
  }
  return 'https://fin.enturos.com';
}
