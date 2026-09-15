import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { isCanonicalHost, extractHost, getCanonicalBaseUrl } from './lib/canonical-hosts';
import { isMindMapImportPath, isPublicMindMapShareRequest } from './lib/mapa-mental-public-path';

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
  // Webhook das plataformas de venda: quem chama é a Hotmart, o Asaas ou
  // o Pagar.me, que não têm sessão. A autenticação é por token ou
  // assinatura dentro da própria rota, por agência.
  '/api/v1/plataformas/',
  '/admin/login', '/api/admin/auth/login', '/api/admin/auth/seed',
  '/api/planos',
  '/api/marketing/',
  '/api/convites/',
];

// Caminho exato — '/' nao pode ser prefixo (capturaria tudo). Landing
// page acessivel sem auth; logged-in users veem a LP normalmente
// tambem (o /page.tsx redireciona logged-in pro dashboard via client).
const PUBLIC_EXACT_PATHS = new Set(['/']);

function loginComRetorno(request: NextRequest): URL {
  const target = new URL('/login', request.url);
  // O link de cópia precisa sobreviver à autenticação. Limitamos o retorno a
  // esta rota conhecida; a tela de login ainda revalida que o valor é local.
  if (isMindMapImportPath(request.nextUrl.pathname)) {
    target.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  return target;
}

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
  // Metadados gerados aqui, nunca aceitos dos headers enviados pelo cliente.
  // A identidade continua vindo exclusivamente da sessão verificada no servidor.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-audit-path', pathname);
  requestHeaders.set('x-audit-method', request.method);
  requestHeaders.set('x-audit-request-id', crypto.randomUUID());
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  // ============================================================
  // Só o domínio canônico serve a aplicação
  // ============================================================
  // Havia aqui uma exceção: um host de terceiro configurado por uma agência
  // em Agencia.custom_proposta_domain podia servir a proposta pública sem
  // passar por autenticação. O domínio personalizado foi removido do produto
  // (a ativação dependia de emitir certificado SSL por domínio, etapa que
  // deixou de existir), e com ele a exceção — que era o único caminho da
  // aplicação em que um host desconhecido chegava a servir conteúdo.
  //
  // Agora qualquer host fora da lista canônica é redirecionado, sem exceção
  // de rota. A lista canônica inclui COOLIFY_FQDN e CANONICAL_HOSTS, então o
  // próprio domínio de produção e os ambientes continuam passando.
  const host = extractHost(request);
  if (host && !isCanonicalHost(host)) {
    const target = new URL(
      `${pathname}${request.nextUrl.search}`,
      getCanonicalBaseUrl(),
    );
    return NextResponse.redirect(target, 302);
  }

  // Allow public paths (prefixos + exatos).
  //
  // Um prefixo só libera a própria rota ou um SEGMENTO abaixo dela. Sem esta
  // regra, '/api/planos' liberava '/api/planos-comissao' inteiro (GET, POST,
  // PUT e DELETE de planos de comissão) por simples casamento de string. O
  // isolamento sobrevivia só porque getTenantId lança sem sessão, ou seja,
  // dependia de uma exceção em vez da autenticação.
  const casaPrefixoPublico = (p: string) =>
    pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`);
  if (
    PUBLIC_EXACT_PATHS.has(pathname)
    || PUBLIC_PATHS.some(casaPrefixoPublico)
    || isPublicMindMapShareRequest(pathname, request.method)
  ) {
    const response = addSecurityHeaders(next());
    if (isPublicMindMapShareRequest(pathname, request.method)) {
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    // O `next` do login pode conter o token do link de cópia. Nenhuma
    // subrequisição da tela deve recebê-lo pelo cabeçalho Referer.
    if (pathname === '/login' && request.nextUrl.searchParams.has('next')) {
      response.headers.set('Referrer-Policy', 'no-referrer');
    }
    return response;
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
    return next();
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
    const response = NextResponse.redirect(loginComRetorno(request));
    if (isMindMapImportPath(pathname)) response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
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
      return addSecurityHeaders(next());
    }

    const response = addSecurityHeaders(next());
    if (isMindMapImportPath(pathname)) {
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    return response;
  } catch {
    // Invalid/expired token — clear cookie and redirect
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: 'Sessao expirada' }, { status: 401 });
      response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
      return response;
    }
    const response = NextResponse.redirect(
      pathname.startsWith('/admin') ? new URL('/admin/login', request.url) : loginComRetorno(request),
    );
    if (isMindMapImportPath(pathname)) response.headers.set('Referrer-Policy', 'no-referrer');
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
