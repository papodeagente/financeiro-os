import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { sessaoViva, versaoAtualDaSessao } from './sessao-viva';

let _jwtSecret: Uint8Array | null = null;
function getJwtSecret() {
  if (!_jwtSecret) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required. Set it in your .env or hosting config.');
    }
    _jwtSecret = new TextEncoder().encode(secret);
  }
  return _jwtSecret;
}

const COOKIE_NAME = 'entur-session';

export interface SessionPayload {
  userId: string;
  nome: string;
  email: string;
  perfil: string;
  permissoes: Record<string, boolean | string[]>;
  tenantId: string;
  tenantSlug: string;
  isSuperAdmin?: boolean;
  impersonatingTenantId?: string;
  impersonatingTenantSlug?: string;
  /** Versão da sessão no cadastro (ver ./sessao-viva). */
  tv?: number;
}

/** Duração da sessão: 12 horas (era 7 dias). Vale para o JWT e o cookie. */
export const SESSAO_SEGUNDOS = 12 * 60 * 60;

// Hash de senha mora em ./senha para poder ser usado (e testado) sem
// arrastar next/headers.
export { hashPassword, verifyPassword } from './senha';

// ============================================================
// JWT / SESSION
// ============================================================

export async function createSession(payload: SessionPayload): Promise<string> {
  // A versão é sempre a do banco no momento da emissão, nunca a de quem chama:
  // um token novo depois de "sair" já nasce com a versão nova.
  const tv = await versaoAtualDaSessao({
    userId: payload.userId,
    tenantId: payload.tenantId,
    isSuperAdmin: payload.isSuperAdmin,
  });
  const token = await new SignJWT({ ...payload, tv })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSAO_SEGUNDOS}s`)
    .sign(getJwtSecret());
  return token;
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const sessao = await verifySession(token);
  if (!sessao) return null;
  // Assinatura válida não basta: a pessoa pode ter sido desativada, ter o
  // perfil trocado ou ter saído. Ver ./sessao-viva.
  return (await sessaoViva(sessao)) ? sessao : null;
}

export { COOKIE_NAME };
