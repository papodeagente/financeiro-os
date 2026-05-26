import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

let _jwtSecret: Uint8Array | null = null;
function getJwtSecret() {
  if (!_jwtSecret) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required.');
    }
    _jwtSecret = new TextEncoder().encode(secret);
  }
  return _jwtSecret;
}

const COOKIE_NAME = 'entur-session';

// Hosts canônicos do sistema — qualquer outro host que aponte pra essa
// app é tratado como domínio personalizado de propostas (configurado
// em Agencia.custom_proposta_domain) e SÓ pode servir rotas públicas
// de proposta. CANONICAL_HOSTS env var pode estender via vírgula
// (ex.: "fin.enturos.com,fin2.enturos.com").
const CANONICAL_HOSTS = new Set<string>(
  [
    'fin.enturos.com',
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    process.env.COOLIFY_FQDN?.toLowerCase(),
    ...(process.env.CANONICAL_HOSTS?.split(',').map(s => s.trim().toLowerCase()) || []),
  ].filter(Boolean) as string[],
);

// Rotas permitidas em domínio personalizado de proposta. Tudo fora
// desta whitelist é redirecionado pro domínio canônico.
function isProposalAllowedPath(pathname: string): boolean {
  return (
    pathname === '/p' ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/api/propostas/public/') ||
    pathname.startsWith('/api/uploads/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  );
}

function getRequestHost(request: NextRequest): string {
  // x-forwarded-host vem do proxy reverso (Traefik no Coolify);
  // priorizar sobre host porque Next pode ver "localhost" internamente.
  const fwd = request.headers.get('x-forwarded-host');
  const host = request.headers.get('host');
  return (fwd || host || '').split(':')[0].toLowerCase();
}

function getCanonicalBase(): string {
  // Base pra redirecionar quando o host atual é um custom proposal
  // domain mas a rota não é de proposta. Prioriza PUBLIC_APP_URL.
  //
  // Coolify seta COOLIFY_URL com lista de FQDNs separados por vírgula
  // quando a app tem múltiplos domínios (ex.:
  // "https://fin.enturos.com,https://proposta.entur.ia.br"). Filtro
  // pra pegar o primeiro que NÃO é um host de proposta personalizado
  // — usa CANONICAL_HOSTS pra decidir.
  const candidates = [
    process.env.PUBLIC_APP_URL,
    ...(process.env.COOLIFY_URL?.split(',') || []),
  ]
    .map(v => v?.trim())
    .filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const u = new URL(raw);
      const h = u.hostname.toLowerCase();
      if (CANONICAL_HOSTS.has(h)) {
        return `${u.protocol}//${u.host}`;
      }
    } catch { /* invalid URL — skip */ }
  }

  return 'https://fin.enturos.com';
}

// Public routes that don't require authentication
const PUBLIC_PATHS = [
  '/login', '/api/auth/login', '/api/auth/seed', '/api/auth/session',
  '/api/auth/signup',
  '/signup',
  '/p/', '/api/propostas/public/', '/api/uploads/',
  '/api/v1/crm/webhook', '/api/v1/crm/health',
  '/admin/login', '/api/admin/auth/login', '/api/admin/auth/seed',
  '/api/planos',
  '/api/marketing/',
  '/api/convites/',
];

// Caminho exato — '/' nao pode ser prefixo (capturaria tudo). Landing
// page acessivel sem auth; logged-in users veem a LP normalmente
// tambem (o /page.tsx redireciona logged-in pro dashboard via client).
const PUBLIC_EXACT_PATHS = new Set(['/']);

function addSecurityHeaders(response: NextResponse) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ============================================================
  // Custom proposal domain — só serve rotas de proposta pública
  // ============================================================
  // Se o host não é canônico (ex.: proposta.entur.ia.br configurado
  // em Agencia.custom_proposta_domain), bloqueia qualquer rota fora
  // do whitelist redirecionando pro domínio canônico.
  const host = getRequestHost(request);
  if (host && !CANONICAL_HOSTS.has(host)) {
    if (!isProposalAllowedPath(pathname)) {
      const target = new URL(
        `${pathname}${request.nextUrl.search}`,
        getCanonicalBase(),
      );
      return NextResponse.redirect(target, 302);
    }
    // Rota permitida no domínio de proposta — segue sem checar auth
    // (propostas públicas não exigem login).
    return addSecurityHeaders(NextResponse.next());
  }

  // Allow public paths (prefixos + exatos)
  if (PUBLIC_EXACT_PATHS.has(pathname) || PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg')
  ) {
    return NextResponse.next();
  }

  // Check for session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 });
    }
    // Admin pages redirect to admin login
    if (pathname.startsWith('/admin')) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Verify JWT
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());

    // Admin routes: require isSuperAdmin
    const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/api/admin/');
    if (isAdminRoute) {
      if (!payload.isSuperAdmin) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'Acesso restrito a super admins' }, { status: 403 });
        }
        return NextResponse.redirect(new URL('/admin/login', request.url));
      }
      return addSecurityHeaders(NextResponse.next());
    }

    return addSecurityHeaders(NextResponse.next());
  } catch {
    // Invalid/expired token — clear cookie and redirect
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: 'Sessao expirada' }, { status: 401 });
      response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
      return response;
    }
    const loginPath = pathname.startsWith('/admin') ? '/admin/login' : '/login';
    const response = NextResponse.redirect(new URL(loginPath, request.url));
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
