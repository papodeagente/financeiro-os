import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'entur-os-secret-key-change-in-production-2026'
);

const COOKIE_NAME = 'entur-session';

// Public routes that don't require authentication
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/seed', '/api/auth/session'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
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
    // API routes return 401, pages redirect to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Verify JWT
  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch {
    // Invalid/expired token — clear cookie and redirect
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: 'Sessao expirada' }, { status: 401 });
      response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
      return response;
    }
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
