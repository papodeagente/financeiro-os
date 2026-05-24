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
