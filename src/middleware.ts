import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { isCanonicalHost, extractHost, getCanonicalBaseUrl } from './lib/canonical-hosts';

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

// Rotas permitidas em domínio personalizado de proposta. Tudo fora
// desta whitelist é redirecionado pro domínio canônico. O middleware
// NÃO valida tenant aqui (sem acesso a DB no edge runtime) — quem
// valida é a rota /api/propostas/public/[slug] via tenant-host.ts.
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
  // Se o host não é canônico (configurado por algum tenant em
  // Agencia.custom_proposta_domain), bloqueia qualquer rota fora do
  // whitelist redirecionando pro domínio canônico. A validação de
  // "esse hostname pertence ao tenant da proposta X" acontece no
  // server-side da rota (tenant-host.ts), porque o middleware roda
  // em edge runtime e não pode tocar no Postgres.
  const host = extractHost(request);
  if (host && !isCanonicalHost(host)) {
    if (!isProposalAllowedPath(pathname)) {
      const target = new URL(
        `${pathname}${request.nextUrl.search}`,
        getCanonicalBaseUrl(),
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
